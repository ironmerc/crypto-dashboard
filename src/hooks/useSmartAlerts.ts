import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

// Helper to check if current local time is within quiet hours
const isWithinQuietHours = (startStr: string, endStr: string) => {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;

    if (startMins <= endMins) {
        // Standard range (e.g., 09:00 to 17:00)
        return currentMins >= startMins && currentMins <= endMins;
    } else {
        // Wraps around midnight (e.g., 22:00 to 06:00)
        return currentMins >= startMins || currentMins <= endMins;
    }
};

// Helper to optionally send Telegram notifications
export const sendTelegramAlert = async (title: string, message: string, alertType: string, cooldownSecs: number, categoryKey: string) => {
    const state = useTerminalStore.getState();
    const config = state.telegramConfig;

    // Strict check 
    if (config.globalEnabled === false || String(config.globalEnabled) === "false") {
        console.log(`[Egress] Blocked ${alertType} because global egress is OFF`);
        return;
    }
    if (config.categories && config.categories[categoryKey] === false) {
        console.log(`[Egress] Blocked ${alertType} because category ${categoryKey} is OFF`);
        return;
    }

    if (config.quietHours?.enabled && config.quietHours.start && config.quietHours.end) {
        if (isWithinQuietHours(config.quietHours.start, config.quietHours.end)) {
            console.log(`[SmartAlerts] Suppressing ${title} due to quiet hours.`);
            return;
        }
    }

    try {
        const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/alert';
        await fetch(botUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `<b>🚨 ${title}</b>\n\n${message}`,
                type: alertType,
                severity: "warning",
                symbol: title.split(']')[0].replace('[', ''),
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

    useEffect(() => {
        const interval = setInterval(() => {
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
                if (ratio > 1.3 && canAlert(`ATR_EXPANSION_${symbol}`, cdSecs * 1000)) {
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

                    sendTelegramAlert(`[${symbol}] ${title}`, msg, `ATR_${symbol}`, cdSecs, 'atr_expand');
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

                    if (Math.abs(oiChangePct) > 1.5 && canAlert(`OI_SPIKE_${symbol}`, cdSecs * 1000)) {
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

                        sendTelegramAlert(`[${symbol}] ${title}`, msg, `OI_${isUp ? 'UP' : 'DOWN'}_${symbol}`, cdSecs, 'oi_spike');
                    }
                }
            }

            // 3. Imbalance approaching Magnet or Wall
            const bidWalls = state.bidWalls[symbol] || [];
            const askWalls = state.askWalls[symbol] || [];
            const wallCdSecs = (config.cooldowns && config.cooldowns['wall']) || 900;

            if (bidWalls.length > 0) {
                const distPct = ((price - bidWalls[0].price) / price) * 100;
                if (distPct < 0.25 && canAlert(`APPROACH_BID_${symbol}_${bidWalls[0].price}`, wallCdSecs * 1000)) {
                    if (!config.globalEnabled || (config.categories && config.categories['wall'] === false)) return;

                    const title = 'SUPPORT WALL APPROACHING';
                    const msg = `Price is ${distPct.toFixed(2)}% away from major support wall ($${(bidWalls[0].value / 1000000).toFixed(1)}M).`;

                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: bidWalls[0].amount,
                        value: bidWalls[0].value,
                        side: 'BUY',
                        timestamp: now,
                        title: title,
                        message: msg,
                    });

                    sendTelegramAlert(`[${symbol}] ${title}`, msg, `SUPPORT_WALL_${symbol}`, wallCdSecs, 'wall');
                }
            }

            if (askWalls.length > 0) {
                const distPct = ((askWalls[0].price - price) / price) * 100;
                if (distPct < 0.25 && canAlert(`APPROACH_ASK_${symbol}_${askWalls[0].price}`, wallCdSecs * 1000)) {
                    if (!config.globalEnabled || (config.categories && config.categories['wall'] === false)) return;

                    const title = 'RESISTANCE WALL APPROACHING';
                    const msg = `Price is ${distPct.toFixed(2)}% away from major resistance wall ($${(askWalls[0].value / 1000000).toFixed(1)}M).`;

                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: askWalls[0].amount,
                        value: askWalls[0].value,
                        side: 'SELL',
                        timestamp: now,
                        title: title,
                        message: msg,
                    });

                    sendTelegramAlert(`[${symbol}] ${title}`, msg, `RESISTANCE_WALL_${symbol}`, wallCdSecs, 'wall');
                }
            }

        }, 5000);

        return () => clearInterval(interval);
    }, [symbol]);
}
