import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

// Helper to optionally send Telegram notifications
export const sendTelegramAlert = async (title: string, message: string, alertType: string, cooldownSecs: number = 60) => {
    try {
        // We attempt to call the local docker-compose service proxy if available
        // In a real production setup with a reverse proxy, this might go to a specific path like /api/bot/alert
        // For development/testing on the same machine, hitting localhost:8080 or the internal Docker hostname is used.
        // Assuming Nginx or similar could route this, but for direct access we use relative /api/alert or a configurable env URL.
        const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/alert';

        await fetch(botUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `<b>🚨 ${title}</b>\n\n${message}`,
                type: alertType,
                severity: "warning", // Defaulting to warning for now, can be expanded
                symbol: title.split(']')[0].replace('[', ''), // Extract symbol from title like "[BTCUSDT] OI SPIKE"
                cooldown: cooldownSecs
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

            // Only alert if we have a valid price
            const price = state.prices[symbol];
            if (!price) return;

            // Helper to check cooldown (e.g., 5 minutes for most alerts)
            const canAlert = (key: string, cooldownMs = 5 * 60 * 1000) => {
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
                if (ratio > 1.3 && canAlert('ATR_EXPANSION')) {
                    const title = 'VOLATILITY EXPANSION';
                    const msg = `ATR is ${ratio.toFixed(2)}x its moving average. Breakout likely underway.`;

                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: 0,
                        value: ratio, // Store ratio in value field for arbitrary use
                        side: 'NEUTRAL',
                        timestamp: now,
                        title: title,
                        message: msg,
                    });

                    sendTelegramAlert(`[${symbol}] ${title}`, msg, `ATR_${symbol}`, 300);
                }
            }

            // 2. Open Interest Spike (> 1.5% in 5m)
            const oiHistory = state.oiHistory[symbol];
            if (oiHistory && oiHistory.length > 0) {
                // Find record from roughly 5m ago
                const fiveMinsAgo = now - 5 * 60 * 1000;
                const windowHistory = oiHistory.filter(h => h.timestamp >= fiveMinsAgo);

                if (windowHistory.length > 1) {
                    const oldest = windowHistory[0].value;
                    const newest = windowHistory[windowHistory.length - 1].value;
                    const oiChangePct = ((newest - oldest) / Math.abs(oldest)) * 100;

                    if (Math.abs(oiChangePct) > 1.5 && canAlert('OI_SPIKE', 10 * 60 * 1000)) { // 10 min cooldown
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

                        sendTelegramAlert(`[${symbol}] ${title}`, msg, `OI_${symbol}`, 600);
                    }
                }
            }

            // 3. Imbalance approaching Magnet or Wall
            const bidWalls = state.bidWalls[symbol] || [];
            const askWalls = state.askWalls[symbol] || [];

            // Check top wall proximity
            if (bidWalls.length > 0) {
                const distPct = ((price - bidWalls[0].price) / price) * 100;
                if (distPct < 0.25 && canAlert(`APPROACH_BID_${bidWalls[0].price}`, 15 * 60 * 1000)) {
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

                    sendTelegramAlert(`[${symbol}] ${title}`, msg, `WALL_${symbol}`, 900);
                }
            }

            if (askWalls.length > 0) {
                const distPct = ((askWalls[0].price - price) / price) * 100;
                if (distPct < 0.25 && canAlert(`APPROACH_ASK_${askWalls[0].price}`, 15 * 60 * 1000)) {
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

                    sendTelegramAlert(`[${symbol}] ${title}`, msg, `WALL_${symbol}`, 900);
                }
            }

        }, 5000); // Check every 5 seconds

        return () => clearInterval(interval);
    }, [symbol]);
}
