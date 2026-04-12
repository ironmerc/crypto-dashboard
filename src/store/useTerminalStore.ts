import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
    type PriceAlertDirection,
    normalizePriceAlertDirection,
} from './priceAlerts';

export type EventType = 'Whale' | 'Liquidation' | 'Wall' | 'SmartAlert';
export type Side = 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'NEUTRAL';

export interface MonitoredSymbol {
    symbol: string;
    type: 'spot' | 'futures';
}

export interface PriceAlert {
    id: string;
    symbol: string;
    price: number;
    direction: PriceAlertDirection;
    createdAt: number;
}

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

export interface TelegramThresholds {
    whaleMinAmount: number;
    liquidationMinAmount: number;
    oiSpikePercentage: number;
    fundingExtremeRate: number;
    atrExpansionRatio: number;
    whaleMomentumDelta: number;
    rvolMultiplier: number;
    rsiOverbought: number;
    rsiOversold: number;
    emaSeparationPct: number;
    macdFreshnessRatio: number;
    bbSqueezeWidthPct: number;
    stochOverbought: number;
    stochOversold: number;
    oiDivergenceLookbackBars: number;
}

export interface TelegramConfig {
    globalEnabled: boolean;
    activeSessions: string[]; // e.g., ['London', 'US', 'Asia']
    monitoredSymbols: (string | MonitoredSymbol)[]; // e.g., ['BTCUSDT', { symbol: 'ETHUSDT', type: 'spot' }]
    alertOnStateChange: boolean;
    quietHours: {
        enabled: boolean;
        start: string; // e.g., "22:00"
        end: string;   // e.g., "06:00"
    };
    categories: Record<string, boolean>;
    cooldowns: Record<string, number>;
    thresholds: Record<string, TelegramThresholds>; // symbol -> thresholds, plus "global" key
    timeframes: Record<string, string[]>; // category -> enabled timeframes, e.g. { 'regime_shift': ['15m', '1h'] }
}

const DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES = ['1h', '4h', '1d', '1w', '1M'];
const DEFAULT_TIMEFRAMES_BY_CATEGORY: Record<string, string[]> = {
    atr_expand: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    ema_cross: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    level_testing: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    oi_spike: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    rsi_extreme: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    rvol_spike: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    macd_cross: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    bb_squeeze: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    bb_breakout: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    stoch_extreme: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
    oi_divergence: [...DEFAULT_TIMEFRAME_SENSITIVE_TIMEFRAMES],
};

const DEFAULT_TELEGRAM_THRESHOLDS: TelegramThresholds = {
    whaleMinAmount: 500000,
    liquidationMinAmount: 1000000,
    oiSpikePercentage: 1.5,
    fundingExtremeRate: 0.05,
    atrExpansionRatio: 1.3,
    whaleMomentumDelta: 5000000,
    rvolMultiplier: 3.0,
    rsiOverbought: 70,
    rsiOversold: 30,
    emaSeparationPct: 0.15,
    macdFreshnessRatio: 0.1,
    bbSqueezeWidthPct: 2.0,
    stochOverbought: 85,
    stochOversold: 15,
    oiDivergenceLookbackBars: 6,
};

const normalizeThresholdScopes = (
    thresholds?: Record<string, Partial<TelegramThresholds>>
): Record<string, TelegramThresholds> => {
    const source = thresholds || {};
    const normalizedGlobal: TelegramThresholds = {
        ...DEFAULT_TELEGRAM_THRESHOLDS,
        ...(source.global || {}),
    };
    const normalized: Record<string, TelegramThresholds> = {
        global: normalizedGlobal,
    };

    Object.entries(source).forEach(([scope, value]) => {
        if (scope === 'global') return;
        normalized[scope] = {
            ...normalizedGlobal,
            ...(value || {}),
        };
    });

    return normalized;
};

