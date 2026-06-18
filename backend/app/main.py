from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.proxy import apply_system_proxy

apply_system_proxy()

from app.api.routes import router
from app.core.config import settings
from app.core.database import Base, engine
from app.models import snapshot  # noqa: F401


Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.app_name)


FIELD_LABELS = {
    "exchange": "交易所",
    "symbol": "交易对",
    "timeframe": "周期",
    "limit": "K 线数量",
    "lookback": "历史 K 线数",
    "pred_len": "预测步数",
    "model_key": "模型",
    "device": "设备",
    "temperature": "温度",
    "top_p": "Top P",
    "sample_count": "采样路径数",
    "save_snapshot": "保存快照",
    "ids": "快照 ID",
}


def _validation_message(error: dict) -> str:
    field = next((part for part in reversed(error.get("loc", ())) if isinstance(part, str)), "输入")
    label = FIELD_LABELS.get(field, field)
    error_type = error.get("type")
    ctx = error.get("ctx") or {}

    if error_type == "less_than_equal":
        return f"{label}必须小于或等于 {ctx.get('le')}"
    if error_type == "greater_than_equal":
        return f"{label}必须大于或等于 {ctx.get('ge')}"
    if error_type in {"int_parsing", "float_parsing"}:
        return f"{label}必须是数字"
    if error_type == "literal_error":
        return f"{label}不是支持的选项"
    if error_type == "missing":
        return f"缺少必填字段：{label}"
    if error_type == "too_short":
        return f"{label}不能为空"
    return f"{label}输入不合法"


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "；".join(_validation_message(error) for error in exc.errors())},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")
