import sys
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd

from app.api.schemas import Candle, PredictionProbability
from app.core.config import settings


MODEL_CONFIGS = {
    "kronos-mini": {
        "model_id": "NeoQuasar/Kronos-mini",
        "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-2k",
        "context_length": 2048,
    },
    "kronos-small": {
        "model_id": "NeoQuasar/Kronos-small",
        "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-base",
        "context_length": 512,
    },
    "kronos-base": {
        "model_id": "NeoQuasar/Kronos-base",
        "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-base",
        "context_length": 512,
    },
}


@dataclass
class LoadedModel:
    key: str
    device: str
    predictor: object


@dataclass
class PredictionResult:
    prediction: list[Candle]
    sample_paths: list[list[Candle]]
    probability: PredictionProbability


class PredictionService:
    def __init__(self):
        self.loaded: LoadedModel | None = None

    def predict(
        self,
        candles: list[Candle],
        timeframe: str,
        lookback: int,
        pred_len: int,
        model_key: str,
        device: str,
        temperature: float,
        top_p: float,
        sample_count: int,
    ) -> PredictionResult:
        if len(candles) < lookback:
            raise ValueError(f"Need at least {lookback} closed candles, got {len(candles)}.")

        predictor = self._get_predictor(model_key, device)
        history = candles[-lookback:]
        df = pd.DataFrame([c.model_dump() for c in history])
        df["timestamps"] = pd.to_datetime(df["timestamp"], utc=True).dt.tz_convert(None)
        x_df = df[["open", "high", "low", "close", "volume", "amount"]]
        x_timestamp = df["timestamps"]

        prediction_timestamps = self._future_timestamps(x_timestamp.iloc[-1], timeframe, pred_len)
        y_timestamp = pd.Series(prediction_timestamps, name="timestamps")

        sample_paths: list[list[Candle]] = []
        for _ in range(sample_count):
            pred_df = predictor.predict(
                df=x_df,
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=pred_len,
                T=temperature,
                top_p=top_p,
                sample_count=1,
                verbose=False,
            )
            sample_paths.append(
                self._stitch_predictions(
                    self._df_to_candles(pred_df),
                    last_close=history[-1].close,
                )
            )

        prediction = self._mean_path(sample_paths)
        probability = self._probability_summary(
            history=history,
            sample_paths=sample_paths,
            pred_len=pred_len,
        )
        return PredictionResult(prediction=prediction, sample_paths=sample_paths, probability=probability)

    def _get_predictor(self, model_key: str, device: str):
        if self.loaded and self.loaded.key == model_key and self.loaded.device == device:
            return self.loaded.predictor

        if str(settings.kronos_repo_path) not in sys.path:
            sys.path.insert(0, str(settings.kronos_repo_path))

        from model import Kronos, KronosPredictor, KronosTokenizer

        config = MODEL_CONFIGS[model_key]
        tokenizer = KronosTokenizer.from_pretrained(config["tokenizer_id"])
        model = Kronos.from_pretrained(config["model_id"])
        predictor = KronosPredictor(
            model,
            tokenizer,
            device=device,
            max_context=config["context_length"],
        )
        self.loaded = LoadedModel(model_key, device, predictor)
        return predictor

    @staticmethod
    def _stitch_predictions(predictions: list[Candle], last_close: float) -> list[Candle]:
        previous_close = last_close
        stitched: list[Candle] = []

        for candle in predictions:
            open_ = previous_close
            high = max(candle.high, open_, candle.close)
            low = min(candle.low, open_, candle.close)
            stitched_candle = candle.model_copy(update={"open": open_, "high": high, "low": low})
            stitched.append(stitched_candle)
            previous_close = stitched_candle.close

        return stitched

    @staticmethod
    def _df_to_candles(pred_df: pd.DataFrame) -> list[Candle]:
        predictions: list[Candle] = []
        for timestamp, row in pred_df.iterrows():
            predictions.append(
                Candle(
                    timestamp=pd.Timestamp(timestamp).to_pydatetime(),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=float(row.get("volume", 0.0)),
                    amount=float(row.get("amount", 0.0)),
                )
            )
        return sorted(predictions, key=lambda candle: candle.timestamp)

    @staticmethod
    def _mean_path(sample_paths: list[list[Candle]]) -> list[Candle]:
        if not sample_paths:
            return []

        mean_path: list[Candle] = []
        for step in range(len(sample_paths[0])):
            candles = [path[step] for path in sample_paths]
            mean_path.append(
                Candle(
                    timestamp=candles[0].timestamp,
                    open=float(np.mean([c.open for c in candles])),
                    high=float(np.mean([c.high for c in candles])),
                    low=float(np.mean([c.low for c in candles])),
                    close=float(np.mean([c.close for c in candles])),
                    volume=float(np.mean([c.volume for c in candles])),
                    amount=float(np.mean([c.amount for c in candles])),
                )
            )
        return mean_path

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
    def _future_timestamps(last_timestamp: datetime, timeframe: str, pred_len: int) -> pd.DatetimeIndex:
        freq_map = {"15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d"}
        return pd.date_range(
            start=pd.Timestamp(last_timestamp) + pd.Timedelta(freq_map[timeframe]),
            periods=pred_len,
            freq=freq_map[timeframe],
        )
