from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import traceback

from app.api.schemas import (
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
        candles = service.fetch_closed_ohlcv(request.symbol, request.timeframe, request.limit)
        return {"candles": candles}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest, db: Session = Depends(get_db)):
    try:
        limit = max(request.lookback + 5, request.lookback)
        market_service = MarketDataService(request.exchange)
        candles = market_service.fetch_closed_ohlcv(request.symbol, request.timeframe, limit)
        history = candles[-request.lookback :]
        result = prediction_service.predict(
            candles=candles,
            timeframe=request.timeframe,
            lookback=request.lookback,
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
                lookback=request.lookback,
                pred_len=request.pred_len,
                history=history,
                prediction=prediction,
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
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/snapshots", response_model=list[SnapshotSummary])
def list_snapshots(db: Session = Depends(get_db)):
    return snapshot_service.list_snapshots(db)


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDetail)
def get_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    try:
        return snapshot_service.get_snapshot(db, snapshot_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/snapshots/{snapshot_id}/evaluate", response_model=EvaluateResponse)
def evaluate_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    try:
        snapshot = db.get(PredictionSnapshot, snapshot_id)
        if not snapshot:
            raise ValueError("Snapshot not found.")
        market_service = MarketDataService(snapshot.exchange)
        limit = snapshot.pred_len + 10
        actual = market_service.fetch_closed_ohlcv(snapshot.symbol, snapshot.timeframe, limit)
        detail, metrics = snapshot_service.evaluate(db, snapshot_id, actual)
        return EvaluateResponse(snapshot=detail, metrics=metrics)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
