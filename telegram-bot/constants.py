"""Centralised constants for all external URLs and internal route paths."""
from __future__ import annotations
import os

# ---------------------------------------------------------------------------
# Binance REST
# ---------------------------------------------------------------------------
BINANCE_FUTURES_REST = "https://fapi.binance.com"
BINANCE_SPOT_REST    = "https://api.binance.com"

class BinanceFuturesPaths:
    KLINES           = "/fapi/v1/klines"
    DEPTH            = "/fapi/v1/depth"
    TICKER_24HR      = "/fapi/v1/ticker/24hr"
    TICKER_PRICE     = "/fapi/v1/ticker/price"
    EXCHANGE_INFO    = "/fapi/v1/exchangeInfo"
    OPEN_INTEREST    = "/fapi/v1/openInterest"
    PREMIUM_INDEX    = "/fapi/v1/premiumIndex"
    FUNDING_RATE     = "/fapi/v1/fundingRate"
    LONG_SHORT_RATIO = "/futures/data/globalLongShortAccountRatio"

class BinanceSpotPaths:
    KLINES        = "/api/v3/klines"
    DEPTH         = "/api/v3/depth"
    TICKER_24HR   = "/api/v3/ticker/24hr"
    TICKER_PRICE  = "/api/v3/ticker/price"
    EXCHANGE_INFO = "/api/v3/exchangeInfo"

# ---------------------------------------------------------------------------
# Binance WebSocket
# ---------------------------------------------------------------------------
BINANCE_FUTURES_WS = "wss://fstream.binance.com"
BINANCE_SPOT_WS    = "wss://stream.binance.com:9443"

# ---------------------------------------------------------------------------
# Telegram API
# ---------------------------------------------------------------------------
TELEGRAM_API_BASE = "https://api.telegram.org"

# ---------------------------------------------------------------------------
# Internal bot server  (market_engine → bot HTTP calls)
# ---------------------------------------------------------------------------
BOT_HOST = os.getenv("BOT_HOST", "localhost")
BOT_PORT = int(os.getenv("BOT_PORT", "8888"))
BOT_INTERNAL_URL = os.getenv("BOT_URL", f"http://{BOT_HOST}:{BOT_PORT}")

# ---------------------------------------------------------------------------
# Bot HTTP route paths  (registered in bot.py and referenced by market_engine)
# ---------------------------------------------------------------------------
class BotRoutes:
    ALERT        = "/alert"
    HEALTH       = "/health"
    STATUS       = "/status"
    HISTORY      = "/history"
    CONFIG       = "/config"
    PRICE_ALERTS = "/alerts/price"
    MARKET       = "/market/{market_type}/{symbol}/{timeframe}"
