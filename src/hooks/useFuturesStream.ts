import { useEffect, useRef } from 'react';
import useWebSocket from 'react-use-websocket';
import { useTerminalStore, type MonitoredSymbol, type OrderBookLevel, type Side, type Trade } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';
import { type MarketType } from '../constants/binance';

const FUTURES_WS = 'wss://fstream.binance.com/ws';
const SPOT_WS = 'wss://stream.binance.com:9443/ws';

export function useFuturesStream(activeSymbol: MonitoredSymbol, watchSymbols: MonitoredSymbol[]) {
    const setPrice = useTerminalStore(state => state.setPrice);
    const setOrderBook = useTerminalStore(state => state.setOrderBook);
    const setOpenInterest = useTerminalStore(state => state.setOpenInterest);
    const setFundingRate = useTerminalStore(state => state.setFundingRate);
    const addEvent = useTerminalStore(state => state.addEvent);
    const addTradesBatch = useTerminalStore(state => state.addTradesBatch);
    const isVisible = usePageVisibility();

    const activeSymbolRef = useRef(activeSymbol);
    const watchSymbolsRef = useRef(watchSymbols);
    const isVisibleRef = useRef(isVisible);

    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);
    useEffect(() => { watchSymbolsRef.current = watchSymbols; }, [watchSymbols]);
    useEffect(() => { isVisibleRef.current = isVisible; }, [isVisible]);

    // Cleanup refs on symbol change
    useEffect(() => {
        fastBidsRef.current = [];
        fastAsksRef.current = [];
        tradeBufferRef.current = [];
        // Force an immediate fetch/sync if needed
    }, [activeSymbol.symbol, activeSymbol.type]);

    const handleMessage = (event: MessageEvent, type: MarketType) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            return;
        }
        if (!msg || !msg.e) return;

        if (msg.e === 'aggTrade') {
            const price = parseFloat(msg.p);
            const qty = parseFloat(msg.q);
            const value = price * qty;
            const side: Side = msg.m ? 'SELL' : 'BUY';

            setPrice(msg.s, price);
            if (!isVisibleRef.current) return;

            tradeBufferRef.current.push({
                id: Math.random().toString(36).substr(2, 9),
                price,
                amount: qty,
                side,
                timestamp: msg.T
            });

            // Whale Detection
            const config = useTerminalStore.getState().telegramConfig;
            const thresholdObj = config.thresholds[msg.s] || config.thresholds.global || { whaleMinAmount: 500000 };
            const whaleThreshold = thresholdObj.whaleMinAmount || 500000;

            if (value >= whaleThreshold) {
                addEvent({
                    type: 'Whale',
                    symbol: msg.s,
                    price,
                    amount: qty,
                    value,
                    side,
                    timestamp: msg.T
                });
            }
        }

        else if (msg.e === 'forceOrder' && type === 'futures') {
            const order = msg.o;
            const price = parseFloat(order.ap);
            const qty = parseFloat(order.q);
            const value = price * qty;
            const side = order.S === 'BUY' ? 'SHORT' : 'LONG';

            const config = useTerminalStore.getState().telegramConfig;
            const thresholdObj = config.thresholds[order.s] || config.thresholds.global || { liquidationMinAmount: 500000 };
            const liqThreshold = thresholdObj.liquidationMinAmount || 500000;

            if (value >= liqThreshold) {
                addEvent({
                    type: 'Liquidation',
                    symbol: order.s,
                    price,
                    amount: qty,
                    value,
                    side: side as Side,
                    timestamp: order.T
                });
            }
        }

        else if (msg.e === 'depthUpdate' && msg.s.toUpperCase() === activeSymbolRef.current.symbol.toUpperCase()) {
            const processWSLevels = (levels: any[]): OrderBookLevel[] => {
                return levels.map((level: any) => {
                    const price = parseFloat(level[0]);
                    const amount = parseFloat(level[1]);
                    return { price, amount, value: price * amount };
                });
            };
            fastBidsRef.current = processWSLevels(msg.b);
            fastAsksRef.current = processWSLevels(msg.a);
            if (isVisibleRef.current) updateMergedBook(msg.u);
        }

        else if (msg.e === 'openInterestUpdate') {
            setOpenInterest(msg.s, parseFloat(msg.o));
        }

        else if (msg.e === 'markPriceUpdate' && msg.r) {
            setFundingRate(msg.s, parseFloat(msg.r));
        }
    };

    // Group watch symbols
    const spotWatch = watchSymbols.filter(m => m.type === 'spot').map(m => m.symbol.toLowerCase());
    const futuresWatch = watchSymbols.filter(m => m.type === 'futures').map(m => m.symbol.toLowerCase());

    // Separate WS connections
    const { sendMessage: sendSpot } = useWebSocket(SPOT_WS, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: (event: MessageEvent) => handleMessage(event, 'spot'),
    });

    const { sendMessage: sendFutures } = useWebSocket(FUTURES_WS, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: (event: MessageEvent) => handleMessage(event, 'futures'),
    });

    const subscribedSpot = useRef<string[]>([]);
    const subscribedFutures = useRef<string[]>([]);

    useEffect(() => {
        // Handle Spot Subscriptions
        const toUnsubSpot = subscribedSpot.current.filter(s => !spotWatch.includes(s));
        const toSubSpot = spotWatch.filter(s => !subscribedSpot.current.includes(s));

        if (toUnsubSpot.length > 0) {
            sendSpot(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: toUnsubSpot.flatMap(s => [`${s}@aggTrade`]),
                id: Date.now(),
            }));
        }
        if (toSubSpot.length > 0) {
            sendSpot(JSON.stringify({
                method: 'SUBSCRIBE',
                params: toSubSpot.flatMap(s => [`${s}@aggTrade`]),
                id: Date.now() + 1,
            }));
        }

        // Depth for active Spot
        if (activeSymbol.type === 'spot') {
            sendSpot(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [`${activeSymbol.symbol.toLowerCase()}@depth20@100ms`],
                id: Date.now() + 2,
            }));
        }

        subscribedSpot.current = spotWatch;
    }, [spotWatch.join(','), sendSpot, activeSymbol.symbol, activeSymbol.type]);

    useEffect(() => {
        // Handle Futures Subscriptions
        const toUnsubFut = subscribedFutures.current.filter(s => !futuresWatch.includes(s));
        const toSubFut = futuresWatch.filter(s => !subscribedFutures.current.includes(s));

        if (toUnsubFut.length > 0) {
            sendFutures(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: toUnsubFut.flatMap(s => [`${s}@aggTrade`, `${s}@forceOrder`, `${s}@openInterest@500ms`, `${s}@markPrice`]),
                id: Date.now() + 3,
            }));
        }
        if (toSubFut.length > 0) {
            sendFutures(JSON.stringify({
                method: 'SUBSCRIBE',
                params: toSubFut.flatMap(s => [`${s}@aggTrade`, `${s}@forceOrder`, `${s}@openInterest@500ms`, `${s}@markPrice`]),
                id: Date.now() + 4,
            }));
        }

        // Depth for active Futures
        if (activeSymbol.type === 'futures') {
            sendFutures(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [`${activeSymbol.symbol.toLowerCase()}@depth20@100ms`],
                id: Date.now() + 5,
            }));
        }

        subscribedFutures.current = futuresWatch;
    }, [futuresWatch.join(','), sendFutures, activeSymbol.symbol, activeSymbol.type]);

    const deepBidsRef = useRef<OrderBookLevel[]>([]);
    const deepAsksRef = useRef<OrderBookLevel[]>([]);
    const fastBidsRef = useRef<OrderBookLevel[]>([]);
    const fastAsksRef = useRef<OrderBookLevel[]>([]);
    
    const tradeBufferRef = useRef<Trade[]>([]);
    const lastBookSyncRef = useRef<number>(0);
    const SYNC_INTERVAL_MS = 250;

    const updateMergedBook = (lastUpdateId?: number, force = false) => {
        if (!isVisibleRef.current || !activeSymbolRef.current) return;
        
        const now = Date.now();
        if (!force && now - lastBookSyncRef.current < SYNC_INTERVAL_MS) return;
        lastBookSyncRef.current = now;

        const currentActive = activeSymbolRef.current;
        const mergedBids = [...fastBidsRef.current, ...deepBidsRef.current.filter(l => 
            currentActive.type === 'spot' ? true : l.price < (fastBidsRef.current[fastBidsRef.current.length - 1]?.price || 0)
        )].slice(0, 100);
        const mergedAsks = [...fastAsksRef.current, ...deepAsksRef.current.filter(l => 
            currentActive.type === 'spot' ? true : l.price > (fastAsksRef.current[fastAsksRef.current.length - 1]?.price || 0)
        )].slice(0, 100);

        setOrderBook(currentActive.symbol, {
            bids: mergedBids,
            asks: mergedAsks,
            lastUpdateId: lastUpdateId || 0
        });
    };

    // --- Deep Liquidity REST Poller ---
    useEffect(() => {
        let isFetching = false;
        const fetchDeepBook = async () => {
            if (isFetching || !isVisibleRef.current) return;
            
            const currentSymbol = activeSymbol.symbol;
            if (!currentSymbol || currentSymbol.length < 5) return; // Skip invalid symbols
            isFetching = true;
            try {
                const apiBase = activeSymbol.type === 'spot' ? 'https://api.binance.com' : 'https://fapi.binance.com';
                const apiPath = activeSymbol.type === 'spot' ? '/api/v3/depth' : '/fapi/v1/depth';
                const limit = activeSymbol.type === 'spot' ? 1000 : 1000;

                const res = await fetch(`${apiBase}${apiPath}?symbol=${currentSymbol.toUpperCase()}&limit=${limit}`);
                if (!res.ok) throw new Error('Network response was not ok');
                const data = await res.json();

                // Double check if symbol is still active
                if (activeSymbolRef.current.symbol !== currentSymbol) return;

                const processLevels = (levels: any[]): OrderBookLevel[] => {
                    return levels.map((level: any) => {
                        const price = parseFloat(level[0]);
                        const amount = parseFloat(level[1]);
                        return { price, amount, value: price * amount };
                    });
                };

                deepBidsRef.current = processLevels(data.bids);
                deepAsksRef.current = processLevels(data.asks);
                updateMergedBook(data.lastUpdateId);
            } catch (error) {
                console.error("Deep orderbook fetch error:", error);
            } finally {
                isFetching = false;
            }
        };

        const depthInterval = setInterval(fetchDeepBook, activeSymbol.type === 'spot' ? 30000 : 15000);
        fetchDeepBook();

        return () => clearInterval(depthInterval);
    }, [activeSymbol.symbol, activeSymbol.type, isVisible]);

    // --- Trade Batch Flusher ---
    useEffect(() => {
        const currentSymbol = activeSymbol.symbol;
        if (!currentSymbol) return;
        
        const flushTrades = () => {
            if (activeSymbolRef.current.symbol !== currentSymbol || tradeBufferRef.current.length === 0 || !isVisibleRef.current) return;
            addTradesBatch(currentSymbol, [...tradeBufferRef.current]);
            tradeBufferRef.current = [];
        };
        const interval = setInterval(flushTrades, SYNC_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [activeSymbol?.symbol, addTradesBatch]);

    useEffect(() => { if (isVisible) updateMergedBook(); }, [isVisible]);
}
