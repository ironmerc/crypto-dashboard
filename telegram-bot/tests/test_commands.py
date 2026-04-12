"""
Tests for the commands package:
  - commands/__init__.py  (registry + pending state)
  - commands/alert.py     (pure helpers + full conversational flows)
"""
import os
import sys
import time
import types
import unittest
from unittest.mock import AsyncMock, MagicMock

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

# Stub heavy optional deps before any import that might pull them in
for _mod in ("websockets", "pandas", "numpy"):
    if _mod not in sys.modules:
        sys.modules[_mod] = types.ModuleType(_mod)

# Minimal aiohttp stub so commands/alert.py imports cleanly
if "aiohttp" not in sys.modules:
    _aiohttp = types.ModuleType("aiohttp")
    _aiohttp.ClientSession = MagicMock
    _aiohttp.ClientError = Exception
    sys.modules["aiohttp"] = _aiohttp

import commands  # noqa: E402
from commands import (  # noqa: E402
    PENDING_STATE_EXPIRY_SEC,
    _BOT_COMMANDS,
    _STEP_REGISTRIES,
    _pending_state,
    clear_pending,
    cleanup_expired_loop,
    get_pending,
    register_command,
    set_pending,
)
from commands.alert import _fmt_alert, _is_valid_symbol, _normalize_symbol, setup  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers shared by all test classes
# ---------------------------------------------------------------------------

def _make_message(text: str, chat_id: int = 12345, message_id: int = 1) -> dict:
    return {
        "chat": {"id": chat_id},
        "text": text,
        "message_id": message_id,
    }


class MockBotContext:
    """Stand-in for bot.BotContext; records all interactions."""

    def __init__(self, config=None, engine=None):
        self._config = config if config is not None else {
            "monitoredSymbols": [],
            "priceAlerts": [],
        }
        self._engine = engine
        self.saves = 0
        self.reloads = 0
        self.replies: list[str] = []

    @property
    def config(self) -> dict:
        return self._config

    @property
    def engine(self):
        return self._engine

    def save(self):
        self.saves += 1

    def reload(self):
        self.reloads += 1

    async def reply(self, session, text: str, reply_to_message_id=None):
        self.replies.append(text)


def _fresh_ctx(**kwargs) -> MockBotContext:
    """Return a MockBotContext and register /alert + /alerts against it."""
    ctx = MockBotContext(**kwargs)
    setup(ctx)
    return ctx


def _steps(cmd: str = "alert") -> dict:
    return _STEP_REGISTRIES.get(cmd, {})


def _clear_all_pending():
    _pending_state.clear()


# ---------------------------------------------------------------------------
# 1. Registry + pending-state unit tests
# ---------------------------------------------------------------------------

class TestCommandRegistry(unittest.TestCase):

    def setUp(self):
        _clear_all_pending()

    def test_register_command_stores_handler(self):
        async def _fake_handler(session, message): ...
        register_command("_test_cmd", _fake_handler)
        self.assertIs(_BOT_COMMANDS["_test_cmd"], _fake_handler)

    def test_register_command_stores_steps(self):
        async def _h(session, message): ...
        async def _s(chat_id, text, session, message): ...
        register_command("_test_cmd2", _h, steps={"mystep": _s})
        self.assertIs(_STEP_REGISTRIES["_test_cmd2"]["mystep"], _s)

    def test_set_and_get_pending(self):
        set_pending("chat1", {"step": "menu", "command": "alert"})
        state = get_pending("chat1")
        self.assertIsNotNone(state)
        self.assertEqual(state["step"], "menu")

    def test_get_pending_returns_none_for_unknown_chat(self):
        self.assertIsNone(get_pending("nonexistent"))

    def test_set_pending_merges_updates(self):
        set_pending("chat2", {"command": "alert", "step": "menu"})
        set_pending("chat2", {"step": "pick_symbol", "extra": "x"})
        state = get_pending("chat2")
        self.assertEqual(state["step"], "pick_symbol")
        self.assertEqual(state["command"], "alert")
        self.assertEqual(state["extra"], "x")

    def test_clear_pending_removes_state(self):
        set_pending("chat3", {"step": "menu"})
        clear_pending("chat3")
        self.assertIsNone(get_pending("chat3"))

    def test_get_pending_returns_none_after_expiry(self):
        set_pending("chat4", {"step": "menu"})
        _pending_state["chat4"]["expires_at"] = time.time() - 1  # already expired
        self.assertIsNone(get_pending("chat4"))

    def test_set_pending_refreshes_expiry(self):
        set_pending("chat5", {"step": "menu"})
        _pending_state["chat5"]["expires_at"] = time.time() - 1  # force expiry
        # A second set_pending should revive it
        set_pending("chat5", {"step": "pick_symbol"})
        state = get_pending("chat5")
        self.assertIsNotNone(state)
        self.assertEqual(state["step"], "pick_symbol")


