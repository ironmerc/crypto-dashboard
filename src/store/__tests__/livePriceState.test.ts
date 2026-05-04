import { beforeEach, describe, expect, it } from 'vitest';
import { useTerminalStore } from '../useTerminalStore';

describe('live websocket price state', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTerminalStore.setState(useTerminalStore.getInitialState());
    });

    it('stores live websocket price metadata and tracks staleness', () => {
        const store = useTerminalStore.getState();

        store.setLivePrice('BTCUSDT', 78937.1, 'trade', 1_000);

        const next = useTerminalStore.getState();
        expect(next.livePrices.BTCUSDT).toBe(78937.1);
        expect(next.livePriceSource.BTCUSDT).toBe('trade');
        expect(next.lastLivePriceAt.BTCUSDT).toBe(1_000);
        expect(next.isLivePriceStale('BTCUSDT', 10_999)).toBe(false);
        expect(next.isLivePriceStale('BTCUSDT', 11_001)).toBe(true);
    });
});
