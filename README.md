# Kronos Crypto

Crypto market forecasting UI powered by Kronos.

The app fetches recent closed OHLCV candles, runs Kronos predictions, stores prediction snapshots, and later compares predictions with actual candles.

## Stack

- Backend: FastAPI, ccxt, SQLAlchemy, PyTorch/Kronos
- Frontend: React, TypeScript, Vite, Lightweight Charts
- Storage: SQLite

## Quick Start

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8088
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Network Proxy

The backend automatically applies the current system proxy at application startup. It checks standard proxy environment variables and macOS system proxy settings, then sets process-level `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` variables so external HTTP clients use the same proxy.

## Kronos Code

Kronos is vendored in `backend/vendor/Kronos`, and the backend imports it from there by default.
To use a different checkout, override it with:

```bash
export KRONOS_CRYPTO_KRONOS_REPO_PATH=/path/to/Kronos
```
