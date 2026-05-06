export const BINANCE_ENDPOINTS = {
    SPOT: {
        REST: 'https://api.binance.com',
        WS: 'wss://stream.binance.com:9443/ws',
        WS_STREAM: 'wss://stream.binance.com:9443/stream',
        PATHS: {
            KLINES:        '/api/v3/klines',
            DEPTH:         '/api/v3/depth',
            TICKER_24HR:   '/api/v3/ticker/24hr',
            TICKER_PRICE:  '/api/v3/ticker/price',
            EXCHANGE_INFO: '/api/v3/exchangeInfo',
        },
    },
    FUTURES: {
        REST: 'https://fapi.binance.com',
        WS: 'wss://fstream.binance.com/ws',
        WS_STREAM: 'wss://fstream.binance.com/stream',
        WS_PUBLIC: 'wss://fstream.binance.com/public/ws',
        WS_MARKET: 'wss://fstream.binance.com/market/ws',
        WS_PRIVATE: 'wss://fstream.binance.com/private/ws',
        WS_PUBLIC_STREAM: 'wss://fstream.binance.com/public/stream',
        WS_MARKET_STREAM: 'wss://fstream.binance.com/market/stream',
        PATHS: {
            KLINES:           '/fapi/v1/klines',
            DEPTH:            '/fapi/v1/depth',
            TICKER_24HR:      '/fapi/v1/ticker/24hr',
            TICKER_PRICE:     '/fapi/v1/ticker/price',
            EXCHANGE_INFO:    '/fapi/v1/exchangeInfo',
            OPEN_INTEREST:    '/fapi/v1/openInterest',
            PREMIUM_INDEX:    '/fapi/v1/premiumIndex',
            FUNDING_RATE:     '/fapi/v1/fundingRate',
            LONG_SHORT_RATIO: '/futures/data/globalLongShortAccountRatio',
        },
    },
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
