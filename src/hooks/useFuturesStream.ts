import { useEffect, useRef } from 'react';
import useWebSocket from 'react-use-websocket';
import { useTerminalStore } from '../store/useTerminalStore';
import type { OrderBookLevel, Side, MarketEvent } from '../store/useTerminalStore';
import { sendTelegramAlert } from './useSmartAlerts';

const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';

// Thresholds for detection
const WHALE_TRADE_USD = 500000; // $500k
const WALL_SIZE_USD = 1000000;  // $1m

export function useFuturesStream(activeSymbol: string, watchSymbols: string[]) {
    const activeSymbolL = activeSymbol.toLowerCase();
    const setPrice = useTerminalStore(state => state.setPrice);
    const setOrderBook = useTerminalStore(state => state.setOrderBook);
    const setWalls = useTerminalStore(state => state.setWalls);
    const addEvent = useTerminalStore(state => state.addEvent);
    const addTrade = useTerminalStore(state => state.addTrade);

    const { sendMessage, lastJsonMessage } = useWebSocket(BINANCE_FUTURES_WS, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
    });

    const subscribedSymbols = useRef<string[]>([]);

    useEffect(() => {
        const watchL = watchSymbols.map(s => s.toLowerCase());
        const toUnsubscribe = subscribedSymbols.current.filter(sym => !watchL.includes(sym));
        const toSubscribe = watchL.filter(sym => !subscribedSymbols.current.includes(sym));

        if (toUnsubscribe.length > 0) {
            sendMessage(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: toUnsubscribe.flatMap(s => [`${s}@aggTrade`, `${s}@forceOrder`]),
                id: Date.now(),
            }));
        }

        if (toSubscribe.length > 0) {
            sendMessage(JSON.stringify({
                method: 'SUBSCRIBE',
                params: toSubscribe.flatMap(s => [`${s}@aggTrade`, `${s}@forceOrder`]),
                id: Date.now() + 1,
            }));
        }

        // Sub/unsub to depth stream ONLY for activeSymbol
        sendMessage(JSON.stringify({
            method: 'SUBSCRIBE',
            params: [`${activeSymbolL}@depth20@100ms`],
            id: Date.now() + 2,
        }));

        subscribedSymbols.current = watchL;

        // Cleanup on unmount handled by global connection closing
    }, [watchSymbols.join(','), sendMessage, activeSymbolL]);

    // Mutable refs to hold the separate books
    const deepBidsRef = useRef<OrderBookLevel[]>([]);
    const deepAsksRef = useRef<OrderBookLevel[]>([]);
    const fastBidsRef = useRef<OrderBookLevel[]>([]);
    const fastAsksRef = useRef<OrderBookLevel[]>([]);

    const mergeBooks = (deep: OrderBookLevel[], fast: OrderBookLevel[], type: 'bids' | 'asks'): OrderBookLevel[] => {
        if (!deep || deep.length === 0) return fast || [];
        if (!fast || fast.length === 0) return deep;

        // fast ends with the furthest price from mid
        const furthestPrice = fast[fast.length - 1].price;
        const remainingDeep = deep.filter(level =>
            type === 'bids' ? level.price < furthestPrice : level.price > furthestPrice
        );

        return [...fast, ...remainingDeep];
    };

    const updateMergedBook = (lastUpdateId: number) => {
        const mergedBids = mergeBooks(deepBidsRef.current, fastBidsRef.current, 'bids');
        const mergedAsks = mergeBooks(deepAsksRef.current, fastAsksRef.current, 'asks');

        setOrderBook(activeSymbol, {
            bids: mergedBids,
            asks: mergedAsks,
            lastUpdateId
        });

        const bidWalls = mergedBids.filter(b => b.value >= WALL_SIZE_USD);
        const askWalls = mergedAsks.filter(a => a.value >= WALL_SIZE_USD);
        setWalls(activeSymbol, bidWalls, askWalls);
    };

    // --- Deep Liquidity REST Poller (Active Symbol Only) ---
    useEffect(() => {
        let isFetching = false;
        const fetchDeepBook = async () => {
            if (isFetching) return;
            isFetching = true;
            try {
                // Use Spot API for deep liquidity (5000 levels gives ~10x wider view than Futures 1000 levels)
                const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${activeSymbol.toUpperCase()}&limit=5000`);
                if (!res.ok) throw new Error('Network response was not ok');
                const data = await res.json();

                const processLevels = (levels: any[]): OrderBookLevel[] => {
                    return levels.map((level: any) => {
                        const price = parseFloat(level[0]);
                        const amount = parseFloat(level[1]);
                        return { price, amount, value: price * amount };
                    });
                };

                const bids = processLevels(data.bids);
                const asks = processLevels(data.asks);

                deepBidsRef.current = bids;
                deepAsksRef.current = asks;

                updateMergedBook(data.lastUpdateId);
            } catch (error) {
                console.error("Deep orderbook fetch error:", error);
            } finally {
                isFetching = false;
            }
        };

        const depthInterval = setInterval(fetchDeepBook, 15000); // Poll every 15 seconds to save API weight
        fetchDeepBook(); // Initial fetch

        // Cleanup on unmount or symbol change
        return () => {
            clearInterval(depthInterval);
        };
    }, [activeSymbol]);

    useEffect(() => {
        if (!lastJsonMessage) return;
        const msg = lastJsonMessage as any;

        if (!msg.e) return;

        // 1. Trade Detection (@aggTrade)
        if (msg.e === 'aggTrade') {
            const price = parseFloat(msg.p);
            const qty = parseFloat(msg.q);
            const value = price * qty;
            const isBuyerMaker = msg.m; // Maker is buyer -> Sell trade
            const side: Side = isBuyerMaker ? 'SELL' : 'BUY';

            setPrice(msg.s, price);

            // Update Volume Delta (Tape)
            addTrade(msg.s, {
                id: Math.random().toString(36).substr(2, 9),
                price,
                amount: qty,
                side,
                timestamp: msg.T
            });

            // Whale Detection
            if (value >= WHALE_TRADE_USD) {
                addEvent({
                    type: 'Whale',
                    symbol: msg.s,
                    price,
                    amount: qty,
                    value,
                    side,
                    timestamp: msg.T
                });

                const config = useTerminalStore.getState().telegramConfig;
                const cdSecs = (config.cooldowns && config.cooldowns['whale']) || 60;
                sendTelegramAlert(
                    `[${msg.s}] 🐋 WHALE ${side} DETECTED`,
                    `Aggressive $${(value / 1000).toFixed(1)}k ${side} execution @ $${price.toFixed(2)}`,
                    `WHALE_${side}_${msg.s}`,
                    cdSecs,
                    'whale'
                );
            }
        }

        // 2. Liquidation Detection (@forceOrder)
        else if (msg.e === 'forceOrder') {
            // liquidate order structure is nested under 'o'
            const order = msg.o;
            if (!order) return;

            const price = parseFloat(order.ap); // average price
            const qty = parseFloat(order.q);
            const value = price * qty;
            const side = order.S === 'BUY' ? 'SHORT' : 'LONG'; // If order is BUY, it means a SHORT is getting liquidated

            const liqEvent: MarketEvent = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'Liquidation',
                symbol: order.s,
                price,
                amount: qty,
                value,
                side: side as Side,
                timestamp: order.T
            };

            addEvent(liqEvent);

            const config = useTerminalStore.getState().telegramConfig;
            const cdSecs = (config.cooldowns && config.cooldowns['liquidation']) || 60;
            sendTelegramAlert(
                `[${order.s}] 💥 LIQ ${side}`,
                `$${(value / 1000).toFixed(1)}k ${side} liquidated @ $${price.toFixed(2)}`,
                `LIQ_${side}_${order.s}`,
                cdSecs,
                'liquidation'
            );
        }

        // 3. WS Depth Updates (Active Symbol Only)
        else if (msg.e === 'depthUpdate' && msg.s.toLowerCase() === activeSymbolL) {
            const processWSLevels = (levels: any[]): OrderBookLevel[] => {
                return levels.map((level: any) => {
                    const price = parseFloat(level[0]);
                    const amount = parseFloat(level[1]);
                    return { price, amount, value: price * amount };
                });
            };

            const fastBids = processWSLevels(msg.b);
            const fastAsks = processWSLevels(msg.a);

            // Only update if it contains data (Binance sometimes sends empty arrays in depth stream)
            if (fastBids.length > 0) fastBidsRef.current = fastBids;
            if (fastAsks.length > 0) fastAsksRef.current = fastAsks;

            updateMergedBook(msg.u);
        }

    }, [lastJsonMessage, setPrice, addEvent, addTrade, activeSymbolL, updateMergedBook]);
}
