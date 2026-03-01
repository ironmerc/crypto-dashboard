import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EventType = 'Whale' | 'Liquidation' | 'Wall' | 'SmartAlert';
export type Side = 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'NEUTRAL';

export interface MarketEvent {
    id: string;
    type: EventType;
    symbol: string;
    price: number;
    amount: number;
    value: number;
    side: Side;
    timestamp: number;
    title?: string;
    message?: string;
}

export interface OrderBookLevel {
    price: number;
    amount: number;
    value: number; // price * amount
}

export interface OrderBookState {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    lastUpdateId: number;
}

export interface Trade {
    id: string;
    price: number;
    amount: number;
    side: Side;
    timestamp: number;
}

export interface VolumeDelta {
    buyVolume: number;
    sellVolume: number;
    delta: number;
}

export interface TelegramConfig {
    globalEnabled: boolean;
    quietHours: {
        enabled: boolean;
        start: string; // e.g., "22:00"
        end: string;   // e.g., "06:00"
    };
    categories: Record<string, boolean>;
    cooldowns: Record<string, number>;
}

interface TerminalState {
    // Global Timeframe Settings
    globalInterval: string;
    setGlobalInterval: (interval: string) => void;

    // Real-time Prices
    prices: Record<string, number>;
    setPrice: (symbol: string, price: number) => void;

    // Order Book
    orderBook: Record<string, OrderBookState>;
    setOrderBook: (symbol: string, ob: OrderBookState) => void;

    // Detected Walls
    bidWalls: Record<string, OrderBookLevel[]>;
    askWalls: Record<string, OrderBookLevel[]>;
    setWalls: (symbol: string, bids: OrderBookLevel[], asks: OrderBookLevel[]) => void;

    // Smart Money Event Feed & Context
    events: MarketEvent[];
    whaleDelta: Record<string, number>; // Net whale volume (Buy - Sell)
    addEvent: (event: Omit<MarketEvent, 'id'>) => void;
    clearEvents: () => void;

    // Open Interest
    openInterest: Record<string, number>;
    oiHistory: Record<string, { timestamp: number; value: number }[]>;
    setOpenInterest: (symbol: string, oi: number) => void;

    // Funding Rate & Expected Funding
    fundingRate: Record<string, number>;
    fundingHistory: Record<string, { timestamp: number; value: number }[]>;
    setFundingRate: (symbol: string, rate: number) => void;

    // Long/Short Ratio
    longShortRatio: Record<string, number>;
    setLongShortRatio: (symbol: string, ratio: number) => void;

    // Tape, Volume Delta & Volume Profile
    recentTrades: Record<string, Trade[]>;
    volumeDelta: Record<string, VolumeDelta>;
    volumeProfile: Record<string, Map<number, number>>; // Price -> Volume
    sessionPoc: Record<string, number>; // Point of Control (Price)
    sessionVah: Record<string, number>; // Value Area High
    sessionVal: Record<string, number>; // Value Area Low
    addTrade: (symbol: string, trade: Trade) => void;

    // Computed Technical Indicators (from CandleChart)
    currentEMA21: Record<string, number>;
    currentEMA50: Record<string, number>;
    currentVWAP: Record<string, number>;
    currentATR: Record<string, number>;
    currentAtrSma: Record<string, number>;
    currentRSI: Record<string, number>;
    setIndicators: (symbol: string, indicators: { ema21?: number; ema50?: number; vwap?: number; atr?: number; atrSma?: number; rsi?: number }) => void;

    // Telegram Configurations (Persisted)
    telegramConfig: TelegramConfig;
    updateTelegramConfig: (updates: Partial<TelegramConfig>) => void;
}

