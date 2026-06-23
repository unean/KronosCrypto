from datetime import timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import Candle, PredictionProbability, SnapshotDetail, SnapshotSummary
from app.models.snapshot import PredictionSnapshot, SnapshotCandle


class SnapshotService:
    def create_snapshot(
        self,
        db: Session,
        symbol: str,
        timeframe: str,
        exchange: str,
        model_key: str,
        device: str,
        lookback: int,
        pred_len: int,
        history: list[Candle],
        prediction: list[Candle],
        sample_paths: list[list[Candle]] | None = None,
    ) -> PredictionSnapshot:
        snapshot = PredictionSnapshot(
            symbol=symbol,
            timeframe=timeframe,
            exchange=exchange,
            model_key=model_key,
            device=device,
            lookback=lookback,
            pred_len=pred_len,
            input_start=self._naive(history[0].timestamp),
            input_end=self._naive(history[-1].timestamp),
            prediction_start=self._naive(prediction[0].timestamp),
            prediction_end=self._naive(prediction[-1].timestamp),
            status="pending",
        )
        db.add(snapshot)
        db.flush()

        for candle in history:
            db.add(self._to_record(snapshot.id, "history", candle))
        for candle in prediction:
            db.add(self._to_record(snapshot.id, "prediction", candle))
        for index, sample_path in enumerate(sample_paths or []):
            for candle in sample_path:
                db.add(self._to_record(snapshot.id, f"sample_{index}", candle))

        db.commit()
        db.refresh(snapshot)
        return snapshot

    def list_snapshots(self, db: Session) -> list[SnapshotSummary]:
        snapshots = db.scalars(
            select(PredictionSnapshot).order_by(PredictionSnapshot.created_at.desc()).limit(100)
        ).all()
        return [self._summary(snapshot) for snapshot in snapshots]

    def get_snapshot(self, db: Session, snapshot_id: int) -> SnapshotDetail:
        snapshot = db.get(PredictionSnapshot, snapshot_id)
        if not snapshot:
            raise ValueError("快照不存在。")
        return self._detail(snapshot)

    def delete_snapshot(self, db: Session, snapshot_id: int) -> None:
        snapshot = db.get(PredictionSnapshot, snapshot_id)
        if not snapshot:
            raise ValueError("快照不存在。")
        db.delete(snapshot)
        db.commit()

    def delete_snapshots(self, db: Session, snapshot_ids: list[int]) -> int:
        unique_ids = sorted(set(snapshot_ids))
        if not unique_ids:
            return 0

        snapshots = db.scalars(select(PredictionSnapshot).where(PredictionSnapshot.id.in_(unique_ids))).all()
        for snapshot in snapshots:
            db.delete(snapshot)
        db.commit()
        return len(snapshots)

    def evaluate(self, db: Session, snapshot_id: int, actual: list[Candle]) -> tuple[SnapshotDetail, dict]:
        snapshot = db.get(PredictionSnapshot, snapshot_id)
        if not snapshot:
            raise ValueError("快照不存在。")

        prediction = [c for c in snapshot.candles if c.kind == "prediction"]
        predicted_by_ts = {c.timestamp: c for c in prediction}
        actual_by_ts = {self._naive(c.timestamp): c for c in actual}
        common_ts = sorted(set(predicted_by_ts).intersection(actual_by_ts))

        if not common_ts:
            raise ValueError("还没有可用于评估的重叠实际 K 线。")

        for old in [c for c in snapshot.candles if c.kind == "actual"]:
            db.delete(old)
        db.flush()

        for candle in actual:
            naive_ts = self._naive(candle.timestamp)
            if snapshot.prediction_start <= naive_ts <= snapshot.prediction_end:
                db.add(self._to_record(snapshot.id, "actual", candle))

        pred_close = np.array([predicted_by_ts[ts].close for ts in common_ts], dtype=float)
        actual_close = np.array([actual_by_ts[ts].close for ts in common_ts], dtype=float)
        errors = pred_close - actual_close
        abs_errors = np.abs(errors)
        abs_pct_errors = abs_errors / np.maximum(actual_close, 1e-9) * 100
        prev_actual = np.array([actual_by_ts[ts].open for ts in common_ts], dtype=float)
        pred_return_pct = (pred_close[-1] - actual_close[0]) / max(actual_close[0], 1e-9) * 100
        actual_return_pct = (actual_close[-1] - actual_close[0]) / max(actual_close[0], 1e-9) * 100
        close_correlation = 0.0
        if len(common_ts) > 1 and np.std(pred_close) > 0 and np.std(actual_close) > 0:
            close_correlation = float(np.corrcoef(pred_close, actual_close)[0, 1])

        # 波动率预测：论文中 Kronos 的强项维度。用同一方法分别计算预测序列与实际序列
        # 在预测窗口内的步进收益标准差，公平对比“模型预测的这段有多颠”与“实际有多颠”。
        pred_volatility_pct = 0.0
        actual_volatility_pct = 0.0
        if len(common_ts) > 1:
            pred_returns = np.diff(pred_close) / np.maximum(pred_close[:-1], 1e-9)
            actual_returns = np.diff(actual_close) / np.maximum(actual_close[:-1], 1e-9)
            pred_volatility_pct = float(np.std(pred_returns) * 100)
            actual_volatility_pct = float(np.std(actual_returns) * 100)

        metrics = {
            "points": int(len(common_ts)),
            "coverage_pct": float(len(common_ts) / max(snapshot.pred_len, 1) * 100),
            "mae_close": float(np.mean(abs_errors)),
            "rmse_close": float(np.sqrt(np.mean(errors**2))),
            "mape_close": float(np.mean(abs_pct_errors)),
            "max_abs_error_close": float(np.max(abs_errors)),
            "max_abs_error_pct": float(np.max(abs_pct_errors)),
            "last_abs_error_close": float(abs_errors[-1]),
            "last_abs_error_pct": float(abs_pct_errors[-1]),
            "bias_close": float(np.mean(errors)),
            "pred_return_pct": float(pred_return_pct),
            "actual_return_pct": float(actual_return_pct),
            "return_error_pct": float(pred_return_pct - actual_return_pct),
            "close_correlation": close_correlation,
            "pred_volatility_pct": pred_volatility_pct,
            "actual_volatility_pct": actual_volatility_pct,
            "volatility_error_pct": float(pred_volatility_pct - actual_volatility_pct),
            "direction_accuracy": float(
                np.mean(np.sign(pred_close - prev_actual) == np.sign(actual_close - prev_actual)) * 100
            ),
        }
        snapshot.metrics = metrics
        snapshot.status = "evaluated" if len(common_ts) >= snapshot.pred_len else "partial"
        db.commit()
        db.refresh(snapshot)
        return self._detail(snapshot), metrics

    def _detail(self, snapshot: PredictionSnapshot) -> SnapshotDetail:
        candles = sorted(snapshot.candles, key=lambda c: c.timestamp)
        history = [self._from_record(c) for c in candles if c.kind == "history"]
        sample_paths = self._sample_paths(candles)
        return SnapshotDetail(
            **self._summary(snapshot).model_dump(),
            history=history,
            prediction=[self._from_record(c) for c in candles if c.kind == "prediction"],
            sample_paths=sample_paths,
            probability=self._probability_summary(history, sample_paths, snapshot.pred_len) if sample_paths else None,
            actual=[self._from_record(c) for c in candles if c.kind == "actual"],
        )

    @staticmethod
    def _summary(snapshot: PredictionSnapshot) -> SnapshotSummary:
        return SnapshotSummary(
            id=snapshot.id,
            symbol=snapshot.symbol,
            timeframe=snapshot.timeframe,
            exchange=snapshot.exchange,
            model_key=snapshot.model_key,
            status=snapshot.status,
            created_at=snapshot.created_at,
            prediction_start=snapshot.prediction_start,
            prediction_end=snapshot.prediction_end,
            metrics=snapshot.metrics,
        )

    @staticmethod
    def _to_record(snapshot_id: int, kind: str, candle: Candle) -> SnapshotCandle:
        return SnapshotCandle(
            snapshot_id=snapshot_id,
            kind=kind,
            timestamp=SnapshotService._naive(candle.timestamp),
            open=candle.open,
            high=candle.high,
            low=candle.low,
            close=candle.close,
            volume=candle.volume,
            amount=candle.amount,
        )

    @staticmethod
    def _from_record(record: SnapshotCandle) -> Candle:
        return Candle(
            timestamp=record.timestamp,
            open=record.open,
            high=record.high,
            low=record.low,
            close=record.close,
            volume=record.volume,
            amount=record.amount,
        )

    @staticmethod
    def _sample_paths(candles: list[SnapshotCandle]) -> list[list[Candle]]:
        sample_indices = sorted(
            {
                int(candle.kind.removeprefix("sample_"))
                for candle in candles
                if candle.kind.startswith("sample_") and candle.kind.removeprefix("sample_").isdigit()
            }
        )
        return [
            [SnapshotService._from_record(c) for c in candles if c.kind == f"sample_{index}"]
            for index in sample_indices
        ]

    @staticmethod
    def _probability_summary(
        history: list[Candle],
        sample_paths: list[list[Candle]],
        pred_len: int,
    ) -> PredictionProbability:
        last_close = history[-1].close
        terminal_closes = np.array([path[-1].close for path in sample_paths], dtype=float)
        terminal_returns = (terminal_closes / max(last_close, 1e-9) - 1.0) * 100

        historical_closes = np.array([c.close for c in history[-max(pred_len + 1, 2) :]], dtype=float)
        historical_returns = np.diff(historical_closes) / np.maximum(historical_closes[:-1], 1e-9)
        recent_volatility = float(np.std(historical_returns) * 100) if len(historical_returns) else 0.0

        future_volatilities = []
        for path in sample_paths:
            closes = np.array([last_close, *[c.close for c in path]], dtype=float)
            returns = np.diff(closes) / np.maximum(closes[:-1], 1e-9)
            future_volatilities.append(float(np.std(returns) * 100) if len(returns) else 0.0)
        future_volatilities_arr = np.array(future_volatilities, dtype=float)

        return PredictionProbability(
            sample_count=len(sample_paths),
            chance_above_last_close=float(np.mean(terminal_closes > last_close) * 100),
            chance_below_last_close=float(np.mean(terminal_closes < last_close) * 100),
            chance_future_volatility_above_recent=float(np.mean(future_volatilities_arr > recent_volatility) * 100),
            expected_return_pct=float(np.mean(terminal_returns)),
            median_return_pct=float(np.median(terminal_returns)),
            p10_return_pct=float(np.percentile(terminal_returns, 10)),
            p90_return_pct=float(np.percentile(terminal_returns, 90)),
            recent_volatility_pct=recent_volatility,
            median_future_volatility_pct=float(np.median(future_volatilities_arr)),
            target_steps=pred_len,
            target_timestamp=sample_paths[0][-1].timestamp,
        )

    @staticmethod
    def _naive(value):
        if getattr(value, "tzinfo", None):
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