const normalizePriceAlert = (
    alert: Partial<PriceAlert> & { side?: string }
): PriceAlert => ({
    id: String(alert.id || Math.random().toString(36).slice(2, 11)),
    symbol: String(alert.symbol || '').toUpperCase().trim(),
    price: Number(alert.price || 0),
    direction: normalizePriceAlertDirection(alert.direction, alert.side),
    createdAt: Number(alert.createdAt || Date.now()),
});

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
    predictedFundingRate: Record<string, number>;
    nextFundingTime: Record<string, number>;
    setFundingRate: (symbol: string, rate: number) => void;
    setPredictedFunding: (symbol: string, predictedRate: number, nextTime: number) => void;
    backfillFundingHistory: (symbol: string, history: { timestamp: number; value: number }[]) => void;

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
    addTradesBatch: (symbol: string, trades: Trade[]) => void;

    // Computed Technical Indicators (from CandleChart)
    currentEMA21: Record<string, number>;
    currentEMA50: Record<string, number>;
    currentVWAP: Record<string, number>;
    currentATR: Record<string, number>;
    currentAtrSma: Record<string, number>;
    currentRSI: Record<string, number>;
    currentMACD: Record<string, { macd: number; signal: number; histogram: number }>;
    currentBB: Record<string, { upper: number; middle: number; lower: number; width: number }>;
    currentStochRSI: Record<string, { k: number; d: number }>;
    // Cross-asset signals
    coinbasePremium: Record<string, number>;
    sectorBreadth: { aboveVWAP: number; aboveEMA21: number; total: number };
    setCoinbasePremium: (symbol: string, pct: number) => void;
    setSectorBreadth: (breadth: { aboveVWAP: number; aboveEMA21: number; total: number }) => void;
    setIndicators: (symbol: string, indicators: {
        ema21?: number; ema50?: number; vwap?: number; atr?: number; atrSma?: number; rsi?: number;
        macd?: { macd: number; signal: number; histogram: number };
        bb?: { upper: number; middle: number; lower: number; width: number };
        stochRsi?: { k: number; d: number };
    }) => void;

    // Telegram Configurations (Persisted)
    telegramConfig: TelegramConfig;
    isConfigFetched: boolean;
    updateTelegramConfig: (updates: Partial<TelegramConfig>, skipSync?: boolean) => void;
    addMonitoredSymbol: (symbol: string, type?: 'spot' | 'futures') => void;
    removeMonitoredSymbol: (symbol: string, type?: 'spot' | 'futures') => void;

    // Theme Settings
    theme: 'terminal' | 'professional';
    setTheme: (theme: 'terminal' | 'professional') => void;

    // Custom Price Alerts
    priceAlerts: PriceAlert[];
    setPriceAlerts: (alerts: PriceAlert[]) => void;
    addPriceAlert: (alert: PriceAlert) => Promise<void>;
    removePriceAlert: (id: string) => Promise<void>;
    fetchPriceAlerts: () => Promise<void>;
}

const syncConfigToBot = async () => {
    try {
        const state = useTerminalStore.getState();
        if (!state.isConfigFetched) return;
        const resp = await fetch('/api/bot/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.telegramConfig)
        });
        if (!resp.ok) console.warn('Sync failed:', await resp.text());
    } catch (e) {
        console.error('Bot sync error:', e);
    }
};

