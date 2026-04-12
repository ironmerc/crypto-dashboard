"""
Bot command registry and shared conversational-flow state.

Adding a new command
--------------------
1. Create ``commands/<your_command>.py`` with a ``setup(ctx: BotContext)`` function.
2. Inside ``setup``, define your step handlers and call::

       register_command("cmd_name", handler, steps={
           "step_one": _step_one,
           ...
       })

3. Import and call ``setup(ctx)`` from ``init_app()`` in bot.py.

That's it — no other files need to change.
"""
import asyncio
import logging
import time
from typing import Callable, Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# How long (seconds) an idle conversational state lives before expiry
# ---------------------------------------------------------------------------
PENDING_STATE_EXPIRY_SEC = 120

# ---------------------------------------------------------------------------
# Command registry
# ---------------------------------------------------------------------------
# cmd name → async handler(session, message)
_BOT_COMMANDS: Dict[str, Callable] = {}
# cmd name → {step_name: async handler(chat_id, text, session, message)}
_STEP_REGISTRIES: Dict[str, Dict] = {}


def register_command(name: str, handler: Callable, steps: Optional[Dict] = None) -> None:
    """Register a bot command and its optional multi-step conversation table.

    Parameters
    ----------
    name:
        The Telegram command word, without the leading ``/``
        (e.g. ``"alert"`` for ``/alert``).
    handler:
        ``async def handler(session, message)`` — called when the user sends
        ``/name`` and no pending state exists for that chat.
    steps:
        Optional ``{step_name: async step_handler}`` dict.  Step handlers have
        the signature ``async def step(chat_id, text, session, message) -> bool``.
    """
    _BOT_COMMANDS[name] = handler
    if steps:
        _STEP_REGISTRIES[name] = steps


# ---------------------------------------------------------------------------
# In-memory pending conversational state
# chat_id (str) → {command, step, ...payload..., expires_at}
# ---------------------------------------------------------------------------
_pending_state: Dict[str, dict] = {}


def get_pending(chat_id: str) -> Optional[dict]:
    """Return active pending state for *chat_id*, or None if absent/expired."""
    entry = _pending_state.get(chat_id)
    if entry is None:
        return None
    if time.time() > entry.get("expires_at", 0):
        _pending_state.pop(chat_id, None)
        return None
    return entry


def set_pending(chat_id: str, updates: dict) -> None:
    """Upsert pending state for *chat_id*, refreshing the expiry clock."""
    existing = _pending_state.get(chat_id, {})
    existing.update(updates)
    existing["expires_at"] = time.time() + PENDING_STATE_EXPIRY_SEC
    _pending_state[chat_id] = existing


def clear_pending(chat_id: str) -> None:
    """Remove any pending state for *chat_id*."""
    _pending_state.pop(chat_id, None)


# ---------------------------------------------------------------------------
# Background cleanup task
# ---------------------------------------------------------------------------

async def cleanup_expired_loop() -> None:
    """Periodically evict stale pending states (run as an asyncio task)."""
    while True:
        try:
            await asyncio.sleep(PENDING_STATE_EXPIRY_SEC)
            now = time.time()
            expired = [
                cid for cid, s in list(_pending_state.items())
                if now > s.get("expires_at", 0)
            ]
            for cid in expired:
                _pending_state.pop(cid, None)
            if expired:
                logger.debug(f"Cleaned {len(expired)} expired pending state(s)")
        except asyncio.CancelledError:
            break
