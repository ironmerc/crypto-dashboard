import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';
import { BOT_API } from '../constants/api';
import { TIMING, TIMEFRAME_MS } from '../constants/timing';
import { ALERT_DEFAULTS, formatAlertMessage, formatAlertTitle } from '../constants/alerts';

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

export const sendTelegramAlert = async (title: string, message: string, alertType: string, cooldownSecs: number, categoryKey: string, tf?: string) => {
    try {
        const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || BOT_API.ALERT;
        await fetch(botUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message:  formatAlertMessage(title, message, tf),
                type:     alertType,
                severity: 'warning',
                symbol:   title.includes(']')
                    ? title.split(']')[0].replace('[', '').trim()
                    : title.split(' ')[0].trim(),
                cooldown: cooldownSecs,
                category: categoryKey,
                ...(tf ? { tf } : {}),
            }),
        });
    } catch {
        // best-effort — bot may be offline
    }
};

export function useSmartAlerts(symbol: string) {
    const lastAlerts = useRef<Record<string, number>>({});
    const prevBBState = useRef<'Squeeze' | 'BreakoutUp' | 'BreakoutDown' | 'Normal'>('Normal');
    const isVisible = usePageVisibility();
    const globalInterval = useTerminalStore(state => state.globalInterval);

    useEffect(() => {
        const interval = setInterval(() => {
            if (!isVisible) return;
            const state = useTerminalStore.getState();
            const now = Date.now();
            const config = state.telegramConfig;
            const thresholds = {
                ...(config.thresholds?.global || {}),
                ...(config.thresholds?.[symbol] || {}),
            };

            // Only alert if we have a valid price
            const price = state.livePrices[symbol];
            if (!price) return;

            // Check category enabled AND that the current interval is in the configured timeframe list
            const isCategoryEnabled = (category: string) => {
                if (!config.globalEnabled || config.categories?.[category] === false) return false;
                const allowedTf = config.timeframes?.[category as keyof typeof config.timeframes];
                if (allowedTf && allowedTf.length > 0 && !allowedTf.includes(globalInterval)) return false;
                return true;
            };

            // Bug fix #1: canAlert is now only called after category check — no early `return` that exits the whole tick
            const canAlert = (key: string, cooldownMs: number) => {
                if (!lastAlerts.current[key] || now - lastAlerts.current[key] > cooldownMs) {
                    lastAlerts.current[key] = now;
                    return true;
                }
                return false;
            };

            // 1. ATR Expansion
            const atr = state.currentATR[symbol];
            const atrSma = state.currentAtrSma[symbol];
            if (atr && atrSma && isCategoryEnabled('atr_expand')) {
                const ratio        = atr / atrSma;
                const cdSecs       = config.cooldowns?.['atr_expand'] ?? ALERT_DEFAULTS.COOLDOWN_DEFAULT_SECS;
                const atrThreshold = thresholds.atrExpansionRatio    ?? ALERT_DEFAULTS.ATR_EXPANSION_RATIO;
                if (ratio > atrThreshold && canAlert(`ATR_EXPANSION_${symbol}`, cdSecs * 1000)) {
                    const msg = `ATR is ${ratio.toFixed(2)}x its moving average. Breakout likely underway.`;
                    state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: ratio, side: 'NEUTRAL', timestamp: now, title: 'VOLATILITY EXPANSION', message: msg });
                    sendTelegramAlert(formatAlertTitle(symbol, 'VOLATILITY EXPANSION'), msg, 'atr_expand', cdSecs, 'atr_expand', globalInterval);
                }
            }

            // 2. OI Spike — rolling window scales with active chart interval
            const oiHistory = state.oiHistory[symbol];
            if (oiHistory && oiHistory.length > 0 && isCategoryEnabled('oi_spike')) {
                const oiWindowMs    = TIMEFRAME_MS[globalInterval] ?? 5 * 60_000;
                const windowHistory = oiHistory.filter(h => h.timestamp >= now - oiWindowMs);
                if (windowHistory.length > 1) {
                    const oldest      = windowHistory[0].value;
                    const newest      = windowHistory[windowHistory.length - 1].value;
                    const oiChangePct = ((newest - oldest) / Math.abs(oldest)) * 100;
                    const cdSecs      = config.cooldowns?.['oi_spike'] ?? 600;
                    const oiThreshold = thresholds.oiSpikePercentage ?? ALERT_DEFAULTS.OI_SPIKE_PERCENTAGE;
                    if (Math.abs(oiChangePct) > oiThreshold && canAlert(`OI_SPIKE_${symbol}`, cdSecs * 1000)) {
                        const isUp = oiChangePct > 0;
                        const name = isUp ? 'OI SPIKE DETECTED' : 'OI FLUSH DETECTED';
                        const msg  = `Open Interest ${isUp ? 'increased' : 'dropped'} by ${Math.abs(oiChangePct).toFixed(2)}% in ${globalInterval}.`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: newest, side: isUp ? 'LONG' : 'SHORT', timestamp: now, title: name, message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, name), msg, 'oi_spike', cdSecs, 'oi_spike', globalInterval);
                    }
                }
            }

            // 3. MACD Crossover
            const macd = state.currentMACD[symbol];
            if (macd && isCategoryEnabled('macd_cross')) {
                const cdSecs         = config.cooldowns?.['macd_cross'] ?? ALERT_DEFAULTS.COOLDOWN_DEFAULT_SECS;
                const freshnessRatio = thresholds.macdFreshnessRatio   ?? ALERT_DEFAULTS.MACD_FRESHNESS_RATIO;
                if (macd.macd > macd.signal && macd.histogram > 0 && macd.histogram < Math.abs(macd.macd) * freshnessRatio) {
                    if (canAlert(`MACD_BULL_${symbol}`, cdSecs * 1000)) {
                        const msg = `MACD crossed above signal. Histogram: ${macd.histogram.toFixed(4)}`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: macd.histogram, side: 'LONG', timestamp: now, title: 'MACD BULL CROSS', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'MACD BULL CROSS'), msg, 'macd_cross', cdSecs, 'macd_cross', globalInterval);
                    }
                } else if (macd.macd < macd.signal && macd.histogram < 0 && Math.abs(macd.histogram) < Math.abs(macd.macd) * freshnessRatio) {
                    if (canAlert(`MACD_BEAR_${symbol}`, cdSecs * 1000)) {
                        const msg = `MACD crossed below signal. Histogram: ${macd.histogram.toFixed(4)}`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: macd.histogram, side: 'SHORT', timestamp: now, title: 'MACD BEAR CROSS', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'MACD BEAR CROSS'), msg, 'macd_cross', cdSecs, 'macd_cross', globalInterval);
                    }
                }
            }

            // 4. Bollinger Band Squeeze / Breakout
            const bb = state.currentBB[symbol];
            if (bb && bb.width !== undefined) {
                const bbSqueezeWidthPct = thresholds.bbSqueezeWidthPct ?? ALERT_DEFAULTS.BB_SQUEEZE_WIDTH_PCT;
                const nextBBState: typeof prevBBState.current =
                    bb.width < bbSqueezeWidthPct ? 'Squeeze'
                    : price > bb.upper           ? 'BreakoutUp'
                    : price < bb.lower           ? 'BreakoutDown'
                    : 'Normal';
                if (nextBBState !== prevBBState.current) {
                    prevBBState.current = nextBBState;
                    if (nextBBState === 'Squeeze' && isCategoryEnabled('bb_squeeze') && canAlert(`BB_SQUEEZE_${symbol}`, (config.cooldowns?.['bb_squeeze'] ?? 600) * 1000)) {
                        const cd  = config.cooldowns?.['bb_squeeze'] ?? 600;
                        const msg = `Bollinger Bands width compressed to ${bb.width.toFixed(2)}%. Breakout imminent.`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: bb.width, side: 'NEUTRAL', timestamp: now, title: 'BB SQUEEZE DETECTED', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'BB SQUEEZE DETECTED'), msg, 'bb_squeeze', cd, 'bb_squeeze', globalInterval);
                    } else if (nextBBState === 'BreakoutUp' && isCategoryEnabled('bb_breakout') && canAlert(`BB_BREAKOUT_UP_${symbol}`, (config.cooldowns?.['bb_breakout'] ?? 600) * 1000)) {
                        const cd  = config.cooldowns?.['bb_breakout'] ?? 600;
                        const msg = `Price broke above upper Bollinger Band (${bb.upper.toFixed(4)}). Momentum expanding.`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: bb.upper, side: 'LONG', timestamp: now, title: 'BB UPPER BREAKOUT', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'BB UPPER BREAKOUT'), msg, 'bb_breakout', cd, 'bb_breakout', globalInterval);
                    } else if (nextBBState === 'BreakoutDown' && isCategoryEnabled('bb_breakout') && canAlert(`BB_BREAKOUT_DOWN_${symbol}`, (config.cooldowns?.['bb_breakout'] ?? 600) * 1000)) {
                        const cd  = config.cooldowns?.['bb_breakout'] ?? 600;
                        const msg = `Price broke below lower Bollinger Band (${bb.lower.toFixed(4)}). Selling pressure expanding.`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: bb.lower, side: 'SHORT', timestamp: now, title: 'BB LOWER BREAKOUT', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'BB LOWER BREAKOUT'), msg, 'bb_breakout', cd, 'bb_breakout', globalInterval);
                    }
                }
            }

            // 5. StochRSI Extreme
            const stochRsi = state.currentStochRSI[symbol];
            if (stochRsi && isCategoryEnabled('stoch_extreme')) {
                const cdSecs          = config.cooldowns?.['stoch_extreme'] ?? ALERT_DEFAULTS.COOLDOWN_DEFAULT_SECS;
                const stochOverbought = thresholds.stochOverbought          ?? ALERT_DEFAULTS.STOCH_OVERBOUGHT;
                const stochOversold   = thresholds.stochOversold            ?? ALERT_DEFAULTS.STOCH_OVERSOLD;
                if (stochRsi.k > stochOverbought && stochRsi.k > stochRsi.d && canAlert(`STOCHRSI_OB_${symbol}`, cdSecs * 1000)) {
                    const msg = `StochRSI K=${stochRsi.k.toFixed(1)} above ${stochOverbought} and crossing down. Potential reversal.`;
                    state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: stochRsi.k, side: 'SHORT', timestamp: now, title: 'STOCHRSI OVERBOUGHT', message: msg });
                    sendTelegramAlert(formatAlertTitle(symbol, 'STOCHRSI OVERBOUGHT'), msg, 'stoch_extreme', cdSecs, 'stoch_extreme', globalInterval);
                } else if (stochRsi.k < stochOversold && stochRsi.k < stochRsi.d && canAlert(`STOCHRSI_OS_${symbol}`, cdSecs * 1000)) {
                    const msg = `StochRSI K=${stochRsi.k.toFixed(1)} below ${stochOversold} and crossing up. Potential bounce.`;
                    state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: stochRsi.k, side: 'LONG', timestamp: now, title: 'STOCHRSI OVERSOLD', message: msg });
                    sendTelegramAlert(formatAlertTitle(symbol, 'STOCHRSI OVERSOLD'), msg, 'stoch_extreme', cdSecs, 'stoch_extreme', globalInterval);
                }
            }

            // 6. OI / Price Divergence — lookback scales with chart interval
            if (oiHistory && isCategoryEnabled('oi_divergence')) {
                const tfMs             = TIMEFRAME_MS[globalInterval] ?? 5 * 60_000;
                const samplesPerCandle = Math.max(1, Math.round(tfMs / TIMING.OI_POLL_MS));
                const lookbackBars     = Math.max(2, Math.round(thresholds.oiDivergenceLookbackBars ?? ALERT_DEFAULTS.OI_DIVERGENCE_LOOKBACK_BARS));
                const lookbackSamples  = lookbackBars * samplesPerCandle;
                if (oiHistory.length >= lookbackSamples) {
                    const ema21        = state.currentEMA21[symbol];
                    const recentOi     = oiHistory.slice(-lookbackSamples);
                    const oiTrendUp    = recentOi[recentOi.length - 1].value > recentOi[0].value;
                    const priceTrendUp = ema21 ? price > ema21 : false;
                    const cdSecs       = config.cooldowns?.['oi_divergence'] ?? 600;
                    if (priceTrendUp && !oiTrendUp && canAlert(`OI_DIV_BEAR_${symbol}`, cdSecs * 1000)) {
                        const msg = `Price rising but OI declining. Rally may lack conviction — potential reversal.`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: 0, side: 'SHORT', timestamp: now, title: 'OI/PRICE BEARISH DIVERGENCE', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'OI/PRICE BEARISH DIVERGENCE'), msg, 'oi_divergence', cdSecs, 'oi_divergence', globalInterval);
                    } else if (!priceTrendUp && !oiTrendUp && canAlert(`OI_DIV_BULL_${symbol}`, cdSecs * 1000)) {
                        const msg = `Price falling with OI decline — possible short covering. Watch for bounce.`;
                        state.addEvent({ type: 'SmartAlert', symbol, price, amount: 0, value: 0, side: 'LONG', timestamp: now, title: 'OI/PRICE CORRELATION: SHORT COVERING', message: msg });
                        sendTelegramAlert(formatAlertTitle(symbol, 'SHORT COVERING SIGNAL'), msg, 'oi_divergence', cdSecs, 'oi_divergence', globalInterval);
                    }
                }
            }

        }, TIMING.ALERT_LOOP_MS);

        return () => clearInterval(interval);
    }, [symbol, isVisible, globalInterval]);
}
