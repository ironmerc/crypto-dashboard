import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionAlertStrip } from '../ActionAlertStrip';
import { useTerminalStore } from '../../store/useTerminalStore';
import type { MarketEvent } from '../../store/useTerminalStore';

const baseEvent: Omit<MarketEvent, 'id' | 'timestamp'> = {
    type: 'SmartAlert',
    symbol: 'BTCUSDT',
    price: 65000,
    amount: 0,
    value: 1,
    side: 'LONG',
    title: 'LATEST ALERT',
    message: 'latest',
};

describe('ActionAlertStrip', () => {
    afterEach(() => {
        vi.useRealTimers();
        act(() => {
            useTerminalStore.setState({ events: [] });
        });
    });

    it('uses the newest event in store ordering (index 0)', async () => {
        const newest: MarketEvent = {
            ...baseEvent,
            id: 'newest',
            title: 'NEWEST ALERT',
            timestamp: Date.now(),
        };
        const older: MarketEvent = {
            ...baseEvent,
            id: 'older',
            title: 'OLDER ALERT',
            timestamp: Date.now() - 1000,
        };

        // Store prepends events: newest first.
        useTerminalStore.setState({ events: [newest, older] });

        const { unmount } = render(<ActionAlertStrip />);

        await waitFor(() => {
            expect(screen.getByText('NEWEST ALERT')).toBeInTheDocument();
        });
        expect(screen.queryByText('OLDER ALERT')).not.toBeInTheDocument();

        unmount();
    });
});
