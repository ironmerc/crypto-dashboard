import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MarketContext } from '../MarketContext';
import { useTerminalStore } from '../../store/useTerminalStore';

describe('MarketContext', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTerminalStore.setState({
            ...useTerminalStore.getInitialState(),
            currentEMA21: { BTCUSDT: 99 },
            currentEMA50: { BTCUSDT: 98 },
        });
    });

    it('reacts when price arrives after indicators are already populated', async () => {
        render(<MarketContext symbol="BTCUSDT" type="futures" />);

        expect(screen.getByText('Waiting for Context...')).toBeInTheDocument();

        act(() => {
            useTerminalStore.setState({
                prices: { BTCUSDT: 100 },
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Market Context & Decision Support')).toBeInTheDocument();
        });
    });
});
