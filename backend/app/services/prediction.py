import sys
from dataclasses import dataclass
from datetime import datetime

import pandas as pd

from app.api.schemas import Candle
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
    ) -> list[Candle]:
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

        pred_df = predictor.predict(
            df=x_df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=pred_len,
            T=temperature,
            top_p=top_p,
            sample_count=sample_count,
            verbose=False,
        )

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
        return self._stitch_predictions(
            sorted(predictions, key=lambda candle: candle.timestamp),
            last_close=history[-1].close,
        )

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
    def _future_timestamps(last_timestamp: datetime, timeframe: str, pred_len: int) -> pd.DatetimeIndex:
        freq_map = {"15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d"}
        return pd.date_range(
            start=pd.Timestamp(last_timestamp) + pd.Timedelta(freq_map[timeframe]),
            periods=pred_len,
            freq=freq_map[timeframe],
        )