class TestCleanupExpiredLoop(unittest.IsolatedAsyncioTestCase):

    async def test_cleanup_removes_expired_entries(self):
        import asyncio
        set_pending("old_chat", {"step": "menu"})
        _pending_state["old_chat"]["expires_at"] = time.time() - 1

        # Run one iteration of the loop by patching sleep so it fires once then cancels
        call_count = 0

        async def fast_sleep(_):
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise asyncio.CancelledError

        import commands as _commands_mod
        original_sleep = _commands_mod.asyncio.sleep
        _commands_mod.asyncio.sleep = fast_sleep
        try:
            await cleanup_expired_loop()
        except asyncio.CancelledError:
            pass
        finally:
            _commands_mod.asyncio.sleep = original_sleep

        self.assertIsNone(get_pending("old_chat"))


# ---------------------------------------------------------------------------
# 2. Pure-helper unit tests (no context needed)
# ---------------------------------------------------------------------------

class TestAlertPureHelpers(unittest.TestCase):

    # _normalize_symbol
    def test_normalize_uppercases(self):
        self.assertEqual(_normalize_symbol("btc"), "BTCUSDT")

    def test_normalize_short_appends_usdt(self):
        self.assertEqual(_normalize_symbol("ETH"), "ETHUSDT")

    def test_normalize_already_usdt_unchanged(self):
        self.assertEqual(_normalize_symbol("solusdt"), "SOLUSDT")

    def test_normalize_six_char_no_append(self):
        # 6 chars, no USDT suffix → NOT appended (len > 5)
        self.assertEqual(_normalize_symbol("XRPBTC"), "XRPBTC")

    # _is_valid_symbol
    def test_valid_symbol_passes(self):
        self.assertTrue(_is_valid_symbol("BTCUSDT"))
        self.assertTrue(_is_valid_symbol("ETHUSDT"))
        self.assertTrue(_is_valid_symbol("SOLUSDT"))

    def test_invalid_symbol_too_short(self):
        self.assertFalse(_is_valid_symbol("BTC"))

    def test_invalid_symbol_lowercase(self):
        self.assertFalse(_is_valid_symbol("btcusdt"))

    def test_invalid_symbol_special_chars(self):
        self.assertFalse(_is_valid_symbol("BTC/USD"))

    # _fmt_alert
    def test_fmt_alert_uses_direction(self):
        a = {"symbol": "BTCUSDT", "price": 105000.0, "direction": "ABOVE"}
        self.assertEqual(_fmt_alert(a), "<b>BTCUSDT</b> $105,000 ABOVE")

    def test_fmt_alert_falls_back_to_side(self):
        a = {"symbol": "ETHUSDT", "price": 2500.0, "side": "NEUTRAL"}
        self.assertEqual(_fmt_alert(a), "<b>ETHUSDT</b> $2,500 NEUTRAL")

    def test_fmt_alert_missing_both_direction_and_side(self):
        a = {"symbol": "SOLUSDT", "price": 140.0}
        self.assertIn("?", _fmt_alert(a))


# ---------------------------------------------------------------------------
# 3. Conversational flow tests
# ---------------------------------------------------------------------------

