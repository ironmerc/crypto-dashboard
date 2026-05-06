import { useEffect, useRef } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { useTerminalStore, type MonitoredSymbol, type OrderBookLevel, type Side, type Trade } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';
import { BINANCE_ENDPOINTS, type MarketType } from '../constants/binance';

const SPOT_WS = BINANCE_ENDPOINTS.SPOT.WS;

export function useFuturesStream(activeSymbol: MonitoredSymbol, watchSymbols: MonitoredSymbol[]) {
    const setPrice = useTerminalStore(state => state.setPrice);
    const setLivePrice = useTerminalStore(state => state.setLivePrice);
    const setOrderBook = useTerminalStore(state => state.setOrderBook);
    const setOpenInterest = useTerminalStore(state => state.setOpenInterest);
    const setFundingRate = useTerminalStore(state => state.setFundingRate);
    const addEvent = useTerminalStore(state => state.addEvent);
    const addTradesBatch = useTerminalStore(state => state.addTradesBatch);
    const isVisible = usePageVisibility();

    // Declare all refs at the top before any functions or effects that use them (bug fix #4)
    const deepBidsRef = useRef<OrderBookLevel[]>([]);
    const deepAsksRef = useRef<OrderBookLevel[]>([]);
    const fastBidsRef = useRef<OrderBookLevel[]>([]);
    const fastAsksRef = useRef<OrderBookLevel[]>([]);
    const tradeBufferRef = useRef<Trade[]>([]);
    const lastBookSyncRef = useRef<number>(0);
    const SYNC_INTERVAL_MS = 250;

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
    }, [activeSymbol.symbol, activeSymbol.type]);

    // updateMergedBook must be defined BEFORE handleMessage which calls it (bug fix #2)
    const updateMergedBook = (lastUpdateId?: number, force = false) => {
        if (!isVisibleRef.current || !activeSymbolRef.current) return;

        const now = Date.now();
        if (!force && now - lastBookSyncRef.current < SYNC_INTERVAL_MS) return;
        lastBookSyncRef.current = now;

        const mergedBidsMap = new Map<number, OrderBookLevel>();
        for (const l of deepBidsRef.current) mergedBidsMap.set(l.price, l);
        for (const l of fastBidsRef.current) mergedBidsMap.set(l.price, l);
        
        const mergedBids = Array.from(mergedBidsMap.values())
            .sort((a, b) => b.price - a.price)
            .slice(0, 100);

        const mergedAsksMap = new Map<number, OrderBookLevel>();
        for (const l of deepAsksRef.current) mergedAsksMap.set(l.price, l);
        for (const l of fastAsksRef.current) mergedAsksMap.set(l.price, l);

        const mergedAsks = Array.from(mergedAsksMap.values())
            .sort((a, b) => a.price - b.price)
            .slice(0, 100);

        setOrderBook(activeSymbolRef.current.symbol, {
            bids: mergedBids,
            asks: mergedAsks,
            lastUpdateId: lastUpdateId || 0
        });
    };

    const handleMessage = (event: MessageEvent, type: MarketType) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            return;
        }
        // Unwrap combined stream envelope {stream, data} — same pattern as useBinanceWebSocket
        if (msg && !msg.e && msg.data) msg = msg.data;
        if (!msg || !msg.e) return;

        if (msg.e === 'aggTrade') {
            const price = parseFloat(msg.p);
            const qty = parseFloat(msg.q);
            const value = price * qty;
            const side: Side = msg.m ? 'SELL' : 'BUY';

            setPrice(msg.s, price);
            setLivePrice(msg.s, price, 'trade', msg.T);

            // Only buffer trades for the active symbol — other watched symbols must not pollute the tape
            if (msg.s.toUpperCase() === activeSymbolRef.current.symbol.toUpperCase()) {
                tradeBufferRef.current.push({
                    id: Math.random().toString(36).substr(2, 9),
                    price,
                    amount: qty,
                    side,
                    timestamp: msg.T
                });
            }

            if (!isVisibleRef.current) return;

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
            // Bug fix #8: apply depth update as a diff, not a full snapshot replacement.
            // Zero-quantity levels are removals; non-zero are upserts.
            const applyDiff = (existing: OrderBookLevel[], updates: any[]): OrderBookLevel[] => {
                const map = new Map<number, OrderBookLevel>();
                for (const lvl of existing) map.set(lvl.price, lvl);
                for (const u of updates || []) {
                    const price = parseFloat(u[0]);
                    const amount = parseFloat(u[1]);
                    if (amount === 0) {
                        map.delete(price);
                    } else {
                        map.set(price, { price, amount, value: price * amount });
                    }
                }
                return Array.from(map.values());
            };
            fastBidsRef.current = applyDiff(fastBidsRef.current, msg.b)
                .sort((a, b) => b.price - a.price)
                .slice(0, 100);
            fastAsksRef.current = applyDiff(fastAsksRef.current, msg.a)
                .sort((a, b) => a.price - b.price)
                .slice(0, 100);
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

    // aggTrade via WS_MARKET_STREAM — WS_PUBLIC_STREAM is also rejected; market/stream accepts
    // both market and public streams (confirmed: @ticker is public yet works on market/stream)
    const futuresAggTradeUrl = futuresWatch.length > 0
        ? `${BINANCE_ENDPOINTS.FUTURES.WS_MARKET_STREAM}?streams=${futuresWatch.map(s => `${s}@aggTrade`).join('/')}`
        : null;
    useWebSocket(futuresAggTradeUrl, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: (event: MessageEvent) => handleMessage(event, 'futures'),
    });

    // Spot aggTrade + depth subscriptions
    const { sendMessage: sendSpot, readyState: spotState } = useWebSocket(SPOT_WS, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: (event: MessageEvent) => handleMessage(event, 'spot'),
    });

    // Futures depth subscriptions (subscription-based on public WS)
    const { sendMessage: sendFuturesPublic, readyState: futuresPublicState } = useWebSocket(BINANCE_ENDPOINTS.FUTURES.WS_PUBLIC, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: (event: MessageEvent) => handleMessage(event, 'futures'),
    });

    // Futures market event subscriptions (forceOrder, markPrice)
    const { sendMessage: sendFuturesMarket, readyState: futuresMarketState } = useWebSocket(BINANCE_ENDPOINTS.FUTURES.WS_MARKET, {
        shouldReconnect: () => true,
        reconnectInterval: 3000,
        onMessage: (event: MessageEvent) => handleMessage(event, 'futures'),
    });

    const subscribedSpot = useRef<string[]>([]);
    const subscribedFutures = useRef<string[]>([]);
    const subscribedSpotDepth = useRef<string | null>(null);
    const subscribedFuturesDepth = useRef<string | null>(null);

    useEffect(() => {
        if (spotState !== ReadyState.OPEN) {
            subscribedSpot.current = [];
            subscribedSpotDepth.current = null;
            return;
        }

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
        const currentActiveSpotDepth = activeSymbol.type === 'spot' ? activeSymbol.symbol.toLowerCase() : null;

        if (subscribedSpotDepth.current && subscribedSpotDepth.current !== currentActiveSpotDepth) {
            sendSpot(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: [`${subscribedSpotDepth.current}@depth@100ms`],
                id: Date.now() + 2,
            }));
            subscribedSpotDepth.current = null;
        }

        if (currentActiveSpotDepth && subscribedSpotDepth.current !== currentActiveSpotDepth) {
            sendSpot(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [`${currentActiveSpotDepth}@depth@100ms`],
                id: Date.now() + 3,
            }));
            subscribedSpotDepth.current = currentActiveSpotDepth;
        }

        subscribedSpot.current = spotWatch;
    }, [spotWatch.join(','), sendSpot, activeSymbol.symbol, activeSymbol.type, spotState]);

    // Market Subscriptions — forceOrder, markPrice only (openInterest has no WS stream)
    useEffect(() => {
        if (futuresMarketState !== ReadyState.OPEN) {
            subscribedFutures.current = [];
            return;
        }

        const toUnsubFut = subscribedFutures.current.filter(s => !futuresWatch.includes(s));
        const toSubFut = futuresWatch.filter(s => !subscribedFutures.current.includes(s));

        if (toUnsubFut.length > 0) {
            sendFuturesMarket(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: toUnsubFut.flatMap(s => [`${s}@forceOrder`, `${s}@markPrice`]),
                id: Date.now() + 4,
            }));
        }
        if (toSubFut.length > 0) {
            sendFuturesMarket(JSON.stringify({
                method: 'SUBSCRIBE',
                params: toSubFut.flatMap(s => [`${s}@forceOrder`, `${s}@markPrice`]),
                id: Date.now() + 5,
            }));
        }

        subscribedFutures.current = futuresWatch;
    }, [futuresWatch.join(','), sendFuturesMarket, futuresMarketState]);

    // Public Subscriptions (Depth)
    useEffect(() => {
        if (futuresPublicState !== ReadyState.OPEN) {
            subscribedFuturesDepth.current = null;
            return;
        }

        const currentActiveFuturesDepth = activeSymbol.type === 'futures' ? activeSymbol.symbol.toLowerCase() : null;

        if (subscribedFuturesDepth.current && subscribedFuturesDepth.current !== currentActiveFuturesDepth) {
            sendFuturesPublic(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: [`${subscribedFuturesDepth.current}@depth@100ms`],
                id: Date.now() + 6,
            }));
            subscribedFuturesDepth.current = null;
        }

        if (currentActiveFuturesDepth && subscribedFuturesDepth.current !== currentActiveFuturesDepth) {
            sendFuturesPublic(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [`${currentActiveFuturesDepth}@depth@100ms`],
                id: Date.now() + 7,
            }));
            subscribedFuturesDepth.current = currentActiveFuturesDepth;
        }
    }, [activeSymbol.symbol, activeSymbol.type, sendFuturesPublic, futuresPublicState]);

    // Removed duplicate updateMergedBook declaration (moved to before handleMessage — bug fix #2)

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
    // Bug fix #1: removed isVisible — inner guard handles it; isVisible in deps causes burst refetch on tab focus
    }, [activeSymbol.symbol, activeSymbol.type]);

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
