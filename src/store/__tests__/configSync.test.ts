import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalStore, type TelegramConfig } from '../useTerminalStore';
import { fetchConfigFromBot } from '../../utils/syncConfig';

const GLOBAL_THRESHOLDS = {
    whaleMinAmount: 500000,
    liquidationMinAmount: 1000000,
    oiSpikePercentage: 1.5,
    fundingExtremeRate: 0.05,
    atrExpansionRatio: 1.3,
    whaleMomentumDelta: 5000000,
    rvolMultiplier: 3.0,
    rsiOverbought: 70,
    rsiOversold: 30,
    emaSeparationPct: 0.15,
    macdFreshnessRatio: 0.1,
    bbSqueezeWidthPct: 2.0,
    stochOverbought: 85,
    stochOversold: 15,
    oiDivergenceLookbackBars: 6,
};

function makeConfig(symbols: Array<{ symbol: string; type: 'spot' | 'futures' }>): TelegramConfig {
    const thresholds = Object.fromEntries(
        symbols.map(({ symbol }) => [symbol, { ...GLOBAL_THRESHOLDS }])
    );

    return {
        globalEnabled: true,
        activeSessions: ['London', 'US', 'Asia'],
        monitoredSymbols: symbols,
        alertOnStateChange: true,
        quietHours: {
            enabled: false,
            start: '22:00',
            end: '06:00',
        },
        categories: {},
        cooldowns: {},
        timeframes: {
            atr_expand: ['1h', '4h', '1d', '1w', '1M'],
            ema_cross: ['1h', '4h', '1d', '1w', '1M'],
            level_testing: ['1h', '4h', '1d', '1w', '1M'],
            oi_spike: ['1h', '4h', '1d', '1w', '1M'],
            rsi_extreme: ['1h', '4h', '1d', '1w', '1M'],
            rvol_spike: ['1h', '4h', '1d', '1w', '1M'],
            macd_cross: ['1h', '4h', '1d', '1w', '1M'],
            bb_squeeze: ['1h', '4h', '1d', '1w', '1M'],
            bb_breakout: ['1h', '4h', '1d', '1w', '1M'],
            stoch_extreme: ['1h', '4h', '1d', '1w', '1M'],
            oi_divergence: ['1h', '4h', '1d', '1w', '1M'],
        },
        thresholds: {
            global: { ...GLOBAL_THRESHOLDS },
            ...thresholds,
        },
    };
}

const INITIAL_CONFIG = makeConfig([{ symbol: 'BTCUSDT', type: 'futures' }]);

describe('config sync behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        window.localStorage.clear();
        useTerminalStore.setState({
            ...useTerminalStore.getInitialState(),
            telegramConfig: INITIAL_CONFIG,
            isConfigFetched: true,
        });
    });

    it('does not add a monitored symbol locally before the backend confirms the save', async () => {
        const savedConfig = makeConfig([
            { symbol: 'BTCUSDT', type: 'futures' },
            { symbol: 'SOLUSDT', type: 'futures' },
        ]);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'success', config: savedConfig }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const pendingSave = useTerminalStore.getState().addMonitoredSymbol('SOLUSDT', 'futures') as unknown as Promise<unknown>;

        expect(useTerminalStore.getState().telegramConfig.monitoredSymbols).toEqual([
            { symbol: 'BTCUSDT', type: 'futures' },
        ]);

        vi.runAllTimers();
        await pendingSave;
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalled();
        expect(useTerminalStore.getState().telegramConfig.monitoredSymbols).toEqual([
            { symbol: 'BTCUSDT', type: 'futures' },
            { symbol: 'SOLUSDT', type: 'futures' },
        ]);
    });

    it('ignores fetched config while a newer save is still in flight', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => makeConfig([{ symbol: 'BTCUSDT', type: 'futures' }]),
        });
        vi.stubGlobal('fetch', fetchMock);

        const locallySavedConfig = makeConfig([
            { symbol: 'BTCUSDT', type: 'futures' },
            { symbol: 'SOLUSDT', type: 'futures' },
        ]);

        useTerminalStore.setState({
            telegramConfig: locallySavedConfig,
            isConfigFetched: true,
            isConfigSaving: true,
        } as any);

        await fetchConfigFromBot();

        expect(useTerminalStore.getState().telegramConfig.monitoredSymbols).toEqual([
            { symbol: 'BTCUSDT', type: 'futures' },
            { symbol: 'SOLUSDT', type: 'futures' },
        ]);
    });
});
