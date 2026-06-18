from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Kronos Crypto"
    database_url: str = "sqlite:///./kronos_crypto.db"
    default_exchange: str = "binance"
    kronos_repo_path: Path = BACKEND_ROOT / "vendor" / "Kronos"
    data_dir: Path = Path("../data")
    snapshot_dir: Path = Path("../snapshots")
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    model_config = SettingsConfigDict(env_prefix="KRONOS_CRYPTO_")


settings = Settings()
