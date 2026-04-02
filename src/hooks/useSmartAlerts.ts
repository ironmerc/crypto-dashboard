import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';

// Sessions (UTC)
// Asia: 00:00 - 08:00
// London: 08:00 - 16:00
// US: 13:00 - 21:00 (overlaps with London)
export const getCurrentSession = (): string => {
    const hours = new Date().getUTCHours();
    if (hours >= 13 && hours < 21) return 'US';
    if (hours >= 8 && hours < 16) return 'London';
    if (hours >= 0 && hours < 8) return 'Asia';
    return 'Off-Hours';
};

// Helper to optionally send Telegram notifications
export const sendTelegramAlert = async (title: string, message: string, alertType: string, cooldownSecs: number, categoryKey: string) => {
    try {
        const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/alert';
        await fetch(botUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `<b>🚨 ${title}</b>\n\n${message}`,
                type: alertType,
                severity: "warning",
                symbol: title.includes(']') ? title.split(']')[0].replace('[', '').trim() : title.split(' ')[0].trim(),
                cooldown: cooldownSecs,
                category: categoryKey
            })
        });
    } catch (e) {
        console.warn('Failed to send Telegram alert (bot might be offline):', e);
    }
};

export function useSmartAlerts(symbol: string) {
    const lastAlerts = useRef<Record<string, number>>({});
    const prevBBState = useRef<'Squeeze' | 'BreakoutUp' | 'BreakoutDown' | 'Normal'>('Normal');
    const isVisible = usePageVisibility();

    useEffect(() => {
        const interval = setInterval(() => {
            if (!isVisible) return;
            const state = useTerminalStore.getState();
            const now = Date.now();
            const config = state.telegramConfig;

            // Only alert if we have a valid price
            const price = state.prices[symbol];
            if (!price) return;

            // Helper to check cooldown locally first to avoid spamming the backend or generating duplicate UI events
            const canAlert = (key: string, cooldownMs: number) => {
                if (!lastAlerts.current[key] || now - lastAlerts.current[key] > cooldownMs) {
                    lastAlerts.current[key] = now;
                    return true;
                }
                return false;
            };

            // 1. ATR Expansion (Breakout Risk)
            const atr = state.currentATR[symbol];
            const atrSma = state.currentAtrSma[symbol];
            if (atr && atrSma) {
                const ratio = atr / atrSma;
                // Use configurable cooldown or default to 5m
                const cdSecs = (config.cooldowns && config.cooldowns['atr_expand']) || 300;
                const thresholdObj = config.thresholds[symbol] || config.thresholds.global || { atrExpansionRatio: 1.3 };
                const atrThreshold = thresholdObj.atrExpansionRatio || 1.3;

                if (ratio > atrThreshold && canAlert(`ATR_EXPANSION_${symbol}`, cdSecs * 1000)) {
                    if (!config.globalEnabled || (config.categories && config.categories['atr_expand'] === false)) return;

                    const title = 'VOLATILITY EXPANSION';
                    const msg = `ATR is ${ratio.toFixed(2)}x its moving average. Breakout likely underway.`;

                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: 0,
                        value: ratio,
                        side: 'NEUTRAL',
                        timestamp: now,
                        title: title,
                        message: msg,
                    });
                }
            }

            // 2. Open Interest Spike (> 1.5% in 5m)
            const oiHistory = state.oiHistory[symbol];
            if (oiHistory && oiHistory.length > 0) {
                const fiveMinsAgo = now - 5 * 60 * 1000;
                const windowHistory = oiHistory.filter(h => h.timestamp >= fiveMinsAgo);

                if (windowHistory.length > 1) {
                    const oldest = windowHistory[0].value;
                    const newest = windowHistory[windowHistory.length - 1].value;
                    const oiChangePct = ((newest - oldest) / Math.abs(oldest)) * 100;

                    const cdSecs = (config.cooldowns && config.cooldowns['oi_spike']) || 600;
                    const thresholdObj = config.thresholds[symbol] || config.thresholds.global || { oiSpikePercentage: 1.5 };
                    const oiThreshold = thresholdObj.oiSpikePercentage || 1.5;

                    if (Math.abs(oiChangePct) > oiThreshold && canAlert(`OI_SPIKE_${symbol}`, cdSecs * 1000)) {
                        if (!config.globalEnabled || (config.categories && config.categories['oi_spike'] === false)) return;

                        const isUp = oiChangePct > 0;
                        const title = isUp ? 'OI SPIKE DETECTED' : 'OI FLUSH DETECTED';
                        const msg = `Open Interest ${isUp ? 'increased' : 'dropped'} by ${Math.abs(oiChangePct).toFixed(2)}% in 5m.`;

                        state.addEvent({
                            type: 'SmartAlert',
                            symbol,
                            price,
                            amount: 0,
                            value: newest,
                            side: isUp ? 'LONG' : 'SHORT',
                            timestamp: now,
                            title: title,
                            message: msg,
                        });
                    }
                }
            }

            // 3. MACD Crossover Signal
            const macd = state.currentMACD[symbol];
            if (macd) {
                const cdSecs = config.cooldowns?.['macd_cross'] ?? 300;
                // Bull cross: macd > signal && histogram positive (freshly crossed)
                if (macd.macd > macd.signal && macd.histogram > 0 && macd.histogram < Math.abs(macd.macd) * 0.1) {
                    if (canAlert(`MACD_BULL_${symbol}`, cdSecs * 1000)) {
                        state.addEvent({
                            type: 'SmartAlert', symbol, price, amount: 0, value: macd.histogram,
                            side: 'LONG', timestamp: now,
                            title: 'MACD BULL CROSS',
                            message: `MACD crossed above signal. Histogram: ${macd.histogram.toFixed(4)}`,
                        });
                    }
                } else if (macd.macd < macd.signal && macd.histogram < 0 && Math.abs(macd.histogram) < Math.abs(macd.macd) * 0.1) {
                    if (canAlert(`MACD_BEAR_${symbol}`, cdSecs * 1000)) {
                        state.addEvent({
                            type: 'SmartAlert', symbol, price, amount: 0, value: macd.histogram,
                            side: 'SHORT', timestamp: now,
                            title: 'MACD BEAR CROSS',
                            message: `MACD crossed below signal. Histogram: ${macd.histogram.toFixed(4)}`,
                        });
                    }
                }
            }

            // 4. Bollinger Band Squeeze Breakout
            const bb = state.currentBB[symbol];
            if (bb && bb.width !== undefined) {
                const cdSecs = config.cooldowns?.['bb_squeeze'] ?? 600;
                const nextBBState: typeof prevBBState.current =
                    bb.width < 2 ? 'Squeeze'
                    : price > bb.upper ? 'BreakoutUp'
                    : price < bb.lower ? 'BreakoutDown'
                    : 'Normal';

                if (nextBBState !== prevBBState.current) {
                    prevBBState.current = nextBBState;
                    if (nextBBState === 'Squeeze' && canAlert(`BB_SQUEEZE_${symbol}`, cdSecs * 1000)) {
                        state.addEvent({
                            type: 'SmartAlert', symbol, price, amount: 0, value: bb.width,
                            side: 'NEUTRAL', timestamp: now,
                            title: 'BB SQUEEZE DETECTED',
                            message: `Bollinger Bands width compressed to ${bb.width.toFixed(2)}%. Breakout imminent.`,
                        });
                    } else if (nextBBState === 'BreakoutUp' && canAlert(`BB_BREAKOUT_UP_${symbol}`, cdSecs * 1000)) {
                        state.addEvent({
                            type: 'SmartAlert', symbol, price, amount: 0, value: bb.upper,
                            side: 'LONG', timestamp: now,
                            title: 'BB UPPER BREAKOUT',
                            message: `Price broke above upper Bollinger Band (${bb.upper.toFixed(4)}). Momentum expanding.`,
                        });
                    } else if (nextBBState === 'BreakoutDown' && canAlert(`BB_BREAKOUT_DOWN_${symbol}`, cdSecs * 1000)) {
                        state.addEvent({
                            type: 'SmartAlert', symbol, price, amount: 0, value: bb.lower,
                            side: 'SHORT', timestamp: now,
                            title: 'BB LOWER BREAKOUT',
                            message: `Price broke below lower Bollinger Band (${bb.lower.toFixed(4)}). Selling pressure expanding.`,
                        });
                    }
                }
            }

            // 5. StochRSI Extreme
            const stochRsi = state.currentStochRSI[symbol];
            if (stochRsi) {
                const cdSecs = config.cooldowns?.['stochrsi_extreme'] ?? 300;
                if (stochRsi.k > 85 && stochRsi.k > stochRsi.d && canAlert(`STOCHRSI_OB_${symbol}`, cdSecs * 1000)) {
                    state.addEvent({
                        type: 'SmartAlert', symbol, price, amount: 0, value: stochRsi.k,
                        side: 'SHORT', timestamp: now,
                        title: 'STOCHRSI OVERBOUGHT',
                        message: `StochRSI K=${stochRsi.k.toFixed(1)} above 85 and crossing down. Potential reversal.`,
                    });
                } else if (stochRsi.k < 15 && stochRsi.k < stochRsi.d && canAlert(`STOCHRSI_OS_${symbol}`, cdSecs * 1000)) {
                    state.addEvent({
                        type: 'SmartAlert', symbol, price, amount: 0, value: stochRsi.k,
                        side: 'LONG', timestamp: now,
                        title: 'STOCHRSI OVERSOLD',
                        message: `StochRSI K=${stochRsi.k.toFixed(1)} below 15 and crossing up. Potential bounce.`,
                    });
                }
            }

            // 6. OI / Price Divergence
            if (oiHistory && oiHistory.length >= 6 && price) {
                const ema21 = state.currentEMA21[symbol];
                const recentOi = oiHistory.slice(-6);
                const oiTrendUp = recentOi[recentOi.length - 1].value > recentOi[0].value;
                const priceTrendUp = ema21 ? price > ema21 : false;
                const cdSecs = config.cooldowns?.['oi_diverge'] ?? 600;

                if (priceTrendUp && !oiTrendUp && canAlert(`OI_DIV_BEAR_${symbol}`, cdSecs * 1000)) {
                    state.addEvent({
                        type: 'SmartAlert', symbol, price, amount: 0, value: 0,
                        side: 'SHORT', timestamp: now,
                        title: 'OI/PRICE BEARISH DIVERGENCE',
                        message: `Price rising but OI declining. Rally may lack conviction — potential reversal.`,
                    });
                } else if (!priceTrendUp && !oiTrendUp && canAlert(`OI_DIV_BULL_${symbol}`, cdSecs * 1000)) {
                    state.addEvent({
                        type: 'SmartAlert', symbol, price, amount: 0, value: 0,
                        side: 'LONG', timestamp: now,
                        title: 'OI/PRICE BULLISH DIVERGENCE',
                        message: `Price falling with OI decline — possible short covering. Watch for bounce.`,
                    });
                }
            }

        }, 5000);

        return () => clearInterval(interval);
    }, [symbol, isVisible]);
}
