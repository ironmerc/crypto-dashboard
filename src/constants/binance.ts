export const BINANCE_ENDPOINTS = {
    SPOT: {
        REST: 'https://api.binance.com',
        WS: 'wss://stream.binance.com:9443/ws',
    },
    FUTURES: {
        REST: 'https://fapi.binance.com',
        WS: 'wss://fstream.binance.com/ws',
    }
} as const;

export const DEFAULT_POPULAR_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'NEARUSDT',
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT',
];

export const KLINE_INTERVALS = [
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'
] as const;

export type MarketType = 'spot' | 'futures';
