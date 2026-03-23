import { BINANCE_ENDPOINTS, type MarketType } from '../constants/binance';

export const getMarketUrls = (type: MarketType) => {
    return type === 'spot' ? BINANCE_ENDPOINTS.SPOT : BINANCE_ENDPOINTS.FUTURES;
};

export const getKlineUrl = (symbol: string, interval: string, type: MarketType, limit: number = 500) => {
    const { REST } = getMarketUrls(type);
    const apiPath = type === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
    return `${REST}${apiPath}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
};

export const getWsUrl = (symbol: string, interval: string, type: MarketType) => {
    const { WS } = getMarketUrls(type);
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    return `${WS}/${streamName}`;
};

export const formatSymbolDisplay = (symbol: string, type: MarketType) => {
    return `${symbol} (${type.toUpperCase()})`;
};
