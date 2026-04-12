"""Tests for bot._validate_alert — the boundary-validation helper used by
handle_post_price_alert before appending any externally-supplied alert to config."""
import os
import sys
import types
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

# Stub heavy optional deps so bot.py can be imported in test isolation
# bot.py exits if these env vars are absent — set dummies before importing
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_CHAT_ID", "123456")

for _mod, _stub in [
    ("websockets", {"connect": None}),
    ("pandas", {"DataFrame": None, "Series": None}),
    ("numpy", {"errstate": None, "isnan": None, "maximum": None}),
    ("yaml", {"safe_load": None}),
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = types.SimpleNamespace(**_stub)

# aiohttp needs richer stubs so `from aiohttp import web, ClientSession, ClientError` works
if "aiohttp" not in sys.modules:
    _web = types.SimpleNamespace(
        Application=None, RouteTableDef=None,
        json_response=None, Response=None, Request=None,
        AppRunner=None, TCPSite=None,
        middleware=lambda f: f,
    )
    sys.modules["aiohttp"] = types.SimpleNamespace(
        web=_web,
        ClientSession=None,
        ClientError=Exception,
        ClientTimeout=None,
    )
    sys.modules["aiohttp.web"] = _web

from bot import _validate_alert  # noqa: E402


def _valid() -> dict:
    """Minimal valid alert."""
    return {
        "id": "abc12345",
        "symbol": "BTCUSDT",
        "price": 105000.0,
        "direction": "ABOVE",
        "market_type": "futures",
        "createdAt": 1712000000000,
    }


class ValidateAlertTests(unittest.TestCase):
    # ------------------------------------------------------------------
    # Happy-path
    # ------------------------------------------------------------------

    def test_valid_alert_returns_none(self):
        self.assertIsNone(_validate_alert(_valid()))

    def test_optional_fields_may_be_absent(self):
        a = {"id": "x1", "symbol": "ETHUSDT", "price": 2500.0}
        self.assertIsNone(_validate_alert(a))

    def test_direction_cross_is_accepted(self):
        a = _valid()
        a["direction"] = "CROSS"
        self.assertIsNone(_validate_alert(a))

    def test_spot_market_type_is_accepted(self):
        a = _valid()
        a["market_type"] = "spot"
        self.assertIsNone(_validate_alert(a))

    def test_market_type_none_is_accepted(self):
        a = _valid()
        a["market_type"] = None
        self.assertIsNone(_validate_alert(a))

    def test_price_as_string_number_is_accepted(self):
        """price may arrive as a string from JSON-decoded payload."""
        a = _valid()
        a["price"] = "105000"
        self.assertIsNone(_validate_alert(a))

    # ------------------------------------------------------------------
    # Missing required fields
    # ------------------------------------------------------------------

    def test_missing_id_returns_error(self):
        a = _valid()
        del a["id"]
        err = _validate_alert(a)
        self.assertIsNotNone(err)
        self.assertIn("id", err)

    def test_missing_symbol_returns_error(self):
        a = _valid()
        del a["symbol"]
        err = _validate_alert(a)
        self.assertIsNotNone(err)
        self.assertIn("symbol", err)

    def test_missing_price_returns_error(self):
        a = _valid()
        del a["price"]
        err = _validate_alert(a)
        self.assertIsNotNone(err)
        self.assertIn("price", err)

    # ------------------------------------------------------------------
    # id validation
    # ------------------------------------------------------------------

    def test_empty_string_id_returns_error(self):
        a = _valid()
        a["id"] = ""
        self.assertIsNotNone(_validate_alert(a))

    def test_non_string_id_returns_error(self):
        a = _valid()
        a["id"] = 123
        self.assertIsNotNone(_validate_alert(a))

    # ------------------------------------------------------------------
    # symbol validation
    # ------------------------------------------------------------------

    def test_lowercase_symbol_returns_error(self):
        a = _valid()
        a["symbol"] = "btcusdt"
        err = _validate_alert(a)
        self.assertIsNotNone(err)
        self.assertIn("symbol", err.lower())

    def test_too_short_symbol_returns_error(self):
        a = _valid()
        a["symbol"] = "BTC"
        self.assertIsNotNone(_validate_alert(a))

    def test_special_chars_in_symbol_returns_error(self):
        a = _valid()
        a["symbol"] = "BTC/USDT"
        self.assertIsNotNone(_validate_alert(a))

    def test_four_char_symbol_is_rejected(self):
        """Min length is 5, matching frontend VALID_SYMBOL_RE and commands/alert.py."""
        a = _valid()
        a["symbol"] = "BTCX"
        self.assertIsNotNone(_validate_alert(a))

    def test_five_char_symbol_is_accepted(self):
        a = _valid()
        a["symbol"] = "BTCXZ"
        self.assertIsNone(_validate_alert(a))

    # ------------------------------------------------------------------
    # price validation
    # ------------------------------------------------------------------

    def test_zero_price_returns_error(self):
        a = _valid()
        a["price"] = 0
        self.assertIsNotNone(_validate_alert(a))

    def test_negative_price_returns_error(self):
        a = _valid()
        a["price"] = -1000
        self.assertIsNotNone(_validate_alert(a))

    def test_string_non_numeric_price_returns_error(self):
        a = _valid()
        a["price"] = "not_a_number"
        self.assertIsNotNone(_validate_alert(a))

    def test_none_price_returns_error(self):
        a = _valid()
        a["price"] = None
        self.assertIsNotNone(_validate_alert(a))

    # ------------------------------------------------------------------
    # direction validation
    # ------------------------------------------------------------------

    def test_invalid_direction_returns_error(self):
        a = _valid()
        a["direction"] = "SIDEWAYS"
        err = _validate_alert(a)
        self.assertIsNotNone(err)
        self.assertIn("direction", err.lower())

    def test_absent_direction_is_accepted(self):
        a = _valid()
        del a["direction"]
        self.assertIsNone(_validate_alert(a))

    # ------------------------------------------------------------------
    # market_type validation
    # ------------------------------------------------------------------

    def test_invalid_market_type_returns_error(self):
        a = _valid()
        a["market_type"] = "perpetual"
        err = _validate_alert(a)
        self.assertIsNotNone(err)
        self.assertIn("market_type", err.lower())

    def test_absent_market_type_is_accepted(self):
        a = _valid()
        del a["market_type"]
        self.assertIsNone(_validate_alert(a))


if __name__ == "__main__":
    unittest.main()
