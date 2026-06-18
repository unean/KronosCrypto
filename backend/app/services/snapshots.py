from datetime import timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import Candle, SnapshotDetail, SnapshotSummary
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
            raise ValueError("Snapshot not found.")
        return self._detail(snapshot)

    def evaluate(self, db: Session, snapshot_id: int, actual: list[Candle]) -> tuple[SnapshotDetail, dict]:
        snapshot = db.get(PredictionSnapshot, snapshot_id)
        if not snapshot:
            raise ValueError("Snapshot not found.")

        prediction = [c for c in snapshot.candles if c.kind == "prediction"]
        predicted_by_ts = {c.timestamp: c for c in prediction}
        actual_by_ts = {self._naive(c.timestamp): c for c in actual}
        common_ts = sorted(set(predicted_by_ts).intersection(actual_by_ts))

        if not common_ts:
            raise ValueError("No overlapping actual candles are available yet.")

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
        prev_actual = np.array([actual_by_ts[ts].open for ts in common_ts], dtype=float)

        metrics = {
            "points": int(len(common_ts)),
            "mae_close": float(np.mean(np.abs(errors))),
            "rmse_close": float(np.sqrt(np.mean(errors**2))),
            "mape_close": float(np.mean(np.abs(errors / np.maximum(actual_close, 1e-9))) * 100),
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
        return SnapshotDetail(
            **self._summary(snapshot).model_dump(),
            history=[self._from_record(c) for c in candles if c.kind == "history"],
            prediction=[self._from_record(c) for c in candles if c.kind == "prediction"],
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
    def _naive(value):
        if getattr(value, "tzinfo", None):
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

