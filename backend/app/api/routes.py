from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import traceback

from app.api.schemas import (
    DeleteSnapshotsRequest,
    EvaluateResponse,
    OhlcvRequest,
    PredictRequest,
    PredictResponse,
    SnapshotDetail,
    SnapshotSummary,
)
from app.core.database import get_db
from app.models.snapshot import PredictionSnapshot
from app.services.market_data import MarketDataService
from app.services.prediction import MODEL_CONFIGS, PredictionService
from app.services.snapshots import SnapshotService

router = APIRouter()
prediction_service = PredictionService()
snapshot_service = SnapshotService()


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/markets")
def markets(exchange: str = "binance"):
    service = MarketDataService(exchange)
    return {
        "exchange": exchange,
        "exchanges": service.list_exchanges(),
        "markets": service.list_markets(),
        "timeframes": ["15m", "1h", "4h", "1d"],
        "models": list(MODEL_CONFIGS.keys()),
        "default_pred_len": {"15m": 48, "1h": 36, "4h": 21, "1d": 15},
    }


@router.post("/ohlcv")
def ohlcv(request: OhlcvRequest):
    try:
        service = MarketDataService(request.exchange)
        if request.start_time or request.end_time:
            if not request.start_time or not request.end_time:
                raise ValueError("按时间段拉取时必须同时提供开始时间和结束时间。")
            candles = service.fetch_closed_ohlcv_range(
                request.symbol,
                request.timeframe,
                request.start_time,
                request.end_time,
            )
        else:
            candles = service.fetch_closed_ohlcv(request.symbol, request.timeframe, request.limit)
        return {"candles": candles}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest, db: Session = Depends(get_db)):
    try:
        effective_lookback = request.lookback
        if request.candles is not None:
            candles = sorted(request.candles, key=lambda candle: candle.timestamp)
            effective_lookback = min(request.lookback, len(candles))
            if effective_lookback < 32:
                raise ValueError(f"至少需要 32 根已收盘 K 线，当前只有 {len(candles)} 根。")
        else:
            limit = max(request.lookback + 5, request.lookback)
            market_service = MarketDataService(request.exchange)
            candles = market_service.fetch_closed_ohlcv(request.symbol, request.timeframe, limit)

        history = candles[-effective_lookback :]
        result = prediction_service.predict(
            candles=candles,
            timeframe=request.timeframe,
            lookback=effective_lookback,
            pred_len=request.pred_len,
            model_key=request.model_key,
            device=request.device,
            temperature=request.temperature,
            top_p=request.top_p,
            sample_count=request.sample_count,
        )
        prediction = result.prediction

        snapshot_id = None
        if request.save_snapshot:
            snapshot = snapshot_service.create_snapshot(
                db=db,
                symbol=request.symbol,
                timeframe=request.timeframe,
                exchange=request.exchange,
                model_key=request.model_key,
                device=request.device,
                lookback=effective_lookback,
                pred_len=request.pred_len,
                history=history,
                prediction=prediction,
                sample_paths=result.sample_paths,
            )
            snapshot_id = snapshot.id

        return PredictResponse(
            snapshot_id=snapshot_id,
            symbol=request.symbol,
            timeframe=request.timeframe,
            history=history,
            prediction=prediction,
            sample_paths=result.sample_paths,
            probability=result.probability,
            input_start=history[0].timestamp,
            input_end=history[-1].timestamp,
            prediction_start=prediction[0].timestamp,
            prediction_end=prediction[-1].timestamp,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/snapshots", response_model=list[SnapshotSummary])
def list_snapshots(db: Session = Depends(get_db)):
    return snapshot_service.list_snapshots(db)


@router.post("/snapshots/delete")
def delete_snapshots(request: DeleteSnapshotsRequest, db: Session = Depends(get_db)):
    deleted = snapshot_service.delete_snapshots(db, request.ids)
    return {"ok": True, "deleted": deleted}


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDetail)
def get_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    try:
        return snapshot_service.get_snapshot(db, snapshot_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/snapshots/{snapshot_id}")
def delete_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    try:
        snapshot_service.delete_snapshot(db, snapshot_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/snapshots/{snapshot_id}/evaluate", response_model=EvaluateResponse)
def evaluate_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    try:
        snapshot = db.get(PredictionSnapshot, snapshot_id)
        if not snapshot:
            raise ValueError("快照不存在。")
        market_service = MarketDataService(snapshot.exchange)
        limit = snapshot.pred_len + 10
        actual = market_service.fetch_closed_ohlcv(snapshot.symbol, snapshot.timeframe, limit)
        detail, metrics = snapshot_service.evaluate(db, snapshot_id, actual)
        return EvaluateResponse(snapshot=detail, metrics=metrics)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
