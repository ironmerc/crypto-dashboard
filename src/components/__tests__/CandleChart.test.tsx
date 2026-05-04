import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalStore } from '../../store/useTerminalStore';
import { CandleChart } from '../CandleChart';

const candlestickSeries = {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
    coordinateToPrice: vi.fn(() => 100),
};

const makeLineSeries = () => ({
    setData: vi.fn(),
    update: vi.fn(),
});

const chartApi = {
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    addSeries: vi.fn((seriesType: string) => (
        seriesType === 'candlestick' ? candlestickSeries : makeLineSeries()
    )),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    remove: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
    createChart: vi.fn(() => chartApi),
    ColorType: { Solid: 'solid' },
    CandlestickSeries: 'candlestick',
    LineSeries: 'line',
}));

describe('CandleChart', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        window.localStorage.clear();
        useTerminalStore.setState({
            ...useTerminalStore.getInitialState(),
            globalInterval: '5m',
            fetchPriceAlerts: vi.fn().mockResolvedValue(undefined),
            addPriceAlert: vi.fn().mockResolvedValue(undefined),
            removePriceAlert: vi.fn().mockResolvedValue(undefined),
            priceAlerts: [],
        });
    });

    it('filters invalid candle rows before passing data to lightweight-charts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                klines: [
                    [1710000000000, 100, 110, 95, 105, 500],
                    [1710000060000, null, 112, 98, 108, 400],
                ],
                ema21: [],
                ema50: [],
                vwap: [],
                rsi: [],
                atr: [],
                atr_sma: [],
                bb_upper: [],
                bb_middle: [],
                bb_lower: [],
                bb_width: [],
                macd: [],
                macd_signal: [],
                macd_hist: [],
                stoch_k: [],
                stoch_d: [],
            }),
        }));

        render(<CandleChart symbol="BTCUSDT" type="futures" />);
        await act(async () => {
            await Promise.resolve();
        });

        expect(candlestickSeries.setData).toHaveBeenCalledWith([
            {
                time: 1710000000,
                open: 100,
                high: 110,
                low: 95,
                close: 105,
                volume: 500,
            },
        ]);
    });

    it('does not poll price alerts every three seconds', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                klines: [],
                ema21: [],
                ema50: [],
                vwap: [],
                rsi: [],
                atr: [],
                atr_sma: [],
                bb_upper: [],
                bb_middle: [],
                bb_lower: [],
                bb_width: [],
                macd: [],
                macd_signal: [],
                macd_hist: [],
                stoch_k: [],
                stoch_d: [],
            }),
        }));
        const fetchPriceAlerts = vi.fn().mockResolvedValue(undefined);
        useTerminalStore.setState({ fetchPriceAlerts });

        render(<CandleChart symbol="BTCUSDT" type="futures" />);

        await act(async () => {
            vi.advanceTimersByTime(9000);
        });

        expect(fetchPriceAlerts).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite live websocket price state from fetched candle closes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                klines: [
                    [1710000000000, 100, 110, 95, 105, 500],
                    [1710000060000, 105, 112, 98, 108, 400],
                ],
                ema21: [100, 101],
                ema50: [99, 100],
                vwap: [100, 101],
                rsi: [50, 55],
                atr: [5, 6],
                atr_sma: [4, 5],
                bb_upper: [110, 111],
                bb_middle: [100, 101],
                bb_lower: [90, 91],
                bb_width: [2, 2.2],
                macd: [1, 1.2],
                macd_signal: [0.8, 1],
                macd_hist: [0.2, 0.2],
                stoch_k: [40, 45],
                stoch_d: [38, 43],
            }),
        }));

        render(<CandleChart symbol="BTCUSDT" type="futures" />);
        await act(async () => {
            await Promise.resolve();
        });

        expect(useTerminalStore.getState().livePrices.BTCUSDT).toBeUndefined();
        expect(useTerminalStore.getState().prices.BTCUSDT).toBeUndefined();
    });
});