export const useTerminalStore = create<TerminalState>()(
    persist(
        (set) => ({
            globalInterval: '5m', // Default to 5m
            setGlobalInterval: (interval) => set({
                globalInterval: interval,
                events: [],
                whaleDelta: {},
                volumeProfile: {},
                sessionPoc: {},
                sessionVah: {},
                sessionVal: {},
                volumeDelta: {},
                recentTrades: {}
            }),

            prices: {},
            setPrice: (symbol, price) => set((state) => ({
                prices: { ...state.prices, [symbol]: price }
            })),

            orderBook: {},
            setOrderBook: (symbol, ob) => set((state) => ({
                orderBook: { ...state.orderBook, [symbol]: ob }
            })),

            bidWalls: {},
            askWalls: {},
            setWalls: (symbol, bids, asks) => set((state) => ({
                bidWalls: { ...state.bidWalls, [symbol]: bids },
                askWalls: { ...state.askWalls, [symbol]: asks }
            })),

            events: [],
            whaleDelta: {},
            addEvent: (eventData) => set((state) => {
                // Keep max 100 events to prevent memory leaks
                const newEvent = { ...eventData, id: Math.random().toString(36).substr(2, 9) };
                const newEvents = [newEvent, ...state.events].slice(0, 100);

                // Track Whale Net Aggression
                let newWhaleDelta = state.whaleDelta[eventData.symbol] || 0;
                if (eventData.type === 'Whale') {
                    if (eventData.side === 'BUY') newWhaleDelta += eventData.value;
                    else newWhaleDelta -= eventData.value;
                }

                return {
                    events: newEvents,
                    whaleDelta: { ...state.whaleDelta, [eventData.symbol]: newWhaleDelta }
                };
            }),
            clearEvents: () => set({ events: [], whaleDelta: {} }),

            openInterest: {},
            oiHistory: {},
            setOpenInterest: (symbol, oi) => set((state) => {
                const history = state.oiHistory[symbol] || [];
                const now = Date.now();
                // Keep 24 hours of history
                const newHistory = [...history, { timestamp: now, value: oi }].filter(h => now - h.timestamp < 24 * 60 * 60 * 1000);
                return {
                    openInterest: { ...state.openInterest, [symbol]: oi },
                    oiHistory: { ...state.oiHistory, [symbol]: newHistory }
                };
            }),

            fundingRate: {},
            fundingHistory: {},
            setFundingRate: (symbol, rate) => set((state) => {
                const history = state.fundingHistory[symbol] || [];
                const now = Date.now();
                // Keep 24 hours of history
                const newHistory = [...history, { timestamp: now, value: rate }].filter(h => now - h.timestamp < 24 * 60 * 60 * 1000);
                return {
                    fundingRate: { ...state.fundingRate, [symbol]: rate },
                    fundingHistory: { ...state.fundingHistory, [symbol]: newHistory }
                };
            }),

            longShortRatio: {},
            setLongShortRatio: (symbol, ratio) => set((state) => ({
                longShortRatio: { ...state.longShortRatio, [symbol]: ratio }
            })),

            recentTrades: {},
            volumeDelta: {},
            volumeProfile: {},
            sessionPoc: {},
            sessionVah: {},
            sessionVal: {},
            addTrade: (symbol, trade) => set((state) => {
                const trades = state.recentTrades[symbol] || [];
                const newTrades = [trade, ...trades].slice(0, 50); // Keep last 50 for tape

                const currentDelta = state.volumeDelta[symbol] || { buyVolume: 0, sellVolume: 0, delta: 0 };
                const volume = trade.price * trade.amount;

                let newBuyVolume = currentDelta.buyVolume;
                let newSellVolume = currentDelta.sellVolume;

                if (trade.side === 'BUY') {
                    newBuyVolume += volume;
                } else {
                    newSellVolume += volume;
                }

                // Volume Profile Aggregation
                const currentProfile = state.volumeProfile[symbol] || new Map<number, number>();
                // Group by 10-tick increments to reduce map size (e.g. 64000, 64010)
                // Dynamically find a good bucket size for POC
                const bucketSize = trade.price > 1000 ? 10 : trade.price > 10 ? 0.1 : 0.001;
                const bucketPrice = Math.round(trade.price / bucketSize) * bucketSize;

                const currentVolAtPrice = currentProfile.get(bucketPrice) || 0;
                currentProfile.set(bucketPrice, currentVolAtPrice + volume);

                // Find new POC
                let maxVol = 0;
                let newPoc = state.sessionPoc[symbol] || bucketPrice;
                for (const [p, v] of currentProfile.entries()) {
                    if (v > maxVol) {
                        maxVol = v;
                        newPoc = p;
                    }
                }

                // Calculate VAH and VAL (70% of total volume)
                let totalVol = 0;
                for (const v of currentProfile.values()) totalVol += v;
                const targetVol = totalVol * 0.7;

                // Sort prices to build value area
                const sortedPrices = Array.from(currentProfile.keys()).sort((a, b) => a - b);
                const pocIndex = sortedPrices.indexOf(newPoc);

                let accumulatedVol = currentProfile.get(newPoc) || 0;
                let upIdx = pocIndex + 1;
                let downIdx = pocIndex - 1;

                while (accumulatedVol < targetVol && (upIdx < sortedPrices.length || downIdx >= 0)) {
                    const upVol = upIdx < sortedPrices.length ? currentProfile.get(sortedPrices[upIdx]) || 0 : -1;
                    const downVol = downIdx >= 0 ? currentProfile.get(sortedPrices[downIdx]) || 0 : -1;

                    if (upVol > downVol) {
                        accumulatedVol += upVol;
                        upIdx++;
                    } else {
                        accumulatedVol += downVol;
                        downIdx--;
                    }
                }

                const newVah = sortedPrices[upIdx <= sortedPrices.length && upIdx > 0 ? upIdx - 1 : sortedPrices.length - 1] || newPoc;
                const newVal = sortedPrices[downIdx >= -1 && downIdx < sortedPrices.length - 1 ? downIdx + 1 : 0] || newPoc;

                return {
                    recentTrades: { ...state.recentTrades, [symbol]: newTrades },
                    volumeProfile: { ...state.volumeProfile, [symbol]: currentProfile },
                    sessionPoc: { ...state.sessionPoc, [symbol]: newPoc },
                    sessionVah: { ...state.sessionVah, [symbol]: newVah },
                    sessionVal: { ...state.sessionVal, [symbol]: newVal },
                    volumeDelta: {
                        ...state.volumeDelta,
                        [symbol]: {
                            buyVolume: newBuyVolume,
                            sellVolume: newSellVolume,
                            delta: newBuyVolume - newSellVolume
                        }
                    }
                };
            }),

            currentEMA21: {},
            currentEMA50: {},
            currentVWAP: {},
            currentATR: {},
            currentAtrSma: {},
            currentRSI: {},
            setIndicators: (symbol, indicators) => set((state) => ({
                currentEMA21: indicators.ema21 !== undefined ? { ...state.currentEMA21, [symbol]: indicators.ema21 } : state.currentEMA21,
                currentEMA50: indicators.ema50 !== undefined ? { ...state.currentEMA50, [symbol]: indicators.ema50 } : state.currentEMA50,
                currentVWAP: indicators.vwap !== undefined ? { ...state.currentVWAP, [symbol]: indicators.vwap } : state.currentVWAP,
                currentATR: indicators.atr !== undefined ? { ...state.currentATR, [symbol]: indicators.atr } : state.currentATR,
                currentAtrSma: indicators.atrSma !== undefined ? { ...state.currentAtrSma, [symbol]: indicators.atrSma } : state.currentAtrSma,
                currentRSI: indicators.rsi !== undefined ? { ...state.currentRSI, [symbol]: indicators.rsi } : state.currentRSI,
            })),

            telegramConfig: {
                globalEnabled: true,
                quietHours: {
                    enabled: false,
                    start: "22:00",
                    end: "06:00"
                },
                categories: {
                    "oi_spike": true,
                    "wall": true,
                    "whale": true,
                    "liquidation": true,
                    "atr_expand": true,
                    "funding_extreme": true,
                    "test_ping": true
                },
                cooldowns: {
                    "oi_spike": 300,
                    "wall": 120,
                    "whale": 60,
                    "liquidation": 60,
                    "atr_expand": 300,
                    "funding_extreme": 3600,
                    "test_ping": 5
                }
            },
            updateTelegramConfig: (updates) => set((state) => ({
                telegramConfig: {
                    ...state.telegramConfig,
                    ...updates,
                    categories: { ...state.telegramConfig.categories, ...(updates.categories || {}) },
                    quietHours: { ...state.telegramConfig.quietHours, ...(updates.quietHours || {}) },
                    cooldowns: { ...state.telegramConfig.cooldowns, ...(updates.cooldowns || {}) }
                }
            }))
        }),
        {
            name: 'terminal-storage',
            // Only persist the telegram configuration, skip all the massive market data
            partialize: (state) => ({ telegramConfig: state.telegramConfig }),
        }
    )
);