class TestAlertFlows(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        _clear_all_pending()

    # -- /alert entry point --------------------------------------------------

    async def test_alert_command_shows_menu(self):
        ctx = _fresh_ctx()
        session = MagicMock()
        msg = _make_message("/alert")
        await _BOT_COMMANDS["alert"](session, msg)
        self.assertIn("Alert management", ctx.replies[-1])
        state = get_pending("12345")
        self.assertEqual(state["step"], "menu")
        self.assertEqual(state["command"], "alert")

    # -- menu step -----------------------------------------------------------

    async def test_menu_step_1_shows_symbol_list(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [
                {"symbol": "BTCUSDT", "type": "futures"},
                {"symbol": "ETHUSDT", "type": "futures"},
            ],
            "priceAlerts": [],
        })
        set_pending("12345", {"command": "alert", "step": "menu"})
        session = MagicMock()
        await _steps()["menu"]("12345", "1", session, _make_message("1"))
        reply = ctx.replies[-1]
        self.assertIn("BTCUSDT", reply)
        self.assertIn("ETHUSDT", reply)
        self.assertIn("Add new symbol", reply)
        self.assertEqual(get_pending("12345")["step"], "pick_symbol")

    async def test_menu_step_2_no_alerts_clears_state(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        set_pending("12345", {"command": "alert", "step": "menu"})
        session = MagicMock()
        await _steps()["menu"]("12345", "2", session, _make_message("2"))
        self.assertIn("No active alerts", ctx.replies[-1])
        self.assertIsNone(get_pending("12345"))

    async def test_menu_step_2_shows_alert_list(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [],
            "priceAlerts": [
                {"id": "aa", "symbol": "BTCUSDT", "price": 105000.0, "direction": "ABOVE"},
            ],
        })
        set_pending("12345", {"command": "alert", "step": "menu"})
        session = MagicMock()
        await _steps()["menu"]("12345", "2", session, _make_message("2"))
        reply = ctx.replies[-1]
        self.assertIn("BTCUSDT", reply)
        self.assertEqual(get_pending("12345")["step"], "remove_pick")

    async def test_menu_invalid_input_keeps_state(self):
        ctx = _fresh_ctx()
        set_pending("12345", {"command": "alert", "step": "menu"})
        session = MagicMock()
        await _steps()["menu"]("12345", "9", session, _make_message("9"))
        self.assertIn("1", ctx.replies[-1])
        self.assertEqual(get_pending("12345")["step"], "menu")

    # -- pick_symbol step ----------------------------------------------------

    async def test_pick_symbol_by_index_goes_to_ask_price(self):
        ctx = _fresh_ctx()
        snapshot = [{"symbol": "BTCUSDT", "type": "futures"}]
        set_pending("12345", {"command": "alert", "step": "pick_symbol", "symbols_snapshot": snapshot})
        session = MagicMock()
        await _steps()["pick_symbol"]("12345", "1", session, _make_message("1"))
        state = get_pending("12345")
        self.assertEqual(state["step"], "ask_price")
        self.assertEqual(state["symbol"], "BTCUSDT")
        self.assertFalse(state["is_new"])

    async def test_pick_symbol_0_goes_to_ask_new_symbol(self):
        ctx = _fresh_ctx()
        set_pending("12345", {"command": "alert", "step": "pick_symbol", "symbols_snapshot": []})
        session = MagicMock()
        await _steps()["pick_symbol"]("12345", "0", session, _make_message("0"))
        self.assertEqual(get_pending("12345")["step"], "ask_new_symbol")

    async def test_pick_symbol_out_of_range_keeps_state(self):
        ctx = _fresh_ctx()
        snapshot = [{"symbol": "BTCUSDT", "type": "futures"}]
        set_pending("12345", {"command": "alert", "step": "pick_symbol", "symbols_snapshot": snapshot})
        session = MagicMock()
        await _steps()["pick_symbol"]("12345", "99", session, _make_message("99"))
        self.assertEqual(get_pending("12345")["step"], "pick_symbol")

    # -- ask_new_symbol step -------------------------------------------------

    async def test_ask_new_symbol_normalizes_and_asks_market_type_when_new(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        set_pending("12345", {"command": "alert", "step": "ask_new_symbol"})
        session = MagicMock()
        await _steps()["ask_new_symbol"]("12345", "sol", session, _make_message("sol"))
        state = get_pending("12345")
        self.assertEqual(state["step"], "ask_market_type")
        self.assertEqual(state["symbol"], "SOLUSDT")
        self.assertTrue(state["is_new"])

    async def test_ask_new_symbol_already_monitored_still_asks_market_type(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [{"symbol": "SOLUSDT", "type": "futures"}],
            "priceAlerts": [],
        })
        set_pending("12345", {"command": "alert", "step": "ask_new_symbol"})
        session = MagicMock()
        await _steps()["ask_new_symbol"]("12345", "sol", session, _make_message("sol"))
        state = get_pending("12345")
        self.assertEqual(state["step"], "ask_market_type")
        self.assertIsNone(state["is_new"])  # None = "maybe new for this type"

    async def test_ask_new_symbol_invalid_keeps_state(self):
        ctx = _fresh_ctx()
        set_pending("12345", {"command": "alert", "step": "ask_new_symbol"})
        session = MagicMock()
        await _steps()["ask_new_symbol"]("12345", "!!!", session, _make_message("!!!"))
        self.assertEqual(get_pending("12345")["step"], "ask_new_symbol")
        self.assertIn("Invalid", ctx.replies[-1])

    # -- ask_market_type step ------------------------------------------------

    async def test_ask_market_type_invalid_input_keeps_state(self):
        ctx = _fresh_ctx()
        set_pending("12345", {"command": "alert", "step": "ask_market_type",
                              "symbol": "SOLUSDT", "is_new": True})
        session = MagicMock()
        await _steps()["ask_market_type"]("12345", "9", session, _make_message("9"))
        self.assertEqual(get_pending("12345")["step"], "ask_market_type")

    async def test_ask_market_type_not_new_skips_binance(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [{"symbol": "BTCUSDT", "type": "futures"}],
            "priceAlerts": [],
        })
        set_pending("12345", {"command": "alert", "step": "ask_market_type",
                              "symbol": "BTCUSDT", "is_new": False})
        session = MagicMock()
        await _steps()["ask_market_type"]("12345", "1", session, _make_message("1"))
        state = get_pending("12345")
        self.assertEqual(state["step"], "ask_price")
        self.assertEqual(state["market_type"], "futures")

    async def test_ask_market_type_new_symbol_valid_binance(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        set_pending("12345", {"command": "alert", "step": "ask_market_type",
                              "symbol": "SOLUSDT", "is_new": True})

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value={"symbols": [{"symbol": "SOLUSDT"}]})
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        session = MagicMock()
        session.get = MagicMock(return_value=mock_resp)

        await _steps()["ask_market_type"]("12345", "1", session, _make_message("1"))
        state = get_pending("12345")
        self.assertEqual(state["step"], "ask_price")
        self.assertTrue(state["is_new"])

    async def test_ask_market_type_new_symbol_not_on_binance(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        set_pending("12345", {"command": "alert", "step": "ask_market_type",
                              "symbol": "FAKEUSDT", "is_new": True})

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value={"symbols": []})
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        session = MagicMock()
        session.get = MagicMock(return_value=mock_resp)

        await _steps()["ask_market_type"]("12345", "1", session, _make_message("1"))
        state = get_pending("12345")
        self.assertEqual(state["step"], "ask_new_symbol")
        self.assertIn("not found", ctx.replies[-1])

    # -- ask_price step ------------------------------------------------------

    async def _run_ask_price(self, ctx, live_price, target_price, market_type="futures",
                              is_new=False, binance_ticker_price=None):
        """Helper: sets up pending state and runs _step_ask_price, returning (state, alert)."""
        # Provide a live price via the engine mock
        engine_mock = MagicMock()
        engine_mock.state = {
            "BTCUSDT": {"last_price": live_price}
        } if live_price else {}
        ctx._engine = engine_mock

        set_pending("12345", {
            "command": "alert",
            "step": "ask_price",
            "symbol": "BTCUSDT",
            "market_type": market_type,
            "is_new": is_new,
        })

        # Mock session (only needed if Binance ticker fallback is exercised)
        if binance_ticker_price is not None:
            mock_resp = AsyncMock()
            mock_resp.status = 200
            mock_resp.json = AsyncMock(return_value={"price": str(binance_ticker_price)})
            mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_resp.__aexit__ = AsyncMock(return_value=False)
            session = MagicMock()
            session.get = MagicMock(return_value=mock_resp)
        else:
            session = MagicMock()

        await _steps()["ask_price"]("12345", str(target_price), session, _make_message(str(target_price)))
        alerts = ctx.config.get("priceAlerts", [])
        return alerts[-1] if alerts else None

    async def test_ask_price_direction_above_from_engine(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        alert = await self._run_ask_price(ctx, live_price=100000, target_price=105000)
        self.assertIsNotNone(alert)
        self.assertEqual(alert["direction"], "ABOVE")
        self.assertEqual(alert["symbol"], "BTCUSDT")
        self.assertIsNone(get_pending("12345"))

    async def test_ask_price_direction_below_from_engine(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        alert = await self._run_ask_price(ctx, live_price=100000, target_price=95000)
        self.assertEqual(alert["direction"], "BELOW")

    async def test_ask_price_falls_back_to_binance_ticker_when_no_engine_price(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        alert = await self._run_ask_price(
            ctx, live_price=None, target_price=105000,
            binance_ticker_price=100000,
        )
        self.assertEqual(alert["direction"], "ABOVE")

    async def test_ask_price_saves_alert_and_calls_save_reload(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        await self._run_ask_price(ctx, live_price=100000, target_price=105000)
        self.assertEqual(ctx.saves, 1)
        self.assertEqual(ctx.reloads, 1)

    async def test_ask_price_new_symbol_adds_to_monitored(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        await self._run_ask_price(ctx, live_price=100000, target_price=105000, is_new=True)
        symbols = ctx.config["monitoredSymbols"]
        self.assertEqual(len(symbols), 1)
        self.assertEqual(symbols[0]["symbol"], "BTCUSDT")

    async def test_ask_price_invalid_text_keeps_state(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        set_pending("12345", {"command": "alert", "step": "ask_price",
                              "symbol": "BTCUSDT", "market_type": "futures", "is_new": False})
        session = MagicMock()
        await _steps()["ask_price"]("12345", "not_a_number", session, _make_message("not_a_number"))
        self.assertEqual(get_pending("12345")["step"], "ask_price")
        self.assertIn("valid number", ctx.replies[-1])

    async def test_ask_price_zero_rejected(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        set_pending("12345", {"command": "alert", "step": "ask_price",
                              "symbol": "BTCUSDT", "market_type": "futures", "is_new": False})
        session = MagicMock()
        await _steps()["ask_price"]("12345", "0", session, _make_message("0"))
        self.assertEqual(get_pending("12345")["step"], "ask_price")

    async def test_ask_price_createdAt_is_unix_ms(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        before_ms = int(time.time() * 1000)
        alert = await self._run_ask_price(ctx, live_price=100000, target_price=105000)
        after_ms = int(time.time() * 1000)
        self.assertIsInstance(alert["createdAt"], int)
        self.assertGreaterEqual(alert["createdAt"], before_ms)
        self.assertLessEqual(alert["createdAt"], after_ms)

    async def test_ask_price_alert_stores_market_type(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        alert = await self._run_ask_price(ctx, live_price=100000, target_price=105000, market_type="spot")
        self.assertEqual(alert["market_type"], "spot")

    # -- remove_pick step ----------------------------------------------------

    async def test_remove_pick_removes_matching_alert(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [],
            "priceAlerts": [
                {"id": "aaa1", "symbol": "BTCUSDT", "price": 105000.0, "direction": "ABOVE"},
                {"id": "bbb2", "symbol": "ETHUSDT", "price": 2500.0, "direction": "BELOW"},
            ],
        })
        snapshot = list(ctx.config["priceAlerts"])
        set_pending("12345", {"command": "alert", "step": "remove_pick", "alerts_snapshot": snapshot})
        session = MagicMock()
        await _steps()["remove_pick"]("12345", "1", session, _make_message("1"))
        remaining = ctx.config["priceAlerts"]
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["id"], "bbb2")
        self.assertIsNone(get_pending("12345"))
        self.assertIn("Removed", ctx.replies[-1])

    async def test_remove_pick_out_of_range_keeps_state(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [],
            "priceAlerts": [
                {"id": "aaa1", "symbol": "BTCUSDT", "price": 105000.0, "direction": "ABOVE"},
            ],
        })
        snapshot = list(ctx.config["priceAlerts"])
        set_pending("12345", {"command": "alert", "step": "remove_pick", "alerts_snapshot": snapshot})
        session = MagicMock()
        await _steps()["remove_pick"]("12345", "99", session, _make_message("99"))
        self.assertEqual(len(ctx.config["priceAlerts"]), 1)
        self.assertEqual(get_pending("12345")["step"], "remove_pick")

    async def test_remove_pick_stale_snapshot_reports_missing(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        snapshot = [{"id": "gone", "symbol": "BTCUSDT", "price": 100000.0, "direction": "ABOVE"}]
        set_pending("12345", {"command": "alert", "step": "remove_pick", "alerts_snapshot": snapshot})
        session = MagicMock()
        await _steps()["remove_pick"]("12345", "1", session, _make_message("1"))
        self.assertIn("no longer exists", ctx.replies[-1])
        self.assertIsNone(get_pending("12345"))

    # -- /alerts command -----------------------------------------------------

    async def test_alerts_command_lists_active_alerts(self):
        ctx = _fresh_ctx(config={
            "monitoredSymbols": [],
            "priceAlerts": [
                {"id": "aaa1bb", "symbol": "BTCUSDT", "price": 105000.0, "direction": "ABOVE"},
            ],
        })
        session = MagicMock()
        await _BOT_COMMANDS["alerts"](session, _make_message("/alerts"))
        reply = ctx.replies[-1]
        self.assertIn("BTCUSDT", reply)
        self.assertIn("Active alerts", reply)
        self.assertIn("aaa1bb"[:8], reply)

    async def test_alerts_command_no_alerts(self):
        ctx = _fresh_ctx(config={"monitoredSymbols": [], "priceAlerts": []})
        session = MagicMock()
        await _BOT_COMMANDS["alerts"](session, _make_message("/alerts"))
        self.assertIn("No active alerts", ctx.replies[-1])


if __name__ == "__main__":
    unittest.main()
