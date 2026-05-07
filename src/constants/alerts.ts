/** Order-book and REST API size limits. */
export const ORDER_BOOK_LIMIT      = 100;   // bids/asks sliced to this after merge
export const DEPTH_REST_LIMIT      = 1_000; // deep book REST request limit param
export const KLINE_HISTORY_LIMIT   = 500;   // klines fetched for indicator bootstrap
export const FUNDING_HISTORY_LIMIT = 48;    // funding-rate history bars (48 × 8h = 16 days)

/**
 * Default threshold fallbacks used by useSmartAlerts when the store has no
 * configured value.  These must stay in sync with config_utils.DEFAULT_THRESHOLDS
 * on the backend — update both together.
 */
export const ALERT_DEFAULTS = {
    ATR_EXPANSION_RATIO:         1.3,
    OI_SPIKE_PERCENTAGE:         1.5,
    MACD_FRESHNESS_RATIO:        0.1,
    BB_SQUEEZE_WIDTH_PCT:        2.0,
    STOCH_OVERBOUGHT:            85,
    STOCH_OVERSOLD:              15,
    OI_DIVERGENCE_LOOKBACK_BARS: 6,
    WHALE_MIN_AMOUNT:            500_000,
    LIQUIDATION_MIN_AMOUNT:      1_000_000,
    COOLDOWN_DEFAULT_SECS:       300,
} as const;

/**
 * Build the Telegram HTML message body.
 * Mirrors format_alert_message() in telegram-bot/constants.py — keep in sync.
 */
export const formatAlertMessage = (
    title: string,
    message: string,
    tf?: string,
): string => `<b>🚨 ${title}${tf ? ` [${tf}]` : ''}</b>\n\n${message}`;

/** Build the standard alert title: "[BTCUSDT] ALERT NAME" */
export const formatAlertTitle = (symbol: string, alertName: string): string =>
    `[${symbol}] ${alertName}`;
