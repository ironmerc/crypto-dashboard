import { useState, useEffect } from 'react';
import useWebSocket from 'react-use-websocket';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';

export interface TickerData {
    symbol: string;
    price: string;
    change24h: string;
    changePercent24h: string;
    volume24h: string;
}

export function useBinanceTickers(symbols: string[]) {
    const [tickers, setTickers] = useState<Record<string, TickerData>>({});
    const streamName = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');

    const { lastJsonMessage } = useWebSocket(`${BINANCE_WS_URL}/${streamName}`, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
    });

    useEffect(() => {
        if (lastJsonMessage) {
            const data = lastJsonMessage as any;
            if (data.e === '24hrTicker') {
                setTickers(prev => ({
                    ...prev,
                    [data.s]: {
                        symbol: data.s,
                        price: parseFloat(data.c).toFixed(4),
                        change24h: parseFloat(data.p).toFixed(4),
                        changePercent24h: parseFloat(data.P).toFixed(2),
                        volume24h: parseFloat(data.v).toFixed(2),
                    }
                }));
            }
        }
    }, [lastJsonMessage]);

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

export function useBinanceOrderBook(symbol: string, limit: number = 20) {
    const [orderBook, setOrderBook] = useState<OrderBookData>({ bids: [], asks: [] });
    const streamUrl = `${BINANCE_WS_URL}/${symbol.toLowerCase()}@depth${limit}@100ms`;

    const { lastJsonMessage } = useWebSocket(streamUrl, {
        shouldReconnect: () => true,
    });

    useEffect(() => {
        if (lastJsonMessage) {
            const data = lastJsonMessage as any;
            if (data.bids && data.asks) {
                setOrderBook({
                    bids: data.bids.map((b: string[]) => ({ price: b[0], quantity: b[1] })),
                    asks: data.asks.map((a: string[]) => ({ price: a[0], quantity: a[1] })),
                });
            }
        }
    }, [lastJsonMessage]);

    return orderBook;
}
