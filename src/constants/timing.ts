/** Chart interval label → duration in milliseconds. */
export const TIMEFRAME_MS: Readonly<Record<string, number>> = {
    '1m':  60_000,
    '3m':  3  * 60_000,
    '5m':  5  * 60_000,
    '15m': 15 * 60_000,
    '30m': 30 * 60_000,
    '1h':  60 * 60_000,
    '2h':  2  * 60 * 60_000,
    '4h':  4  * 60 * 60_000,
    '6h':  6  * 60 * 60_000,
    '8h':  8  * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    '1d':  24 * 60 * 60_000,
    '3d':  3  * 24 * 60 * 60_000,
    '1w':  7  * 24 * 60 * 60_000,
    '1M':  30 * 24 * 60 * 60_000,
};

/** Single source of truth for all interval/timeout values (milliseconds). */
export const TIMING = {
    WS_RECONNECT_MS:        3_000,   // react-use-websocket reconnectInterval
    ORDER_BOOK_SYNC_MS:     250,     // order book merge + trade-buffer flush cadence
    LIVE_PRICE_THROTTLE_MS: 250,     // CandleChart live-price update max rate
    ALERT_LOOP_MS:          5_000,   // useSmartAlerts setInterval period
    INDICATOR_POLL_MS:      5_000,   // CandleChart indicator REST poll period
    OI_POLL_MS:             60_000,  // useOpenInterest REST poll period
    DEPTH_POLL_SPOT_MS:     30_000,  // deep order-book REST poll — spot
    DEPTH_POLL_FUTURES_MS:  15_000,  // deep order-book REST poll — futures
    TICKER_HYDRATE_MS:      15_000,  // useBinanceWebSocket 24hr ticker hydration
    TICKER_FLUSH_MS:           300,  // useBinanceWebSocket ticker-buffer → React state flush
} as const;
