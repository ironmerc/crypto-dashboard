import { useEffect } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';

const COINBASE_BASE = 'https://api.exchange.coinbase.com';
const POLL_MS = 15_000;

// Symbols confirmed to return 404 — skip permanently for the session
const notFoundPairs = new Set<string>();

// Normalizes a symbol like "BTCUSDT" -> "BTC-USD" for Coinbase Advanced Trade
function toCoinbasePair(symbol: string): string {
    const base = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');
    return `${base}-USD`;
}

export function useCoinbasePremium(symbols: string[]) {
    const isVisible = usePageVisibility();

    useEffect(() => {
        if (!isVisible || symbols.length === 0) return;

        const fetchPremium = async () => {
            const state = useTerminalStore.getState();
            await Promise.all(symbols.map(async (sym) => {
                const binancePrice = state.prices[sym];
                if (!binancePrice) return;
                try {
                    const pair = toCoinbasePair(sym);
                    if (notFoundPairs.has(pair)) return;
                    const res = await fetch(`${COINBASE_BASE}/products/${pair}/ticker`);
                    if (res.status === 404) { notFoundPairs.add(pair); return; }
                    if (!res.ok) return;
                    const data = await res.json();
                    const coinbasePrice = parseFloat(data.price);
                    if (!isNaN(coinbasePrice) && coinbasePrice > 0) {
                        const premiumPct = ((coinbasePrice - binancePrice) / binancePrice) * 100;
                        state.setCoinbasePremium(sym, premiumPct);
                    }
                } catch {
                    // Coinbase API unavailable — skip silently
                }
            }));
        };

        fetchPremium();
        const interval = setInterval(fetchPremium, POLL_MS);
        return () => clearInterval(interval);
    }, [symbols, isVisible]);
}
