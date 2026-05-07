import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { useSmartAlerts, getCurrentSession, sendTelegramAlert } from '../useSmartAlerts';
import { formatAlertMessage, formatAlertTitle, ALERT_DEFAULTS } from '../../constants/alerts';
import { TIMING, TIMEFRAME_MS } from '../../constants/timing';
import { useTerminalStore } from '../../store/useTerminalStore';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('formatAlertMessage', () => {
    it('includes the timeframe tag when tf is provided', () => {
        const result = formatAlertMessage('MY TITLE', 'body text', '1h');
        expect(result).toBe('<b>🚨 MY TITLE [1h]</b>\n\nbody text');
    });

    it('omits the timeframe tag when tf is absent', () => {
        const result = formatAlertMessage('MY TITLE', 'body text');
        expect(result).toBe('<b>🚨 MY TITLE</b>\n\nbody text');
    });
});

describe('formatAlertTitle', () => {
    it('produces the [SYMBOL] NAME format', () => {
        expect(formatAlertTitle('BTCUSDT', 'VOLATILITY EXPANSION')).toBe('[BTCUSDT] VOLATILITY EXPANSION');
    });
});

describe('getCurrentSession', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it.each([
        [2,  'Asia'],
        [10, 'London'],
        [15, 'US'],
    ])('UTC hour %i maps to %s session', (hour, expected) => {
        vi.setSystemTime(new Date(`2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`));
        expect(getCurrentSession()).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// sendTelegramAlert
// ---------------------------------------------------------------------------

describe('sendTelegramAlert', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('posts to the bot alert endpoint with tf in the body', async () => {
        await sendTelegramAlert('[BTC] TEST', 'body', 'test_type', 300, 'test_cat', '15m');

        expect(fetch).toHaveBeenCalledOnce();
        const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(init.body as string);

        expect(body.message).toContain('[15m]');
        expect(body.type).toBe('test_type');
        expect(body.tf).toBe('15m');
        expect(body.category).toBe('test_cat');
    });

    it('does not include tf in the body when tf is omitted', async () => {
        await sendTelegramAlert('[BTC] TEST', 'body', 'test_type', 300, 'test_cat');

        const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(init.body as string);

        // The title contains [BTC] but there should be no [tf] timeframe suffix
        expect(body.message).not.toMatch(/\[\d+[mhMdwM]\]/);
        expect(body.tf).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// useSmartAlerts hook — integration tests
// ---------------------------------------------------------------------------

const BASE_STATE = {
    livePrices: { BTCUSDT: 50_000 },
    globalInterval: '5m' as const,
    telegramConfig: {
        globalEnabled: true,
        activeSessions: ['London', 'US', 'Asia'],
        monitoredSymbols: [],
        alertOnStateChange: true,
        quietHours: { enabled: false, start: '22:00', end: '06:00' },
        categories: {},
        cooldowns: {},
        thresholds: {
            global: {
                whaleMinAmount: 500_000,
                liquidationMinAmount: 1_000_000,
                oiSpikePercentage: ALERT_DEFAULTS.OI_SPIKE_PERCENTAGE,
                fundingExtremeRate: 0.05,
                atrExpansionRatio: ALERT_DEFAULTS.ATR_EXPANSION_RATIO,
                whaleMomentumDelta: 5_000_000,
                rvolMultiplier: 3.0,
                rsiOverbought: 70,
                rsiOversold: 30,
                emaSeparationPct: 0.15,
                macdFreshnessRatio: ALERT_DEFAULTS.MACD_FRESHNESS_RATIO,
                bbSqueezeWidthPct: ALERT_DEFAULTS.BB_SQUEEZE_WIDTH_PCT,
                stochOverbought: ALERT_DEFAULTS.STOCH_OVERBOUGHT,
                stochOversold: ALERT_DEFAULTS.STOCH_OVERSOLD,
                oiDivergenceLookbackBars: ALERT_DEFAULTS.OI_DIVERGENCE_LOOKBACK_BARS,
            },
        },
        timeframes: {
            atr_expand: [],
            ema_cross: [],
            oi_spike: [],
            rsi_extreme: [],
            rvol_spike: [],
            macd_cross: [],
            bb_squeeze: [],
            bb_breakout: [],
            stoch_extreme: [],
            oi_divergence: [],
            level_testing: [],
        },
    },
    // indicator state that satisfies ATR expansion condition (ratio = 2.0 > 1.3)
    currentATR:    { BTCUSDT: 100 },
    currentAtrSma: { BTCUSDT: 50 },
};

describe('useSmartAlerts hook', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        useTerminalStore.setState(BASE_STATE as any);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    const advanceLoop = () => act(() => { vi.advanceTimersByTime(TIMING.ALERT_LOOP_MS + 50); });

    // -- ATR alert fires --
    it('sends ATR expansion alert when ratio exceeds threshold', async () => {
        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/alert'),
            expect.objectContaining({ method: 'POST' }),
        );
        const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
        expect(body.type).toBe('atr_expand');
        expect(body.tf).toBe('5m');
    });

    // -- global toggle --
    it('does not send any alert when globalEnabled is false', async () => {
        useTerminalStore.setState({
            telegramConfig: { ...BASE_STATE.telegramConfig, globalEnabled: false },
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        expect(fetch).not.toHaveBeenCalled();
    });

    // -- category toggle --
    it('suppresses alert when category is explicitly disabled', async () => {
        useTerminalStore.setState({
            telegramConfig: {
                ...BASE_STATE.telegramConfig,
                categories: { atr_expand: false },
            },
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        expect(fetch).not.toHaveBeenCalled();
    });

    // -- timeframe: empty list allows all --
    it('fires alert when category timeframes is empty [] (allow all)', async () => {
        useTerminalStore.setState({
            telegramConfig: {
                ...BASE_STATE.telegramConfig,
                timeframes: { ...BASE_STATE.telegramConfig.timeframes, atr_expand: [] },
            },
            globalInterval: '1h',
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        expect(fetch).toHaveBeenCalled();
    });

    // -- timeframe: restrictive list blocks unlisted tf --
    it('blocks alert when category timeframes excludes the active interval', async () => {
        useTerminalStore.setState({
            telegramConfig: {
                ...BASE_STATE.telegramConfig,
                timeframes: { ...BASE_STATE.telegramConfig.timeframes, atr_expand: ['1h', '4h'] },
            },
            globalInterval: '5m',
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        expect(fetch).not.toHaveBeenCalled();
    });

    // -- timeframe: restrictive list passes matching tf --
    it('fires alert when active interval is in the category timeframes list', async () => {
        useTerminalStore.setState({
            telegramConfig: {
                ...BASE_STATE.telegramConfig,
                timeframes: { ...BASE_STATE.telegramConfig.timeframes, atr_expand: ['1h', '4h'] },
            },
            globalInterval: '1h',
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        expect(fetch).toHaveBeenCalled();
    });

    // -- OI spike window scales with chart interval --
    it('OI spike window uses TIMEFRAME_MS for the active interval', async () => {
        const now = Date.now();
        const windowMs = TIMEFRAME_MS['1h']!; // 3 600 000 ms

        // Use a 60 s margin so the point stays inside the 1h window even after
        // the test advances fake time by TIMING.ALERT_LOOP_MS (~5 s).
        const withinWindow = { timestamp: now - windowMs + 60_000, value: 100 };
        const outsideWindow = { timestamp: now - windowMs - 1_000, value: 200 };
        const newest = { timestamp: now, value: 120 };                // +20% from withinWindow

        useTerminalStore.setState({
            currentATR: {},       // disable ATR alert
            currentAtrSma: {},
            oiHistory: { BTCUSDT: [outsideWindow, withinWindow, newest] },
            globalInterval: '1h',
            telegramConfig: { ...BASE_STATE.telegramConfig, timeframes: { ...BASE_STATE.telegramConfig.timeframes, oi_spike: [] } },
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        // (120 - 100) / 100 * 100 = 20% > 1.5 threshold → should fire oi_spike
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => {
            const body = JSON.parse((init as RequestInit).body as string);
            return body.type === 'oi_spike';
        });
        expect(calls.length).toBeGreaterThan(0);
    });

    // -- OI divergence samplesPerCandle scaling --
    it('OI divergence lookback scales with the active interval', async () => {
        const tfMs = TIMEFRAME_MS['1h']!;
        const samplesPerCandle = Math.max(1, Math.round(tfMs / TIMING.OI_POLL_MS)); // 60
        const lookbackBars = ALERT_DEFAULTS.OI_DIVERGENCE_LOOKBACK_BARS;            // 6
        const needed = lookbackBars * samplesPerCandle;                              // 360

        const now = Date.now();
        // Price is declining (ema21 > price → priceTrendUp = false)
        // OI is also declining → OI/PRICE CORRELATION: SHORT COVERING signal
        const oiHistory = Array.from({ length: needed }, (_, i) => ({
            timestamp: now - (needed - i) * TIMING.OI_POLL_MS,
            value: 1000 - i, // steadily declining
        }));

        useTerminalStore.setState({
            currentATR: {},
            currentAtrSma: {},
            oiHistory: { BTCUSDT: oiHistory },
            currentEMA21: { BTCUSDT: 60_000 }, // > livePrices (50k) → priceTrendUp = false
            globalInterval: '1h',
            telegramConfig: {
                ...BASE_STATE.telegramConfig,
                timeframes: { ...BASE_STATE.telegramConfig.timeframes, oi_divergence: [] },
            },
        } as any);

        renderHook(() => useSmartAlerts('BTCUSDT'));
        await advanceLoop();

        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => {
            const body = JSON.parse((init as RequestInit).body as string);
            return body.type === 'oi_divergence';
        });
        expect(calls.length).toBeGreaterThan(0);
    });
});
