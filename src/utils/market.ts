import { BINANCE_ENDPOINTS, type MarketType } from '../constants/binance';

export const getMarketUrls = (type: MarketType) => {
    return type === 'spot' ? BINANCE_ENDPOINTS.SPOT : BINANCE_ENDPOINTS.FUTURES;
};

export const getKlineUrl = (symbol: string, interval: string, type: MarketType, limit: number = 500) => {
    const urls = getMarketUrls(type);
    const path = type === 'spot' ? urls.PATHS.KLINES : (urls as typeof BINANCE_ENDPOINTS.FUTURES).PATHS.KLINES;
    const params = new URLSearchParams({ symbol: symbol.toUpperCase(), interval, limit: String(limit) });
    return `${urls.REST}${path}?${params}`;
};

export const getWsUrl = (symbol: string, interval: string, type: MarketType) => {
    const urls = getMarketUrls(type);
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    if (type === 'spot') return `${urls.WS}/${streamName}`;
    // Futures: /public/ws/ rejects direct-path URLs; use /ws/ which still works for klines
    return `${(urls as typeof BINANCE_ENDPOINTS.FUTURES).WS}/${streamName}`;
};

export const formatSymbolDisplay = (symbol: string, type: MarketType) => {
    return `${symbol} (${type.toUpperCase()})`;
};
