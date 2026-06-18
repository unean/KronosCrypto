from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.proxy import apply_system_proxy

apply_system_proxy()

from app.api.routes import router
from app.core.config import settings
from app.core.database import Base, engine
from app.models import snapshot  # noqa: F401


Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")
