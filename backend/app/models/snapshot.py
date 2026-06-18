from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PredictionSnapshot(Base):
    __tablename__ = "prediction_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    timeframe: Mapped[str] = mapped_column(String(8), index=True)
    exchange: Mapped[str] = mapped_column(String(32), index=True)
    model_key: Mapped[str] = mapped_column(String(64))
    device: Mapped[str] = mapped_column(String(32))
    lookback: Mapped[int] = mapped_column(Integer)
    pred_len: Mapped[int] = mapped_column(Integer)
    input_start: Mapped[datetime] = mapped_column(DateTime)
    input_end: Mapped[datetime] = mapped_column(DateTime)
    prediction_start: Mapped[datetime] = mapped_column(DateTime)
    prediction_end: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    candles: Mapped[list["SnapshotCandle"]] = relationship(
        back_populates="snapshot",
        cascade="all, delete-orphan",
    )


class SnapshotCandle(Base):
    __tablename__ = "snapshot_candles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("prediction_snapshots.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float, default=0.0)
    amount: Mapped[float] = mapped_column(Float, default=0.0)

    snapshot: Mapped[PredictionSnapshot] = relationship(back_populates="candles")

