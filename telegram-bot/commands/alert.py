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
    await ctx.reply(session, text, reply_to_message_id=None)
"""
import logging
import re
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


# ---------------------------------------------------------------------------
# setup() — registers /alert and /alerts with the command registry
# ---------------------------------------------------------------------------

def setup(ctx) -> None:
    """Register /alert and /alerts using the supplied BotContext.

    All step handlers are closures over *ctx* so they can access live
    config and the market engine without importing from bot.py.
    """

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
        """Return the monitored entry for *symbol*, optionally filtered by *market_type*."""
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

    def _infer_direction(symbol: str, target: float) -> str:
        engine = ctx.engine
        live = float((engine.state.get(symbol) or {}).get("last_price") or 0) if engine else 0
        if live <= 0:
            return "CROSS"
        return "ABOVE" if target > live else ("BELOW" if target < live else "CROSS")

    # -- step handlers -------------------------------------------------------

    async def _step_menu(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        if text == "1":
            snapshot = _build_symbols_snapshot()
            lines = [f"{i + 1}. <b>{e['symbol']}</b> ({e['type']})" for i, e in enumerate(snapshot)]
            body = "\n".join(lines) if lines else "(no symbols monitored yet)"
            set_pending(chat_id, {"step": "pick_symbol", "symbols_snapshot": snapshot})
            await ctx.reply(session, f"Pick symbol:\n{body}\n\n0. Add new symbol", message.get("message_id"))
        elif text == "2":
            alerts = ctx.config.get("priceAlerts", [])
            if not alerts:
                clear_pending(chat_id)
                await ctx.reply(session, "No active alerts to remove.", message.get("message_id"))
            else:
                lines = [f"{i + 1}. {_fmt_alert(a)}" for i, a in enumerate(alerts)]
                set_pending(chat_id, {"step": "remove_pick", "alerts_snapshot": list(alerts)})
                await ctx.reply(
                    session,
                    "🗑 <b>Remove alert</b> — pick one:\n" + "\n".join(lines),
                    message.get("message_id"),
                )
        else:
            await ctx.reply(
                session,
                "Please reply <b>1</b> (set alert) or <b>2</b> (remove alert).",
                message.get("message_id"),
            )
        return True

    async def _step_pick_symbol(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        if text == "0":
            set_pending(chat_id, {"step": "ask_new_symbol"})
            await ctx.reply(session, "Enter symbol name (e.g., SOLUSDT):", message.get("message_id"))
            return True
        try:
            idx = int(text) - 1
        except ValueError:
            await ctx.reply(
                session,
                "Please enter a number from the list or <b>0</b> to add a new symbol.",
                message.get("message_id"),
            )
            return True
        snapshot = pending.get("symbols_snapshot", []) if pending else []
        if idx < 0 or idx >= len(snapshot):
            await ctx.reply(
                session,
                f"Invalid choice — pick 1 to {len(snapshot)} or 0 to add new.",
                message.get("message_id"),
            )
            return True
        entry = snapshot[idx]
        set_pending(chat_id, {
            "step": "ask_price",
            "symbol": entry["symbol"],
            "market_type": entry["type"],
            "is_new": False,
        })
        await ctx.reply(
            session,
            f"What price should trigger the alert for <b>{entry['symbol']}</b> ({entry['type']})?",
            message.get("message_id"),
        )
        return True

    async def _step_ask_new_symbol(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        sym = _normalize_symbol(text)
        if not _is_valid_symbol(sym):
            await ctx.reply(
                session,
                "Invalid symbol — must be 5–20 alphanumeric characters (e.g., SOLUSDT). Try again:",
                message.get("message_id"),
            )
            return True
        any_existing = _find_monitored(sym)
        if not any_existing:
            set_pending(chat_id, {"step": "ask_market_type", "symbol": sym, "is_new": True})
            await ctx.reply(session, f"Market type for <b>{sym}</b>?\n1. Futures\n2. Spot", message.get("message_id"))
        else:
            # Symbol monitored under at least one market type — ask which the user wants
            set_pending(chat_id, {"step": "ask_market_type", "symbol": sym, "is_new": None})
            await ctx.reply(
                session,
                f"<b>{sym}</b> is monitored. Pick market type for this alert:\n1. Futures\n2. Spot",
                message.get("message_id"),
            )
        return True

    async def _step_ask_market_type(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        if text == "1":
            market_type = "futures"
        elif text == "2":
            market_type = "spot"
        else:
            await ctx.reply(session, "Please reply <b>1</b> (futures) or <b>2</b> (spot).", message.get("message_id"))
            return True

        sym = pending.get("symbol", "") if pending else ""
        is_new_flag = pending.get("is_new") if pending else True  # None → "maybe new for this type"

        exact_match = _find_monitored(sym, market_type)
        if is_new_flag is None:
            if exact_match:
                # Exact (symbol, type) already monitored — go straight to price
                set_pending(chat_id, {"step": "ask_price", "market_type": market_type, "is_new": False})
                await ctx.reply(
                    session,
                    f"What price should trigger the alert for <b>{sym}</b> ({market_type})?",
                    message.get("message_id"),
                )
                return True
            is_new_flag = True  # e.g. BTCUSDT futures exists but user wants spot

        if not is_new_flag:
            set_pending(chat_id, {"step": "ask_price", "market_type": market_type, "is_new": False})
            await ctx.reply(
                session,
                f"What price should trigger the alert for <b>{sym}</b> ({market_type})?",
                message.get("message_id"),
            )
            return True

        await ctx.reply(session, f"⏳ Checking {sym} on Binance…", message.get("message_id"))
        exists = await _check_binance_symbol(session, sym, market_type)
        if not exists:
            set_pending(chat_id, {"step": "ask_new_symbol"})
            await ctx.reply(
                session,
                f"<b>{sym}</b> not found on Binance ({market_type}). Try again:",
                message.get("message_id"),
            )
            return True

        set_pending(chat_id, {"step": "ask_price", "market_type": market_type, "is_new": True})
        await ctx.reply(
            session,
            f"✅ {sym} exists on Binance.\nWhat price should trigger the alert for <b>{sym}</b> ({market_type})?",
            message.get("message_id"),
        )
        return True

    async def _step_ask_price(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        try:
            price = float(text.replace(",", ""))
        except ValueError:
            await ctx.reply(session, "Please enter a valid number (e.g., 105000).", message.get("message_id"))
            return True
        if price <= 0:
            await ctx.reply(session, "Price must be greater than 0.", message.get("message_id"))
            return True

        sym = pending.get("symbol", "") if pending else ""
        market_type = pending.get("market_type", "futures") if pending else "futures"
        is_new = pending.get("is_new", False) if pending else False

        direction = _infer_direction(sym, price)
        # For brand-new symbols the engine has no live price yet → try Binance ticker
        if direction == "CROSS":
            try:
                qs = urlencode({"symbol": sym})
                ticker_url = (
                    f"https://fapi.binance.com/fapi/v1/ticker/price?{qs}"
                    if market_type == "futures"
                    else f"https://api.binance.com/api/v3/ticker/price?{qs}"
                )
                async with session.get(ticker_url, timeout=5) as resp:
                    if resp.status == 200:
                        tdata = await resp.json()
                        live = float(tdata.get("price", 0))
                        if live > 0:
                            direction = "ABOVE" if price > live else ("BELOW" if price < live else "CROSS")
            except Exception:
                pass  # keep CROSS if Binance fetch fails

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
        await ctx.reply(
            session,
            f"✅ Alert set{added_note}\n<b>{sym}</b>: ${_fmt_price(price)} — {direction}\nID: <code>{alert['id']}</code>",
            message.get("message_id"),
        )
        return True

    async def _step_remove_pick(chat_id: str, text: str, session: ClientSession, message: dict) -> bool:
        pending = get_pending(chat_id)
        snapshot = pending.get("alerts_snapshot", []) if pending else []
        try:
            idx = int(text) - 1
        except ValueError:
            await ctx.reply(session, "Please enter a number from the list.", message.get("message_id"))
            return True
        if idx < 0 or idx >= len(snapshot):
            await ctx.reply(
                session,
                f"Invalid choice — pick 1 to {len(snapshot)}.",
                message.get("message_id"),
            )
            return True

        target = snapshot[idx]
        current = ctx.config.get("priceAlerts", [])
        match = next((a for a in current if a.get("id") == target.get("id")), None)
        if not match:
            clear_pending(chat_id)
            await ctx.reply(session, "That alert no longer exists.", message.get("message_id"))
            return True

        ctx.config["priceAlerts"] = [a for a in current if a.get("id") != match["id"]]
        ctx.save()
        ctx.reload()
        clear_pending(chat_id)
        await ctx.reply(session, f"✅ Removed: {_fmt_alert(match)}", message.get("message_id"))
        return True

    # -- top-level command handlers ------------------------------------------

    async def handle_cmd_alert(session: ClientSession, message: dict) -> None:
        """Entry point for /alert — opens the alert management menu."""
        chat_id = str(message["chat"]["id"])
        set_pending(chat_id, {"command": "alert", "step": "menu"})
        await ctx.reply(
            session,
            "🔔 <b>Alert management</b> — choose:\n1. Set new alert\n2. Remove alert",
            message.get("message_id"),
        )

    async def handle_cmd_list_alerts(session: ClientSession, message: dict) -> None:
        """Entry point for /alerts — sends the current alert list."""
        alerts = ctx.config.get("priceAlerts", [])
        if not alerts:
            text = "No active alerts."
        else:
            lines = [f"• {_fmt_alert(a)} — <code>{a['id'][:8]}</code>" for a in alerts]
            text = f"📋 <b>Active alerts ({len(alerts)}):</b>\n" + "\n".join(lines)
        await ctx.reply(session, text, message.get("message_id"))

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
