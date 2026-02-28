import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

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
                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: 0,
                        value: ratio, // Store ratio in value field for arbitrary use
                        side: 'NEUTRAL',
                        timestamp: now,
                        title: 'VOLATILITY EXPANSION',
                        message: `ATR is ${ratio.toFixed(2)}x its moving average. Breakout likely underway.`,
                    });
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
                        state.addEvent({
                            type: 'SmartAlert',
                            symbol,
                            price,
                            amount: 0,
                            value: newest,
                            side: isUp ? 'LONG' : 'SHORT',
                            timestamp: now,
                            title: isUp ? 'OI SPIKE DETECTED' : 'OI FLUSH DETECTED',
                            message: `Open Interest ${isUp ? 'increased' : 'dropped'} by ${Math.abs(oiChangePct).toFixed(2)}% in 5m.`,
                        });
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
                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: bidWalls[0].amount,
                        value: bidWalls[0].value,
                        side: 'BUY',
                        timestamp: now,
                        title: 'SUPPORT WALL APPROACHING',
                        message: `Price is ${distPct.toFixed(2)}% away from major support wall ($${(bidWalls[0].value / 1000000).toFixed(1)}M).`,
                    });
                }
            }

            if (askWalls.length > 0) {
                const distPct = ((askWalls[0].price - price) / price) * 100;
                if (distPct < 0.25 && canAlert(`APPROACH_ASK_${askWalls[0].price}`, 15 * 60 * 1000)) {
                    state.addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price,
                        amount: askWalls[0].amount,
                        value: askWalls[0].value,
                        side: 'SELL',
                        timestamp: now,
                        title: 'RESISTANCE WALL APPROACHING',
                        message: `Price is ${distPct.toFixed(2)}% away from major resistance wall ($${(askWalls[0].value / 1000000).toFixed(1)}M).`,
                    });
                }
            }

        }, 5000); // Check every 5 seconds

        return () => clearInterval(interval);
    }, [symbol]);
}
