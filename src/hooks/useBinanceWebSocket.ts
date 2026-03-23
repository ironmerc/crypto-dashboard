import { useState, useEffect, useRef } from 'react';
import useWebSocket from 'react-use-websocket';
import { usePageVisibility } from './usePageVisibility';

import { type MonitoredSymbol } from '../store/useTerminalStore';
import { formatPrice } from '../utils/formatters';

const FUTURES_WS_URL = 'wss://fstream.binance.com/stream';
const SPOT_WS_URL = 'wss://stream.binance.com:9443/stream';

export interface TickerData {
    symbol: string;
    price: string;
    change24h: string;
    changePercent24h: string;
    volume24h: string;
}

export function useBinanceTickers(monitoredSymbols: MonitoredSymbol[]) {
    const [tickers, setTickers] = useState<Record<string, TickerData>>({});
    const isVisible = usePageVisibility();
    const isVisibleRef = useRef(isVisible);
    const tickerBufferRef = useRef<Record<string, TickerData>>({});

    useEffect(() => { isVisibleRef.current = isVisible; }, [isVisible]);

    // Group symbols by type
    const spotSymbols = monitoredSymbols
        .filter(m => m.type === 'spot' && m.symbol.length >= 5)
        .map(m => m.symbol.toLowerCase());
    const futuresSymbols = monitoredSymbols
        .filter(m => m.type === 'futures' && m.symbol.length >= 5)
        .map(m => m.symbol.toLowerCase());

    const spotStreamName = spotSymbols.map(s => `${s}@ticker`).join('/');
    const futuresStreamName = futuresSymbols.map(s => `${s}@ticker`).join('/');

    const handleTickerMessage = (event: MessageEvent) => {
        if (!isVisibleRef.current) return;
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            return;
        }
        
        const data = msg.data || msg;
        if (data && data.e === '24hrTicker') {
            tickerBufferRef.current[data.s] = {
                symbol: data.s,
                price: formatPrice(parseFloat(data.c)),
                change24h: formatPrice(parseFloat(data.p)),
                changePercent24h: parseFloat(data.P).toFixed(2),
                volume24h: (parseFloat(data.v) * parseFloat(data.c) / 1000000).toFixed(2), // In Millions
            };
        }
    };

    // Hook for Spot
    useWebSocket(spotSymbols.length > 0 ? `${SPOT_WS_URL}?streams=${spotStreamName}` : null, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: handleTickerMessage,
    });

    // Hook for Futures
    useWebSocket(futuresSymbols.length > 0 ? `${FUTURES_WS_URL}?streams=${futuresStreamName}` : null, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: handleTickerMessage,
    });

    // Throttled update to UI state
    useEffect(() => {
        const timer = setInterval(() => {
            if (Object.keys(tickerBufferRef.current).length > 0) {
                setTickers(prev => ({
                    ...prev,
                    ...tickerBufferRef.current
                }));
                tickerBufferRef.current = {};
            }
        }, 300); // Faster update (300ms) for better responsiveness
        return () => clearInterval(timer);
    }, []);

    return tickers;
}

export interface SpotOrderBookLevel {
    price: string;
    quantity: string;
}

export interface OrderBookData {
    bids: SpotOrderBookLevel[];
    asks: SpotOrderBookLevel[];
}

export function useBinanceOrderBook(symbol: string, type: 'spot' | 'futures', limit: number = 20) {
    const [orderBook, setOrderBook] = useState<OrderBookData>({ bids: [], asks: [] });
    const isVisible = usePageVisibility();
    const baseUrl = type === 'spot' ? SPOT_WS_URL : FUTURES_WS_URL;
    const streamUrl = symbol.length >= 5 ? `${baseUrl}?streams=${symbol.toLowerCase()}@depth${limit}@100ms` : null;

    const { lastJsonMessage } = useWebSocket(streamUrl, {
        shouldReconnect: () => true,
    });

    useEffect(() => {
        if (lastJsonMessage && isVisible) {
            const data = lastJsonMessage as any;
            if (data.bids && data.asks) {
                setOrderBook({
                    bids: data.bids.map((b: string[]) => ({ price: b[0], quantity: b[1] })),
                    asks: data.asks.map((a: string[]) => ({ price: a[0], quantity: a[1] })),
                });
            }
        }
    }, [lastJsonMessage, isVisible]);

    return orderBook;
}
