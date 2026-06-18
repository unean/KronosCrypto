from datetime import datetime, timezone

import ccxt
import pandas as pd

from app.api.schemas import Candle


class MarketDataService:
    def __init__(self, exchange_id: str = "binance"):
        exchange_cls = getattr(ccxt, exchange_id)
        exchange_config = {"enableRateLimit": True}
        if exchange_id == "okx":
            exchange_config["options"] = {"defaultType": "spot", "fetchMarkets": ["spot"]}
        self.exchange = exchange_cls(exchange_config)
        if exchange_id == "okx":
            self._filter_okx_unlisted_markets()
        self.exchange_id = exchange_id

    def list_markets(self) -> list[dict[str, str]]:
        return [
            {"symbol": "BTC/USDT", "label": "Bitcoin / USDT"},
            {"symbol": "ETH/USDT", "label": "Ethereum / USDT"},
            {"symbol": "SOL/USDT", "label": "Solana / USDT"},
            {"symbol": "BNB/USDT", "label": "BNB / USDT"},
        ]

    def list_exchanges(self) -> list[dict[str, str]]:
        return [
            {"id": "binance", "label": "Binance"},
            {"id": "okx", "label": "OKX"},
            {"id": "bybit", "label": "Bybit"},
        ]

    def fetch_closed_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        raw = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit + 1)
        if not raw:
            return []

        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        timeframe_ms = self._timeframe_to_ms(timeframe)
        closed = [row for row in raw if row[0] + timeframe_ms <= now_ms]
        closed = closed[-limit:]

        candles: list[Candle] = []
        for timestamp_ms, open_, high, low, close, volume in closed:
            avg_price = (open_ + high + low + close) / 4
            candles.append(
                Candle(
                    timestamp=datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc),
                    open=float(open_),
                    high=float(high),
                    low=float(low),
                    close=float(close),
                    volume=float(volume or 0.0),
                    amount=float((volume or 0.0) * avg_price),
                )
            )
        return candles

    def candles_to_frame(self, candles: list[Candle]) -> pd.DataFrame:
        return pd.DataFrame([c.model_dump() for c in candles])

    def _filter_okx_unlisted_markets(self) -> None:
        parse_markets = self.exchange.parse_markets

        def parse_listed_markets(markets):
            listed_markets = [
                market
                for market in markets
                if market.get("baseCcy") and market.get("quoteCcy")
            ]
            return parse_markets(listed_markets)

        self.exchange.parse_markets = parse_listed_markets

    @staticmethod
    def _timeframe_to_ms(timeframe: str) -> int:
        unit = timeframe[-1]
        value = int(timeframe[:-1])
        if unit == "m":
            return value * 60 * 1000
        if unit == "h":
            return value * 60 * 60 * 1000
        if unit == "d":
            return value * 24 * 60 * 60 * 1000
        raise ValueError(f"Unsupported timeframe: {timeframe}")
