from __future__ import annotations

from copy import deepcopy
from typing import Any

THRESHOLD_KEYS = {
    "whaleMinAmount",
    "liquidationMinAmount",
    "oiSpikePercentage",
    "fundingExtremeRate",
    "atrExpansionRatio",
    "whaleMomentumDelta",
    "rvolMultiplier",
    "rsiOverbought",
    "rsiOversold",
    "emaSeparationPct",
    "macdFreshnessRatio",
    "bbSqueezeWidthPct",
    "stochOverbought",
    "stochOversold",
    "oiDivergenceLookbackBars",
}
DEFAULT_THRESHOLDS = {
    "whaleMinAmount": 500000,
    "liquidationMinAmount": 1000000,
    "oiSpikePercentage": 1.5,
    "fundingExtremeRate": 0.05,
    "atrExpansionRatio": 1.3,
    "whaleMomentumDelta": 5000000,
    "rvolMultiplier": 3.0,
    "rsiOverbought": 70,
    "rsiOversold": 30,
    "emaSeparationPct": 0.15,
    "macdFreshnessRatio": 0.1,
    "bbSqueezeWidthPct": 2.0,
    "stochOverbought": 85,
    "stochOversold": 15,
    "oiDivergenceLookbackBars": 6,
}
SUPPORTED_TIMEFRAMES = ("1m", "3m", "5m", "15m", "1h", "4h", "1d", "1w", "1M")
SUPPORTED_TIMEFRAMES_SET = set(SUPPORTED_TIMEFRAMES)
DEFAULT_HIGHER_TIMEFRAMES = ["1h", "4h", "1d", "1w", "1M"]
TIMEFRAME_SENSITIVE_CATEGORIES = (
    "atr_expand",
    "context_summary",
    "ema_cross",
    "level_testing",
    "oi_spike",
    "order_flow",
    "rsi_extreme",
    "rvol_spike",
    "macd_cross",
    "bb_squeeze",
    "bb_breakout",
    "stoch_extreme",
    "oi_divergence",
)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _normalize_threshold_scope(
    value: dict[str, Any] | None,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    normalized = dict(fallback)
    for key in THRESHOLD_KEYS:
        candidate = source.get(key)
        if _is_number(candidate):
            normalized[key] = candidate
    return normalized

def _sanitize_timeframes(values: list[Any]) -> list[str]:
    cleaned: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        tf = value.strip()
        if tf in SUPPORTED_TIMEFRAMES_SET and tf not in cleaned:
            cleaned.append(tf)
    return cleaned

def default_timeframes_for_sensitive_categories() -> dict[str, list[str]]:
    return {
        category: list(DEFAULT_HIGHER_TIMEFRAMES)
        for category in TIMEFRAME_SENSITIVE_CATEGORIES
    }


def normalize_config_shape(config: dict[str, Any]) -> tuple[dict[str, Any], bool, list[str]]:
    """
    Normalizes legacy config shapes to current schema shape.

    Current migration:
    - thresholds.<thresholdKey>: number  -> thresholds.global.<thresholdKey>: number
    - drops non-object entries under thresholds except known legacy flat threshold keys
    """
    normalized = deepcopy(config)
    changed = False
    notes: list[str] = []

    thresholds = normalized.get("thresholds")
    if isinstance(thresholds, dict):
        global_thresholds = thresholds.get("global")
        normalized_global_thresholds = _normalize_threshold_scope(global_thresholds, DEFAULT_THRESHOLDS)
        if normalized_global_thresholds != global_thresholds:
            changed = True

        rebuilt_thresholds: dict[str, Any] = {}
        for key, value in thresholds.items():
            if key == "global":
                continue

            if isinstance(value, dict):
                normalized_scope = _normalize_threshold_scope(value, normalized_global_thresholds)
                rebuilt_thresholds[key] = normalized_scope
                if normalized_scope != value:
                    changed = True
                continue

            # Legacy flat keys moved under thresholds.global if missing there.
            if key in THRESHOLD_KEYS and _is_number(value):
                global_has_explicit_value = isinstance(global_thresholds, dict) and _is_number(global_thresholds.get(key))
                if not global_has_explicit_value:
                    normalized_global_thresholds[key] = value
                changed = True
                continue

            # Unknown non-object entries are dropped to satisfy schema shape.
            changed = True

        rebuilt_thresholds["global"] = normalized_global_thresholds

        if rebuilt_thresholds != thresholds:
            normalized["thresholds"] = rebuilt_thresholds
            changed = True
            notes.append("normalized thresholds shape to object-per-scope format")

    monitored_timeframes = normalized.get("monitoredTimeframes")
    if isinstance(monitored_timeframes, list):
        sanitized = _sanitize_timeframes(monitored_timeframes)
        if sanitized != monitored_timeframes:
            normalized["monitoredTimeframes"] = sanitized
            changed = True
            notes.append("pruned unsupported monitoredTimeframes values")

    timeframes = normalized.get("timeframes")
    tf_changed = False
    rebuilt_timeframes: dict[str, Any] = {}
    if isinstance(timeframes, dict):
        for category, values in timeframes.items():
            if isinstance(values, list):
                sanitized = _sanitize_timeframes(values)
                rebuilt_timeframes[category] = sanitized
                if sanitized != values:
                    tf_changed = True
            else:
                rebuilt_timeframes[category] = values
    else:
        rebuilt_timeframes = {}
        tf_changed = True

    default_map = default_timeframes_for_sensitive_categories()
    for category, default_values in default_map.items():
        current = rebuilt_timeframes.get(category)
        if isinstance(current, list):
            continue
        if current is not None:
            tf_changed = True
        if category not in rebuilt_timeframes:
            tf_changed = True
        rebuilt_timeframes[category] = list(default_values)

    if tf_changed:
        normalized["timeframes"] = rebuilt_timeframes
        changed = True
        notes.append("normalized timeframe configuration and defaulted sensitive categories to >=1h")

    return normalized, changed, notes