export const useTerminalStore = create<TerminalState>()(
    persist(
        (set, get) => ({
            globalInterval: '5m',
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

            events: [],
            whaleDelta: {},
            addEvent: (eventData) => set((state) => {
                const newEvent = { ...eventData, id: Math.random().toString(36).substr(2, 9) };
                const newEvents = [newEvent, ...state.events].slice(0, 100);
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
                const newHistory = [...history, { timestamp: now, value: oi }].filter(h => now - h.timestamp < 24 * 60 * 60 * 1000);
                return {
                    openInterest: { ...state.openInterest, [symbol]: oi },
                    oiHistory: { ...state.oiHistory, [symbol]: newHistory }
                };
            }),

            fundingRate: {},
            fundingHistory: {},
            predictedFundingRate: {},
            nextFundingTime: {},
            setFundingRate: (symbol, rate) => set((state) => {
                const history = state.fundingHistory[symbol] || [];
                const now = Date.now();
                const newHistory = [...history, { timestamp: now, value: rate }].filter(h => now - h.timestamp < 24 * 60 * 60 * 1000);
                return {
                    fundingRate: { ...state.fundingRate, [symbol]: rate },
                    fundingHistory: { ...state.fundingHistory, [symbol]: newHistory }
                };
            }),
            setPredictedFunding: (symbol, predictedRate, nextTime) => set((state) => ({
                predictedFundingRate: { ...state.predictedFundingRate, [symbol]: predictedRate },
                nextFundingTime: { ...state.nextFundingTime, [symbol]: nextTime }
            })),
            backfillFundingHistory: (symbol, history) => set((state) => {
                const existing = state.fundingHistory[symbol] || [];
                const existingTs = new Set(existing.map(h => h.timestamp));
                const merged = [...history.filter(h => !existingTs.has(h.timestamp)), ...existing]
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(-48);
                return { fundingHistory: { ...state.fundingHistory, [symbol]: merged } };
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
            addTrade: (symbol, trade) => get().addTradesBatch(symbol, [trade]),

            addTradesBatch: (symbol, newTradesBatch) => set((state) => {
                const trades = state.recentTrades[symbol] || [];
                const updatedTrades = [...[...newTradesBatch].reverse(), ...trades].slice(0, 50);
                const currentDelta = state.volumeDelta[symbol] || { buyVolume: 0, sellVolume: 0, delta: 0 };
                let newBuyVolume = currentDelta.buyVolume;
                let newSellVolume = currentDelta.sellVolume;
                const currentProfile = state.volumeProfile[symbol] || new Map<number, number>();

                newTradesBatch.forEach(trade => {
                    const volume = trade.price * trade.amount;
                    if (trade.side === 'BUY') newBuyVolume += volume;
                    else newSellVolume += volume;
                    let bucketSize = trade.price * 0.0001;
                    if (trade.price > 1000) bucketSize = Math.max(1, Math.round(bucketSize));
                    else if (trade.price > 1) bucketSize = Math.max(0.01, Number(bucketSize.toFixed(4)));
                    else bucketSize = Math.max(0.000001, Number(bucketSize.toFixed(8)));
                    const bucketPrice = Math.round(trade.price / bucketSize) * bucketSize;
                    currentProfile.set(bucketPrice, (currentProfile.get(bucketPrice) || 0) + volume);
                });
                
                let maxVol = 0;
                let newPoc = state.sessionPoc[symbol] || 0;
                let totalVol = 0;
                for (const [p, v] of currentProfile.entries()) {
                    totalVol += v;
                    if (v > maxVol) {
                        maxVol = v;
                        newPoc = p;
                    }
                }
                const targetVol = totalVol * 0.7;
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
                const newVah = sortedPrices[Math.max(0, upIdx - 1)] || newPoc;
                const newVal = sortedPrices[Math.min(sortedPrices.length - 1, downIdx + 1)] || newPoc;

                return {
                    recentTrades: { ...state.recentTrades, [symbol]: updatedTrades },
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
            currentMACD: {},
            currentBB: {},
            currentStochRSI: {},
            coinbasePremium: {},
            sectorBreadth: { aboveVWAP: 0, aboveEMA21: 0, total: 0 },
            setCoinbasePremium: (symbol, pct) => set((state) => ({
                coinbasePremium: { ...state.coinbasePremium, [symbol]: pct }
            })),
            setSectorBreadth: (breadth) => set({ sectorBreadth: breadth }),
            setIndicators: (symbol, indicators) => set((state) => ({
                currentEMA21: indicators.ema21 !== undefined ? { ...state.currentEMA21, [symbol]: indicators.ema21 } : state.currentEMA21,
                currentEMA50: indicators.ema50 !== undefined ? { ...state.currentEMA50, [symbol]: indicators.ema50 } : state.currentEMA50,
                currentVWAP: indicators.vwap !== undefined ? { ...state.currentVWAP, [symbol]: indicators.vwap } : state.currentVWAP,
                currentATR: indicators.atr !== undefined ? { ...state.currentATR, [symbol]: indicators.atr } : state.currentATR,
                currentAtrSma: indicators.atrSma !== undefined ? { ...state.currentAtrSma, [symbol]: indicators.atrSma } : state.currentAtrSma,
                currentRSI: indicators.rsi !== undefined ? { ...state.currentRSI, [symbol]: indicators.rsi } : state.currentRSI,
                currentMACD: indicators.macd !== undefined ? { ...state.currentMACD, [symbol]: indicators.macd } : state.currentMACD,
                currentBB: indicators.bb !== undefined ? { ...state.currentBB, [symbol]: indicators.bb } : state.currentBB,
                currentStochRSI: indicators.stochRsi !== undefined ? { ...state.currentStochRSI, [symbol]: indicators.stochRsi } : state.currentStochRSI,
            })),

            theme: 'terminal',
            setTheme: (theme) => set({ theme }),

            priceAlerts: [],
            setPriceAlerts: (alerts) => set({ priceAlerts: alerts.map(normalizePriceAlert) }),
            addPriceAlert: async (alert) => {
                try {
                    const normalizedAlert = normalizePriceAlert(alert);
                    const resp = await fetch(`/api/bot/alerts/price`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'add', alert: normalizedAlert })
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        set({ priceAlerts: data.priceAlerts.map(normalizePriceAlert) });
                    }
                } catch (e) { console.error("Failed to add price alert:", e); }
            },
            removePriceAlert: async (id: string) => {
                const previousAlerts = get().priceAlerts;
                set({ priceAlerts: previousAlerts.filter((a: PriceAlert) => a.id !== id) });
                try {
                    const resp = await fetch(`/api/bot/alerts/price`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'remove', id })
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        set({ priceAlerts: data.priceAlerts.map(normalizePriceAlert) });
                    } else { set({ priceAlerts: previousAlerts }); }
                } catch (e) {
                    console.error("Failed to remove price alert:", e);
                    set({ priceAlerts: previousAlerts });
                }
            },
            fetchPriceAlerts: async () => {
                try {
                    const resp = await fetch(`/api/bot/alerts/price`);
                    if (resp.ok) {
                        const data = await resp.json();
                        set({ priceAlerts: data.map(normalizePriceAlert) });
                    }
                } catch (e) { console.error("Failed to fetch price alerts:", e); }
            },
            telegramConfig: {
                globalEnabled: true,
                activeSessions: ['London', 'US', 'Asia'],
                monitoredSymbols: ['BTCUSDT', 'ETHUSDT'],
                alertOnStateChange: true,
                quietHours: {
                    enabled: false,
                    start: '22:00',
                    end: '06:00',
                },
                categories: {},
                cooldowns: {},
                timeframes: { ...DEFAULT_TIMEFRAMES_BY_CATEGORY },
                thresholds: normalizeThresholdScopes(),
            },
            isConfigFetched: false,
            updateTelegramConfig: (updates, skipSync = false) => {
                set((state) => {
                    const current = state.telegramConfig || {};
                    const mergedThresholds = updates.thresholds
                        ? normalizeThresholdScopes({ ...(current.thresholds || {}), ...updates.thresholds })
                        : normalizeThresholdScopes(current.thresholds);
                    return {
                        telegramConfig: {
                            ...current,
                            ...updates,
                            categories: updates.categories ? { ...(current.categories || {}), ...updates.categories } : (current.categories || {}),
                            quietHours: updates.quietHours ? { ...(current.quietHours || {}), ...updates.quietHours } : (current.quietHours || {}),
                            cooldowns: updates.cooldowns ? { ...(current.cooldowns || {}), ...updates.cooldowns } : (current.cooldowns || {}),
                            timeframes: updates.timeframes ? { ...(current.timeframes || {}), ...updates.timeframes } : (current.timeframes || {}),
                            thresholds: mergedThresholds,
                        },
                        isConfigFetched: (skipSync && updates.globalEnabled !== undefined) || state.isConfigFetched
                    };
                });
                if (!skipSync) syncConfigToBot();
            },

            addMonitoredSymbol: (symbol: string, type: 'spot' | 'futures' = 'futures') => {
                set((state: TerminalState) => {
                    const current = state.telegramConfig.monitoredSymbols;
                    let s = symbol.toUpperCase().trim();
                    if (!s) return state;

                    // Normalize symbol: append USDT if missing for base symbols
                    if (s.length >= 3 && s.length <= 5 && !s.endsWith('USDT')) {
                        s = `${s}USDT`;
                    }
                    
                    const exists = current.some(m => {
                        const sSym = typeof m === 'string' ? m : m.symbol;
                        const sType = typeof m === 'string' ? 'futures' : m.type;
                        return sSym === s && sType === type;
                    });
                    
                    if (exists) return state;
                    
                    const newSymbols = [...current, { symbol: s, type }];
                    const newThresholds = { ...state.telegramConfig.thresholds };
                    if (!newThresholds[s]) {
                        newThresholds[s] = { ...state.telegramConfig.thresholds.global };
                    }
                    return {
                        telegramConfig: {
                            ...state.telegramConfig,
                            monitoredSymbols: newSymbols,
                            thresholds: normalizeThresholdScopes(newThresholds)
                        }
                    };
                });
                setTimeout(() => {
                    syncConfigToBot();
                }, 100);
            },

            removeMonitoredSymbol: (symbol: string, type?: 'spot' | 'futures') => {
                set((state: TerminalState) => {
                    const current = state.telegramConfig;
                    const newSymbols = current.monitoredSymbols.filter(m => {
                        if (typeof m === 'string') return m !== symbol;
                        if (type) return !(m.symbol === symbol && m.type === type);
                        return m.symbol !== symbol;
                    });
                    const newThresholds = { ...current.thresholds };
                    // Only delete if no other type of same symbol exists
                    const stillExists = newSymbols.some(m => (typeof m === 'string' ? m : m.symbol) === symbol);
                    if (!stillExists) delete newThresholds[symbol];
                    
                    return {
                        telegramConfig: {
                            ...current,
                            monitoredSymbols: newSymbols,
                            thresholds: newThresholds
                        }
                    };
                });
                syncConfigToBot();
            }
        }),
        {
            name: 'terminal-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                theme: state.theme,
                telegramConfig: state.telegramConfig,
                priceAlerts: state.priceAlerts,
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    const oneHourAgo = Date.now() - 60 * 60 * 1000;
                    state.events = (state.events || []).filter(e => e.timestamp > oneHourAgo);
                    if (state.telegramConfig && Array.isArray(state.telegramConfig.monitoredSymbols)) {
                        state.telegramConfig.monitoredSymbols = state.telegramConfig.monitoredSymbols.map(m => {
                            const rawSym = typeof m === 'string' ? m : m.symbol;
                            const type = typeof m === 'string' ? 'futures' : m.type;
                            let s = rawSym.toUpperCase().trim();
                            if (s.length >= 3 && s.length <= 5 && !s.endsWith('USDT')) {
                                s = `${s}USDT`;
                            }
                            return { symbol: s, type };
                        });
                        state.telegramConfig.thresholds = normalizeThresholdScopes(state.telegramConfig.thresholds as Record<string, Partial<TelegramThresholds>>);
                    }
                    state.priceAlerts = (state.priceAlerts || []).map((alert) =>
                        normalizePriceAlert(alert as Partial<PriceAlert> & { side?: string })
                    );
                }
            },
        }
    )
);
