from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Timeframe = Literal["15m", "1h", "4h", "1d"]


class Candle(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    amount: float = 0.0


class MarketOption(BaseModel):
    symbol: str
    label: str


class OhlcvRequest(BaseModel):
    symbol: str = "ETH/USDT"
    timeframe: Timeframe = "15m"
    limit: int = Field(default=520, ge=10, le=1500)
    exchange: str = "binance"


class PredictRequest(BaseModel):
    symbol: str = "ETH/USDT"
    timeframe: Timeframe = "15m"
    exchange: str = "binance"
    lookback: int = Field(default=400, ge=32, le=2048)
    pred_len: int = Field(default=96, ge=1, le=240)
    model_key: str = "kronos-base"
    device: str = "cpu"
    temperature: float = Field(default=1.0, ge=0.1, le=2.0)
    top_p: float = Field(default=0.9, ge=0.1, le=1.0)
    sample_count: int = Field(default=1, ge=1, le=5)
    save_snapshot: bool = True


class PredictResponse(BaseModel):
    snapshot_id: int | None = None
    symbol: str
    timeframe: str
    history: list[Candle]
    prediction: list[Candle]
    input_start: datetime
    input_end: datetime
    prediction_start: datetime
    prediction_end: datetime


class SnapshotSummary(BaseModel):
    id: int
    symbol: str
    timeframe: str
    exchange: str
    model_key: str
    status: str
    created_at: datetime
    prediction_start: datetime
    prediction_end: datetime
    metrics: dict | None = None


class SnapshotDetail(SnapshotSummary):
    history: list[Candle]
    prediction: list[Candle]
    actual: list[Candle]


class EvaluateResponse(BaseModel):
    snapshot: SnapshotDetail
    metrics: dict
