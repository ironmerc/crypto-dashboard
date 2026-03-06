from __future__ import annotations

from typing import Any


def debounced_state_change(
    debounce_state: dict[str, Any],
    key: str,
    current: str,
    candidate: str,
    confirmations: int = 2,
) -> tuple[str, bool]:
    if candidate == current:
        debounce_state.pop(key, None)
        return current, False

    pending = debounce_state.get(key, {})
    if pending.get("candidate") == candidate:
        count = int(pending.get("count", 0)) + 1
    else:
        count = 1

    if count >= confirmations:
        debounce_state.pop(key, None)
        return candidate, True

    debounce_state[key] = {"candidate": candidate, "count": count}
    return current, False


def threshold_trigger(
    threshold_state: dict[str, Any],
    key: str,
    condition: bool,
    enter_confirmations: int = 2,
    exit_confirmations: int = 2,
) -> bool:
    state = threshold_state.get(key, {"latched": False, "enter_count": 0, "exit_count": 0})
    latched = bool(state.get("latched", False))
    enter_count = int(state.get("enter_count", 0))
    exit_count = int(state.get("exit_count", 0))

    if condition:
        enter_count += 1
        exit_count = 0
        fire = (not latched) and enter_count >= enter_confirmations
        if fire:
            latched = True
    else:
        exit_count += 1
        enter_count = 0
        fire = False
        if latched and exit_count >= exit_confirmations:
            latched = False

    threshold_state[key] = {
        "latched": latched,
        "enter_count": enter_count,
        "exit_count": exit_count,
    }
    return fire

