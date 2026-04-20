"""
/alert and /alerts command implementations.

Wire up via ``setup(ctx)`` from ``init_app()`` in bot.py::

    from commands.alert import setup as setup_alert_commands
    setup_alert_commands(ctx)

``ctx`` is a ``BotContext`` providing:
    ctx.config  — live bot_config dict (always the current binding)
    ctx.engine  — MarketEngine instance or None
    ctx.save()  — persist config to disk
    ctx.reload() — write reload.flag so the market engine re-reads config
    await ctx.reply(session, text)        — plain text
    await ctx.reply_kb(session, text, keyboard) — inline keyboard (choice buttons)
    await ctx.reply_ask(session, text)    — text prompt with ❌ Cancel in keyboard bar
    await ctx.reply_done(session, text)   — completion msg, removes keyboard bar
"""
import logging
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

from aiohttp import ClientSession

from commands import (
    PENDING_STATE_EXPIRY_SEC,
    clear_pending,
    get_pending,
    register_command,
    set_pending,
)
from validation import VALID_SYMBOL_RE as _ALERT_SYMBOL_RE

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure helpers (no ctx dependency)
# ---------------------------------------------------------------------------

def _normalize_symbol(s: str) -> str:
    s = s.upper().strip()
    if len(s) <= 5 and not s.endswith("USDT"):
        s += "USDT"
    return s


def _is_valid_symbol(s: str) -> bool:
    return bool(_ALERT_SYMBOL_RE.match(s))


def _fmt_price(price: float) -> str:
    """Format a crypto price with enough decimal places to be meaningful."""
    if price >= 1000:
        return f"{price:,.2f}"
    elif price >= 1:
        return f"{price:,.4f}"
    elif price >= 0.01:
        return f"{price:,.6f}"
    else:
        return f"{price:,.8f}"


def _fmt_alert(a: dict) -> str:
    direction = a.get("direction") or a.get("side", "?")
    return f"<b>{a['symbol']}</b> ${_fmt_price(float(a['price']))} {direction}"


def _fmt_alert_plain(a: dict) -> str:
    direction = a.get("direction") or a.get("side", "?")
    return f"{a['symbol']} ${_fmt_price(float(a['price']))} {direction}"


# ---------------------------------------------------------------------------
# Inline keyboard builder
# ---------------------------------------------------------------------------

def _kb(*rows: list) -> list:
    """Wraps positional row args into a Telegram inline_keyboard list."""
    return list(rows)


# ---------------------------------------------------------------------------
# setup() — registers /alert and /alerts with the command registry
# ---------------------------------------------------------------------------

