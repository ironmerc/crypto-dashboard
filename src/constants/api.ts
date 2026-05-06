// Internal bot API — all requests proxied via nginx /api/bot/ → telegram-bot:8888/
const BOT_BASE = import.meta.env.VITE_BOT_BASE_URL ?? '/api/bot';

export const BOT_API = {
    ALERT:        `${BOT_BASE}/alert`,
    STATUS:       `${BOT_BASE}/status`,
    HISTORY:      `${BOT_BASE}/history`,
    CONFIG:       `${BOT_BASE}/config`,
    PRICE_ALERTS: `${BOT_BASE}/alerts/price`,
    MARKET: (type: string, symbol: string, interval: string) =>
        `${BOT_BASE}/market/${type}/${symbol}/${interval}`,
} as const;

// Third-party public APIs
export const THIRD_PARTY_API = {
    COINBASE_BASE: 'https://api.exchange.coinbase.com',
    FEAR_GREED:    'https://api.alternative.me/fng/',
} as const;
