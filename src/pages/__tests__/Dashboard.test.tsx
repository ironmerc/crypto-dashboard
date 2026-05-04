import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';
import { useTerminalStore } from '../../store/useTerminalStore';

const hooks = vi.hoisted(() => ({
    useSmartAlerts: vi.fn(),
}));

vi.mock('react-resizable-panels', () => ({
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Separator: () => <div />,
}));

vi.mock('../../hooks/useBinanceWebSocket', () => ({
    useBinanceTickers: vi.fn(() => ({})),
}));

vi.mock('../../hooks/useFearGreedIndex', () => ({
    useFearGreedIndex: vi.fn(() => ({ data: { value: '40' }, loading: false })),
}));

vi.mock('../../hooks/useFuturesStream', () => ({
    useFuturesStream: vi.fn(),
}));

vi.mock('../../hooks/useOpenInterest', () => ({
    useOpenInterest: vi.fn(),
}));

vi.mock('../../hooks/useBackendAlerts', () => ({
    useBackendAlerts: vi.fn(),
}));

vi.mock('../../hooks/useCoinbasePremium', () => ({
    useCoinbasePremium: vi.fn(),
}));

vi.mock('../../hooks/useSectorBreadth', () => ({
    useSectorBreadth: vi.fn(),
}));

vi.mock('../../hooks/usePageVisibility', () => ({
    usePageVisibility: vi.fn(() => true),
}));

vi.mock('../../hooks/useSmartAlerts', () => ({
    useSmartAlerts: hooks.useSmartAlerts,
}));

vi.mock('../../components/CandleChart', () => ({
    CandleChart: () => <div>chart</div>,
}));

vi.mock('../../components/OrderBook', () => ({
    OrderBook: () => <div>orderbook</div>,
}));

vi.mock('../../components/EventFeed', () => ({
    EventFeed: () => <div>eventfeed</div>,
}));

vi.mock('../../components/VolumeTape', () => ({
    VolumeTape: () => <div>volumetape</div>,
}));

vi.mock('../../components/FundingRateMonitor', () => ({
    FundingRateMonitor: () => <div>funding</div>,
}));

vi.mock('../../components/MarketContext', () => ({
    MarketContext: () => <div>context</div>,
}));

vi.mock('../../components/ActionAlertStrip', () => ({
    ActionAlertStrip: () => <div>alertstrip</div>,
}));

vi.mock('../../components/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('Dashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        useTerminalStore.setState({
            ...useTerminalStore.getInitialState(),
            telegramConfig: {
                ...useTerminalStore.getInitialState().telegramConfig,
                monitoredSymbols: ['BTCUSDT', 'ETHUSDT'],
            },
        });
    });

    it('starts smart alerts for the active symbol', () => {
        render(
            <MemoryRouter>
                <Dashboard />
            </MemoryRouter>
        );

        expect(hooks.useSmartAlerts).toHaveBeenCalledWith('BTCUSDT');
    });
});
