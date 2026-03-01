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

    // --- Track Funding Rate Extremes ---
    const lastFundingAlertTime = useRef<number>(0);
    const FUNDING_ALERT_COOLDOWN = 12 * 60 * 60 * 1000; // 12 hours
    const FUNDING_EXTREME_THRESHOLD = 0.0005; // 0.05%

    useEffect(() => {
        if (!activeSymbol) return;

        const checkFunding = () => {
            const currentFunding = useTerminalStore.getState().fundingRate[activeSymbol];
            if (!currentFunding) return;

            const config = useTerminalStore.getState().telegramConfig;
            // Respect global enable status and specific toggle (if it exists, falling back to true for now if not explicitly modeled)
            if (!config.globalEnabled) return;

            const now = Date.now();
            if (now - lastFundingAlertTime.current < FUNDING_ALERT_COOLDOWN) return;

            if (Math.abs(currentFunding) >= FUNDING_EXTREME_THRESHOLD) {
                const directionText = currentFunding > 0 ? '🟢 High Positive' : '🔴 Deep Negative';
                const actionText = currentFunding > 0 ? 'Longs paying Shorts heavily' : 'Shorts paying Longs heavily';

                const title = `🚨 [${activeSymbol}] Funding Rate Extreme`;
                const msg = `
*Status:* ${directionText}
*Current Rate:* ${(currentFunding * 100).toFixed(4)}%
*Implication:* ${actionText}
*Threshold:* ±${(FUNDING_EXTREME_THRESHOLD * 100).toFixed(2)}%

_Market may be over-leveraged in one direction._
                `.trim();

                sendTelegramAlert(title, msg, `FUNDING_EXTREME_${activeSymbol}`, 12 * 60 * 60, 'funding');
                lastFundingAlertTime.current = now;
            }
        };

        // Check on mount and set interval to check every minute as funding updates
        checkFunding();
        const interval = setInterval(checkFunding, 60000);

        return () => clearInterval(interval);
    }, [activeSymbol]);

    // --- Track Value Area Breakouts ---
    const lastVABreakoutTime = useRef<number>(0);
    const prevPos = useRef<'IN' | 'ABOVE' | 'BELOW'>('IN');

    useEffect(() => {
        if (!activeSymbol) return;

        const checkBreakout = () => {
            const state = useTerminalStore.getState();
            const price = state.prices[activeSymbol];
            const vah = state.sessionVah[activeSymbol];
            const val = state.sessionVal[activeSymbol];

            if (!price || !vah || !val) return;

            const config = state.telegramConfig;
            // Temporarily gating it on globalEnabled, in the future we can add a specific toggle to the settings UI
            if (!config.globalEnabled) return;

            const now = Date.now();

            let currentPos: 'IN' | 'ABOVE' | 'BELOW' = 'IN';
            // Require a 0.1% buffer to avoid noise around the exact boundary
            const buffer = price * 0.001;

            if (price > vah + buffer) currentPos = 'ABOVE';
            else if (price < val - buffer) currentPos = 'BELOW';

            // Only trigger on state change OUT of the value area
            if (currentPos !== 'IN' && prevPos.current === 'IN') {
                // 1 hour cooldown per asset for value area alerts
                if (now - lastVABreakoutTime.current >= 60 * 60 * 1000) {
                    const isAbove = currentPos === 'ABOVE';
                    const title = `📈 [${activeSymbol}] Value Area Breakout`;

                    const msg = `
*Direction:* ${isAbove ? '🟢 Breaking VAH (Bullish)' : '🔴 Breaking VAL (Bearish)'}
*Current Price:* $${price.toFixed(2)}

*Value Area Bounds:*
VAH: $${vah.toFixed(2)}
VAL: $${val.toFixed(2)}

_Price has gained acceptance outside the high-volume node._
                     `.trim();

                    sendTelegramAlert(title, msg, `VA_BREAKOUT_${currentPos}_${activeSymbol}`, 60 * 60, 'value_area');
                    lastVABreakoutTime.current = now;
                }
            }

            prevPos.current = currentPos;
        };

        const interval = setInterval(checkBreakout, 5000); // Check every 5s
        return () => clearInterval(interval);

    }, [activeSymbol]);

    // --- Track Whale Net Flow Momentum Shifts ---
    const lastWhaleMomentumAlertTime = useRef<number>(0);
    const WHALE_MOMENTUM_COOLDOWN = 15 * 60 * 1000; // 15 mins
    const WHALE_SHIFT_THRESHOLD_USD = 5000000; // $5M swing required to trigger

    // We store the trailing whale delta to compare against the current
    const prevWhaleDelta = useRef<number | null>(null);

    useEffect(() => {
        if (!activeSymbol) return;

        const checkWhaleMomentum = () => {
            const state = useTerminalStore.getState();
            const config = state.telegramConfig;

            if (!config.globalEnabled || !config.categories?.whale) return;

            const currentDelta = state.whaleDelta[activeSymbol] || 0;

            if (prevWhaleDelta.current !== null) {
                const shiftDelta = currentDelta - prevWhaleDelta.current;
                const now = Date.now();

                // Alert if the swing is larger than $5M and cooldown has passed
                if (Math.abs(shiftDelta) >= WHALE_SHIFT_THRESHOLD_USD) {
                    if (now - lastWhaleMomentumAlertTime.current > WHALE_MOMENTUM_COOLDOWN) {
                        const isBullish = shiftDelta > 0;
                        const title = `🐋💨 [${activeSymbol}] Whale Momentum Shift`;
                        const msg = `
*Direction:* ${isBullish ? '🟢 Massive Accumulation' : '🔴 Massive Distribution'}
*15m Net Flow Shift:* ${isBullish ? '+' : '-'}$${(Math.abs(shiftDelta) / 1000000).toFixed(2)}M

_Smart money is aggressively executing along a single vector._
                        `.trim();

                        sendTelegramAlert(title, msg, `WHALE_MOM_${isBullish ? 'BULL' : 'BEAR'}_${activeSymbol}`, Math.floor(WHALE_MOMENTUM_COOLDOWN / 1000), 'whale');
                        lastWhaleMomentumAlertTime.current = now;
                    }
                }
            }

            // Update the trailing snapshot
            prevWhaleDelta.current = currentDelta;
        };

        // Snapshot and check every 15 minutes
        const interval = setInterval(checkWhaleMomentum, 15 * 60 * 1000);
        return () => clearInterval(interval);

    }, [activeSymbol]);

    // --- Track RVOL Anomalies (5m rolling) ---
    const lastRvolAlertTime = useRef<number>(0);
    const RVOL_COOLDOWN = 60 * 60 * 1000; // 1 hour per asset
    const RVOL_THRESHOLD = 3; // 3x average volume

    // We store historical 5m volume buckets to calculate a simple moving average
    const volumeBuckets = useRef<{ timestamp: number; volume: number }[]>([]);

    useEffect(() => {
        if (!activeSymbol) return;

        const checkRvol = () => {
            const state = useTerminalStore.getState();
            const config = state.telegramConfig;

            if (!config.globalEnabled) return;

            const now = Date.now();
            const currentDelta = state.volumeDelta[activeSymbol];
            if (!currentDelta) return;

            const totalCurrentVolume = currentDelta.buyVolume + currentDelta.sellVolume;

            // Maintain a rolling 60-minute array of 5m volume snapshots (12 buckets)
            const buckets = volumeBuckets.current;

            // If it's a new 5m period, push a new bucket
            if (buckets.length === 0 || now - buckets[buckets.length - 1].timestamp >= 5 * 60 * 1000) {
                buckets.push({ timestamp: now, volume: totalCurrentVolume });
                // Keep only the last 12 buckets (1 hour of 5m data)
                if (buckets.length > 12) buckets.shift();
            } else {
                // Update the current bucket with the latest cumulative volume for this period
                buckets[buckets.length - 1].volume = totalCurrentVolume;
            }

            // We need at least 3 buckets (15 mins) to calculate a meaningful average
            if (buckets.length < 3) return;

            // Calculate the average volume of all PREVIOUS buckets (excluding the current incomplete one)
            let sumVol = 0;
            for (let i = 0; i < buckets.length - 1; i++) {
                sumVol += buckets[i].volume;
            }
            const avgVol = sumVol / (buckets.length - 1);

            if (avgVol === 0) return;

            // Calculate current 5m volume (since the last bucket started)
            // If it's the first bucket, it's just the current volume. Otherwise, delta from the last bucket.
            const current5mVol = buckets.length > 1
                ? totalCurrentVolume - buckets[buckets.length - 2].volume
                : totalCurrentVolume;

            const rvol = current5mVol / avgVol;

            if (rvol >= RVOL_THRESHOLD) {
                if (now - lastRvolAlertTime.current > RVOL_COOLDOWN) {
                    const dominantSide = currentDelta.buyVolume > currentDelta.sellVolume ? '🟢 Buying' : '🔴 Selling';
                    const title = `🌋 [${activeSymbol}] Abnormal RVOL Detected`;
                    const msg = `
*RVOL Spike:* ${rvol.toFixed(1)}x Average
*Dominant Pressure:* ${dominantSide}
*5m Volume:* $${(current5mVol / 1000000).toFixed(2)}M

_Extremely high activity detected, potentially signaling a major move or absorption._
                    `.trim();

                    sendTelegramAlert(title, msg, `RVOL_${activeSymbol}`, Math.floor(RVOL_COOLDOWN / 1000), 'rvol');
                    lastRvolAlertTime.current = now;
                }
            }
        };

        const interval = setInterval(checkRvol, 10000); // Poll every 10s
        return () => clearInterval(interval);

    }, [activeSymbol]);

    // --- Daily Market Wrap-Up (00:00 UTC) ---
    const lastDailyWrapUpTime = useRef<number>(0);

    useEffect(() => {
        if (!activeSymbol) return;

        const checkDailyWrapUp = () => {
            const state = useTerminalStore.getState();
            const config = state.telegramConfig;

            if (!config.globalEnabled) return;

            const now = new Date();
            const isMidnightUTC = now.getUTCHours() === 0 && now.getUTCMinutes() === 0;

            // We only send it once per day when the clock strikes 00:00
            if (isMidnightUTC && now.getTime() - lastDailyWrapUpTime.current > 23 * 60 * 60 * 1000) {
                const price = state.prices[activeSymbol];
                const funding = state.fundingRate[activeSymbol];
                const whaleDelta = state.whaleDelta[activeSymbol] || 0;
                const oiInfo = state.oiHistory[activeSymbol];

                let oiChangeRaw = 0;
                if (oiInfo && oiInfo.length > 0) {
                    // Get the oldest record we have in the last 24h
                    const startOfDayOi = oiInfo[0].value;
                    const endOfDayOi = oiInfo[oiInfo.length - 1].value;
                    oiChangeRaw = endOfDayOi - startOfDayOi;
                }

                const title = `📅 [${activeSymbol}] Daily Market Wrap-Up`;
                const msg = `
*End of Day Metrics (UTC):*

*Closing Price:* $${price ? price.toFixed(2) : 'N/A'}
*Net Whale Flow (24h):* ${whaleDelta > 0 ? '+' : ''}$${(whaleDelta / 1000000).toFixed(2)}M
*Net OI Change (24h):* ${oiChangeRaw > 0 ? '+' : ''}$${(oiChangeRaw * (price || 1) / 1000000).toFixed(2)}M
*Current Funding:* ${funding ? (funding * 100).toFixed(4) + '%' : 'N/A'}

_Session closed, data reset for the new day._
                 `.trim();

                sendTelegramAlert(title, msg, `DAILY_WRAP_${activeSymbol}`, 24 * 60 * 60, 'market_context');
                lastDailyWrapUpTime.current = now.getTime();
            }
        };

        const interval = setInterval(checkDailyWrapUp, 60000); // Check every minute
        return () => clearInterval(interval);

    }, [activeSymbol]);

}