def setup(ctx) -> None:
    """Register /alert and /alerts using the supplied BotContext."""

    # -- ctx-bound helpers ---------------------------------------------------

    def _build_symbols_snapshot() -> list:
        raw = ctx.config.get("monitoredSymbols", [])
        result = []
        for s in raw:
            if isinstance(s, str):
                result.append({"symbol": s, "type": "futures"})
            elif isinstance(s, dict):
                result.append({
                    "symbol": s.get("symbol", ""),
                    "type": s.get("type", "futures"),
                })
        return sorted(result, key=lambda x: x["symbol"])

    def _find_monitored(symbol: str, market_type: Optional[str] = None) -> Optional[dict]:
        for s in ctx.config.get("monitoredSymbols", []):
            sym = s if isinstance(s, str) else s.get("symbol", "")
            mtype = "futures" if isinstance(s, str) else s.get("type", "futures")
            if sym.upper() != symbol.upper():
                continue
            if market_type is not None and mtype != market_type:
                continue
            return {"symbol": sym.upper(), "type": mtype}
        return None

    async def _check_binance_symbol(session: ClientSession, symbol: str, market_type: str) -> bool:
        if market_type not in ("futures", "spot"):
            return False
        try:
            url = (
                "https://fapi.binance.com/fapi/v1/exchangeInfo"
                if market_type == "futures"
                else "https://api.binance.com/api/v3/exchangeInfo"
            )
            async with session.get(url, timeout=10) as resp:
                if resp.status != 200:
                    return False
                data = await resp.json()
                return symbol in {s["symbol"] for s in data.get("symbols", [])}
        except Exception as e:
            logger.warning("Binance symbol check failed for %s (%s): %s", symbol, market_type, e)
            return False

    async def _fetch_binance_price(session: ClientSession, symbol: str, market_type: str) -> float:
        """Returns the latest Binance price, or 0.0 on failure."""
        try:
            qs = urlencode({"symbol": symbol})
            url = (
                f"https://fapi.binance.com/fapi/v1/ticker/price?{qs}"
                if market_type == "futures"
                else f"https://api.binance.com/api/v3/ticker/price?{qs}"
            )
            async with session.get(url, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return float(data.get("price", 0))
        except Exception:
            pass
        return 0.0

    # -- step handlers -------------------------------------------------------

    async def _step_menu(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        if text == "1":
            snapshot = _build_symbols_snapshot()
            rows = [
                [{"text": f"{e['symbol']} ({e['type']})", "callback_data": str(i + 1)}]
                for i, e in enumerate(snapshot)
            ]
            rows.append([{"text": "➕ Add new symbol", "callback_data": "0"}])
            rows.append([{"text": "❌ Cancel", "callback_data": "cancel"}])
            set_pending(chat_id, {"step": "pick_symbol", "symbols_snapshot": snapshot})
            body = "Pick a monitored symbol:" if snapshot else "No symbols monitored yet — add one:"
            await ctx.reply_kb(session, body, _kb(*rows))
        elif text == "2":
            alerts = ctx.config.get("priceAlerts", [])
            if not alerts:
                clear_pending(chat_id)
                await ctx.reply_done(session, "No active alerts to remove.")
            else:
                rows = [
                    [{"text": _fmt_alert_plain(a), "callback_data": str(i + 1)}]
                    for i, a in enumerate(alerts)
                ]
                rows.append([{"text": "❌ Cancel", "callback_data": "cancel"}])
                set_pending(chat_id, {"step": "remove_pick", "alerts_snapshot": list(alerts)})
                await ctx.reply_kb(session, "🗑 <b>Remove alert</b> — pick one:", _kb(*rows))
        else:
            await ctx.reply_kb(
                session,
                "Please choose an option:",
                _kb(
                    [{"text": "🔔 Set new alert", "callback_data": "1"}],
                    [{"text": "🗑 Remove alert", "callback_data": "2"}],
                ),
            )
        return True

    async def _step_pick_symbol(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        snapshot = pending.get("symbols_snapshot", []) if pending else []

        def _symbol_kb():
            rows = [
                [{"text": f"{e['symbol']} ({e['type']})", "callback_data": str(i + 1)}]
                for i, e in enumerate(snapshot)
            ]
            rows.append([{"text": "➕ Add new symbol", "callback_data": "0"}])
            rows.append([{"text": "❌ Cancel", "callback_data": "cancel"}])
            return _kb(*rows)

        if text == "0":
            set_pending(chat_id, {"step": "ask_new_symbol"})
            await ctx.reply_ask(session, "Enter symbol name (e.g., SOLUSDT):")
            return True

        try:
            idx = int(text) - 1
        except ValueError:
            await ctx.reply_kb(session, "Please pick from the list:", _symbol_kb())
            return True

        if idx < 0 or idx >= len(snapshot):
            await ctx.reply_kb(session, "Invalid choice — pick from the list:", _symbol_kb())
            return True

        entry = snapshot[idx]
        set_pending(chat_id, {
            "step": "ask_price",
            "symbol": entry["symbol"],
            "market_type": entry["type"],
            "is_new": False,
        })
        await ctx.reply_ask(
            session,
            f"Enter target price for <b>{entry['symbol']}</b> ({entry['type']}):",
        )
        return True

    async def _step_ask_new_symbol(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        sym = _normalize_symbol(text)
        if not _is_valid_symbol(sym):
            await ctx.reply_ask(
                session,
                "Invalid symbol — must be 5–20 alphanumeric characters (e.g., SOLUSDT). Try again:",
            )
            return True

        keyboard = _kb(
            [{"text": "Futures", "callback_data": "1"}],
            [{"text": "Spot", "callback_data": "2"}],
            [{"text": "❌ Cancel", "callback_data": "cancel"}],
        )
        any_existing = _find_monitored(sym)
        if not any_existing:
            set_pending(chat_id, {"step": "ask_market_type", "symbol": sym, "is_new": True})
            await ctx.reply_kb(session, f"Market type for <b>{sym}</b>?", keyboard)
        else:
            set_pending(chat_id, {"step": "ask_market_type", "symbol": sym, "is_new": None})
            await ctx.reply_kb(session, f"<b>{sym}</b> is monitored. Pick market type for this alert:", keyboard)
        return True

    async def _step_ask_market_type(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        sym = pending.get("symbol", "") if pending else ""
        is_new_flag = pending.get("is_new") if pending else True

        market_kb = _kb(
            [{"text": "Futures", "callback_data": "1"}],
            [{"text": "Spot", "callback_data": "2"}],
            [{"text": "❌ Cancel", "callback_data": "cancel"}],
        )

        if text == "1":
            market_type = "futures"
        elif text == "2":
            market_type = "spot"
        else:
            await ctx.reply_kb(session, "Please choose market type:", market_kb)
            return True

        exact_match = _find_monitored(sym, market_type)
        if is_new_flag is None:
            if exact_match:
                set_pending(chat_id, {"step": "ask_price", "symbol": sym, "market_type": market_type, "is_new": False})
                await ctx.reply_ask(session, f"Enter target price for <b>{sym}</b> ({market_type}):")
                return True
            is_new_flag = True

        if not is_new_flag:
            set_pending(chat_id, {"step": "ask_price", "symbol": sym, "market_type": market_type, "is_new": False})
            await ctx.reply_ask(session, f"Enter target price for <b>{sym}</b> ({market_type}):")
            return True

        await ctx.reply(session, f"⏳ Checking {sym} on Binance…")
        exists = await _check_binance_symbol(session, sym, market_type)
        if not exists:
            set_pending(chat_id, {"step": "ask_new_symbol"})
            await ctx.reply_ask(session, f"<b>{sym}</b> not found on Binance ({market_type}). Try another symbol:")
            return True

        set_pending(chat_id, {"step": "ask_price", "symbol": sym, "market_type": market_type, "is_new": True})
        await ctx.reply_ask(session, f"✅ {sym} confirmed.\nEnter target price:")
        return True

    async def _step_ask_price(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        try:
            price = float(text.replace(",", ""))
        except ValueError:
            await ctx.reply_ask(session, "Please enter a valid number (e.g., 105000).")
            return True
        if price <= 0:
            await ctx.reply_ask(session, "Price must be greater than 0.")
            return True

        sym = pending.get("symbol", "") if pending else ""
        market_type = pending.get("market_type", "futures") if pending else "futures"
        is_new = pending.get("is_new", False) if pending else False

        # Always fetch fresh Binance price for accurate direction; fall back to engine state.
        live = await _fetch_binance_price(session, sym, market_type)
        if live <= 0:
            engine = ctx.engine
            live = float((engine.state.get(sym) or {}).get("last_price") or 0) if engine else 0

        if live > 0:
            direction = "ABOVE" if price > live else ("BELOW" if price < live else "CROSS")
        else:
            direction = "CROSS"

        alert = {
            "id": secrets.token_hex(4),
            "symbol": sym,
            "price": price,
            "direction": direction,
            "market_type": market_type,
            "createdAt": int(time.time() * 1000),
        }
        if is_new:
            if not isinstance(ctx.config.get("monitoredSymbols"), list):
                ctx.config["monitoredSymbols"] = []
            ctx.config["monitoredSymbols"].append({"symbol": sym, "type": market_type})
        if not isinstance(ctx.config.get("priceAlerts"), list):
            ctx.config["priceAlerts"] = []
        ctx.config["priceAlerts"].append(alert)
        ctx.save()
        ctx.reload()
        clear_pending(chat_id)

        added_note = f" — <b>{sym}</b> ({market_type}) added to monitoring" if is_new else ""
        await ctx.reply_done(
            session,
            f"✅ Alert set{added_note}\n<b>{sym}</b>: ${_fmt_price(price)} — {direction}\nID: <code>{alert['id']}</code>",
        )
        return True

    async def _step_remove_pick(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        snapshot = pending.get("alerts_snapshot", []) if pending else []

        def _alert_kb():
            rows = [
                [{"text": _fmt_alert_plain(a), "callback_data": str(i + 1)}]
                for i, a in enumerate(snapshot)
            ]
            rows.append([{"text": "❌ Cancel", "callback_data": "cancel"}])
            return _kb(*rows)

        try:
            idx = int(text) - 1
        except ValueError:
            await ctx.reply_kb(session, "Please pick from the list.", _alert_kb())
            return True

        if idx < 0 or idx >= len(snapshot):
            await ctx.reply_kb(session, "Invalid choice — pick from the list.", _alert_kb())
            return True

        target = snapshot[idx]
        current = ctx.config.get("priceAlerts", [])
        match = next((a for a in current if a.get("id") == target.get("id")), None)
        if not match:
            clear_pending(chat_id)
            await ctx.reply_done(session, "That alert no longer exists.")
            return True

        ctx.config["priceAlerts"] = [a for a in current if a.get("id") != match["id"]]
        ctx.save()
        ctx.reload()
        clear_pending(chat_id)
        await ctx.reply_done(session, f"✅ Removed: {_fmt_alert(match)}")
        return True

    # -- top-level command handlers ------------------------------------------

    async def handle_cmd_alert(session: ClientSession, message: dict) -> None:
        """Entry point for /alert — opens the alert management menu."""
        chat_id = str(message["chat"]["id"])
        set_pending(chat_id, {"command": "alert", "step": "menu"})
        keyboard = _kb(
            [{"text": "🔔 Set new alert", "callback_data": "1"}],
            [{"text": "🗑 Remove alert", "callback_data": "2"}],
        )
        await ctx.reply_kb(session, "🔔 <b>Alert management</b> — choose:", keyboard)

    async def handle_cmd_list_alerts(session: ClientSession, message: dict) -> None:
        """Entry point for /alerts — sends the current alert list."""
        alerts = ctx.config.get("priceAlerts", [])
        if not alerts:
            text = "No active alerts."
        else:
            lines = [f"• {_fmt_alert(a)} — <code>{a['id'][:8]}</code>" for a in alerts]
            text = f"📋 <b>Active alerts ({len(alerts)}):</b>\n" + "\n".join(lines)
        await ctx.reply(session, text)

    # -- registration --------------------------------------------------------

    register_command("alert", handle_cmd_alert, steps={
        "menu":            _step_menu,
        "pick_symbol":     _step_pick_symbol,
        "ask_new_symbol":  _step_ask_new_symbol,
        "ask_market_type": _step_ask_market_type,
        "ask_price":       _step_ask_price,
        "remove_pick":     _step_remove_pick,
    })
    register_command("alerts", handle_cmd_list_alerts)
