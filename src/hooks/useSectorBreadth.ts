import { useEffect } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

const POLL_MS = 10_000;

/**
 * Tracks the percentage of monitored symbols that are trading above their
 * VWAP and EMA21 — a simple sector breadth proxy.
 */
export function useSectorBreadth(symbols: string[]) {
    useEffect(() => {
        if (symbols.length === 0) return;

        const compute = () => {
            const state = useTerminalStore.getState();
            let aboveVWAP = 0;
            let aboveEMA21 = 0;
            let counted = 0;

            for (const sym of symbols) {
                const price = state.prices[sym];
                const vwap = state.currentVWAP[sym];
                const ema21 = state.currentEMA21[sym];
                if (!price) continue;
                counted++;
                if (vwap && price > vwap) aboveVWAP++;
                if (ema21 && price > ema21) aboveEMA21++;
            }

            if (counted > 0) {
                state.setSectorBreadth({ aboveVWAP, aboveEMA21, total: counted });
            }
        };

        compute();
        const interval = setInterval(compute, POLL_MS);
        return () => clearInterval(interval);
    }, [symbols]);
}
