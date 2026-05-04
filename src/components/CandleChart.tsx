import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine } from 'lightweight-charts';
import useWebSocket from 'react-use-websocket';
import { useTerminalStore } from '../store/useTerminalStore';
import { inferPriceAlertDirection } from '../store/priceAlerts';
import { type MarketType, KLINE_INTERVALS } from '../constants/binance';
import { getWsUrl } from '../utils/market';
import { formatPrice } from '../utils/formatters';
import { ManualPriceAlertControl } from './ManualPriceAlertControl';

const VALID_SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
const ALLOWED_MARKET_TYPES: ReadonlySet<string> = new Set<MarketType>(['spot', 'futures']);
const ALLOWED_INTERVALS: ReadonlySet<string> = new Set(KLINE_INTERVALS);

function buildIndicatorUrl(type: MarketType, symbol: string, interval: string): string | null {
    if (!VALID_SYMBOL_RE.test(symbol)) return null;
    if (!ALLOWED_MARKET_TYPES.has(type)) return null;
    if (!ALLOWED_INTERVALS.has(interval)) return null;
    return `/api/bot/market/${type}/${symbol}/${interval}`;
}

interface CandleChartProps {
    symbol: string; // e.g., 'BTCUSDT'
    type: MarketType;
}

type NullableArr = (number | null)[];

interface IndicatorResponse {
    klines: [number, number, number, number, number, number][];
    open_kline?: [number, number, number, number, number, number] | null;
    ema21: NullableArr;
    ema50: NullableArr;
    vwap: NullableArr;
    rsi: NullableArr;
    atr: NullableArr;
    atr_sma: NullableArr;
    bb_upper: NullableArr;
    bb_middle: NullableArr;
    bb_lower: NullableArr;
    bb_width: NullableArr;
    macd: NullableArr;
    macd_signal: NullableArr;
    macd_hist: NullableArr;
    stoch_k: NullableArr;
    stoch_d: NullableArr;
}

type ChartCandle = {
    index: number;
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function buildValidChartCandles(klines: IndicatorResponse['klines']): ChartCandle[] {
    return klines
        .map((k, index) => {
            const rawValues = [k[0], k[1], k[2], k[3], k[4], k[5]];
            if (rawValues.some((value) => value === null || value === undefined)) {
                return null;
            }

            return {
                index,
                time: Math.floor(Number(k[0]) / 1000),
                open: Number(k[1]),
                high: Number(k[2]),
                low: Number(k[3]),
                close: Number(k[4]),
                volume: Number(k[5]),
            };
        })
        .filter((candle): candle is ChartCandle => candle !== null)
        .filter((candle) =>
            [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(isFiniteNumber)
        );
}

export function CandleChart({ symbol, type }: CandleChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const pocLineRef = useRef<IPriceLine | null>(null);
    const vahLineRef = useRef<IPriceLine | null>(null);
    const valLineRef = useRef<IPriceLine | null>(null);
    const alertLinesRef = useRef<IPriceLine[]>([]);

    // Indicator Series Refs
    const ema21SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const macdSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const macdSignalSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const currentPriceRef = useRef<number>(0);

    // Indicator States for HUD
    const [latestAtr, setLatestAtr] = useState<number | null>(null);
    const [latestBBWidth, setLatestBBWidth] = useState<number | null>(null);
    const [latestMACD, setLatestMACD] = useState<{ macd: number; signal: number; histogram: number } | null>(null);
    const [isSettingAlert, setIsSettingAlert] = useState(false);
    const [manualAlertPrice, setManualAlertPrice] = useState('');
    const isSettingAlertRef = useRef(false);

    useEffect(() => {
        isSettingAlertRef.current = isSettingAlert;
    }, [isSettingAlert]);

    const oiHistory = useTerminalStore(state => state.oiHistory[symbol]);
    const globalInterval = useTerminalStore(state => state.globalInterval);
    const currentPrice = useTerminalStore(state => state.prices[symbol]) || 0;

    const sessionPoc = useTerminalStore(state => state.sessionPoc[symbol]);
    const fundingRate = useTerminalStore((state) => state.fundingRate[symbol]);
    const sessionVah = useTerminalStore(state => state.sessionVah[symbol]);
    const sessionVal = useTerminalStore(state => state.sessionVal[symbol]);
    

    const priceAlerts = useTerminalStore(state => state.priceAlerts);
    const addPriceAlert = useTerminalStore(state => state.addPriceAlert);
    const removePriceAlert = useTerminalStore(state => state.removePriceAlert);
    const fetchPriceAlerts = useTerminalStore(state => state.fetchPriceAlerts);
    const setPrice = useTerminalStore(state => state.setPrice);

    const getAlertDirection = (targetPrice: number) => {
        return inferPriceAlertDirection(targetPrice, currentPrice || currentPriceRef.current);
    };

    const manualAlertReferencePrice = currentPrice || currentPriceRef.current || null;

    const getAlertBadge = (direction: string) => {
        if (direction === 'ABOVE') return 'ABOVE';
        if (direction === 'BELOW') return 'BELOW';
        return 'CROSS';
    };

    // 1. Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Ensure container is empty before initialization
        chartContainerRef.current.innerHTML = '';

        const chart = createChart(chartContainerRef.current, {
            autoSize: true,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#808080',
            },
            grid: {
                vertLines: { color: '#333333' },
                horzLines: { color: '#333333' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: {
                mode: 1, // Normal mode
                vertLine: { color: '#00cc33', width: 1, style: 1 },
                horzLine: { color: '#00cc33', width: 1, style: 1 },
            }
        });

        // Main chart: leave bottom 38% for MACD + RSI panels
        chart.priceScale('right').applyOptions({
            scaleMargins: { top: 0, bottom: 0.38 },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#00cc33',
            downColor: '#ff3333',
            borderVisible: false,
            wickUpColor: '#00cc33',
            wickDownColor: '#ff3333',
            priceFormat: {
                type: 'price',
                precision: 6, // High base precision for small coins
                minMove: 0.000001, // Support penny coin increments
            },
            autoscaleInfoProvider: () => {
                const p = currentPriceRef.current;
                if (!p) return null;
                return {
                    priceRange: { minValue: p * 0.95, maxValue: p * 1.05 },
                    margins: { above: 0, below: 0 },
                };
            }
        });

        const ema21Series = chart.addSeries(LineSeries, {
            color: '#2962FF', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false
        });
        const ema50Series = chart.addSeries(LineSeries, {
            color: '#FF6D00', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false
        });
        const vwapSeries = chart.addSeries(LineSeries, {
            color: '#FDD835', lineWidth: 2, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false
        });
        const rsiSeries = chart.addSeries(LineSeries, {
            color: '#E040FB', lineWidth: 1, priceScaleId: 'rsi',
        });

        // RSI pane: bottom 15% of chart
        chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.86, bottom: 0.02 },
        });

        // Bollinger Bands (on main price scale)
        const bbUpperSeries = chart.addSeries(LineSeries, {
            color: 'rgba(100, 200, 255, 0.5)', lineWidth: 1, lineStyle: 2,
            crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        const bbMiddleSeries = chart.addSeries(LineSeries, {
            color: 'rgba(100, 200, 255, 0.25)', lineWidth: 1, lineStyle: 0,
            crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        const bbLowerSeries = chart.addSeries(LineSeries, {
            color: 'rgba(100, 200, 255, 0.5)', lineWidth: 1, lineStyle: 2,
            crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });

        // MACD panel: positioned between candles and RSI
        const macdSeries = chart.addSeries(LineSeries, {
            color: '#26a69a', lineWidth: 1, priceScaleId: 'macd',
            crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        const macdSignalSeries = chart.addSeries(LineSeries, {
            color: '#ef5350', lineWidth: 1, priceScaleId: 'macd',
            crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        chart.priceScale('macd').applyOptions({
            scaleMargins: { top: 0.64, bottom: 0.20 },
        });

        chartRef.current = chart;
        seriesRef.current = series;
        ema21SeriesRef.current = ema21Series;
        ema50SeriesRef.current = ema50Series;
        vwapSeriesRef.current = vwapSeries;
        rsiSeriesRef.current = rsiSeries;
        bbUpperSeriesRef.current = bbUpperSeries;
        bbMiddleSeriesRef.current = bbMiddleSeries;
        bbLowerSeriesRef.current = bbLowerSeries;
        macdSeriesRef.current = macdSeries;
        macdSignalSeriesRef.current = macdSignalSeries;

        // Fetch initial klines + indicators from bot server (single request, no Binance client fetch)
        const initUrl = buildIndicatorUrl(type, symbol, globalInterval);
        if (!initUrl) return;
        fetch(initUrl)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((ind: IndicatorResponse) => {
                if ('error' in ind || !ind?.klines?.length || !seriesRef.current) return;

                const cdata = buildValidChartCandles(ind.klines);
                if (!cdata.length) return;

                try { seriesRef.current.setData(cdata.map(({ index, ...candle }) => candle) as any); }
                catch { return; }

                // Dynamic precision from last close price
                const lastIndex = cdata[cdata.length - 1].index;
                const lastClose = cdata[cdata.length - 1].close;
                currentPriceRef.current = lastClose;
                setPrice(symbol, lastClose);
                let precision = 2;
                let minMove = 0.01;
                if (lastClose < 0.01) { precision = 8; minMove = 0.00000001; }
                else if (lastClose < 0.1) { precision = 6; minMove = 0.000001; }
                else if (lastClose < 1) { precision = 4; minMove = 0.0001; }
                else if (lastClose < 10) { precision = 3; minMove = 0.001; }
                seriesRef.current.applyOptions({ priceFormat: { type: 'price', precision, minMove } });

                const times = cdata.map(k => k.time);
                const toPoints = (arr: (number | null)[]) =>
                    cdata
                        .map((candle, i) => ({ time: times[i], value: arr[candle.index] }))
                        .filter((d): d is { time: number; value: number } =>
                            isFiniteNumber(d.value) && isFiniteNumber(d.time)
                        ) as any;

                try { ema21SeriesRef.current?.setData(toPoints(ind.ema21)); } catch { /* stale series */ }
                try { ema50SeriesRef.current?.setData(toPoints(ind.ema50)); } catch { /* stale series */ }
                try { vwapSeriesRef.current?.setData(toPoints(ind.vwap)); } catch { /* stale series */ }
                try { rsiSeriesRef.current?.setData(toPoints(ind.rsi)); } catch { /* stale series */ }
                try { bbUpperSeriesRef.current?.setData(toPoints(ind.bb_upper)); } catch { /* stale series */ }
                try { bbMiddleSeriesRef.current?.setData(toPoints(ind.bb_middle)); } catch { /* stale series */ }
                try { bbLowerSeriesRef.current?.setData(toPoints(ind.bb_lower)); } catch { /* stale series */ }
                try { macdSeriesRef.current?.setData(toPoints(ind.macd)); } catch { /* stale series */ }
                try { macdSignalSeriesRef.current?.setData(toPoints(ind.macd_signal)); } catch { /* stale series */ }

                const lAtr = ind.atr[lastIndex];
                const lBBWidth = ind.bb_width[lastIndex];
                const lMACD = ind.macd[lastIndex];
                const lSignal = ind.macd_signal[lastIndex];
                const lHist = ind.macd_hist[lastIndex];
                if (typeof lAtr === 'number') setLatestAtr(lAtr);
                if (typeof lBBWidth === 'number') setLatestBBWidth(lBBWidth);
                if (typeof lMACD === 'number' && typeof lSignal === 'number' && typeof lHist === 'number') {
                    setLatestMACD({ macd: lMACD, signal: lSignal, histogram: lHist });
                }
                useTerminalStore.getState().setIndicators(symbol, {
                    ema21: ind.ema21[lastIndex] ?? undefined,
                    ema50: ind.ema50[lastIndex] ?? undefined,
                    vwap: ind.vwap[lastIndex] ?? undefined,
                    atr: lAtr ?? undefined,
                    atrSma: ind.atr_sma?.[lastIndex] ?? undefined,
                    rsi: ind.rsi[lastIndex] ?? undefined,
                    macd: (typeof lMACD === 'number' && typeof lSignal === 'number' && typeof lHist === 'number')
                        ? { macd: lMACD, signal: lSignal, histogram: lHist } : undefined,
                    bb: (typeof ind.bb_upper[lastIndex] === 'number' && typeof ind.bb_middle[lastIndex] === 'number' && typeof ind.bb_lower[lastIndex] === 'number' && typeof lBBWidth === 'number')
                        ? { upper: ind.bb_upper[lastIndex], middle: ind.bb_middle[lastIndex], lower: ind.bb_lower[lastIndex], width: lBBWidth } : undefined,
                    stochRsi: (typeof ind.stoch_k[lastIndex] === 'number' && typeof ind.stoch_d[lastIndex] === 'number')
                        ? { k: ind.stoch_k[lastIndex], d: ind.stoch_d[lastIndex] } : undefined,
                });
            })
            .catch(() => { /* bot server not running, chart remains empty */ });

        // 1.5 Click to set Alert
        const handleChartClick = (param: any) => {
            const isManualTrigger = isSettingAlertRef.current;
            const ev = param.sourceEvent || param.originalEvent;
            const isShiftTrigger = ev?.shiftKey;

            if (param.point && (isManualTrigger || isShiftTrigger) && seriesRef.current) {
                const price = seriesRef.current.coordinateToPrice(param.point.y);
                if (price) {
                    const newAlert = {
                        id: Math.random().toString(36).substr(2, 9),
                        symbol: symbol,
                        price: price, // Maintain full precision
                        direction: getAlertDirection(price),
                        createdAt: Date.now()
                    };
                    addPriceAlert(newAlert);
                    if (isManualTrigger) setIsSettingAlert(false); // Reset toggle after clicking
                }
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isSettingAlert) {
                setIsSettingAlert(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        chart.subscribeClick(handleChartClick);
        fetchPriceAlerts(); // Initial fetch

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            chart.unsubscribeClick(handleChartClick);
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            pocLineRef.current = null;
            vahLineRef.current = null;
            valLineRef.current = null;
            ema21SeriesRef.current = null;
            ema50SeriesRef.current = null;
            vwapSeriesRef.current = null;
            rsiSeriesRef.current = null;
            bbUpperSeriesRef.current = null;
            bbMiddleSeriesRef.current = null;
            bbLowerSeriesRef.current = null;
            macdSeriesRef.current = null;
            macdSignalSeriesRef.current = null;
        };
    }, [symbol, type, globalInterval]);

    // 2. Real-time updates via WebSocket
    const wsUrl = getWsUrl(symbol, globalInterval, type);
    const { lastJsonMessage } = useWebSocket(wsUrl);

    useEffect(() => {
        if (lastJsonMessage && seriesRef.current) {
            const data = lastJsonMessage as any;
            if (data.e === 'kline' && data.k) {
                const kline = data.k;
                const updateData = {
                    time: Math.floor(Number(kline.t) / 1000),
                    open: parseFloat(kline.o),
                    high: parseFloat(kline.h),
                    low: parseFloat(kline.l),
                    close: parseFloat(kline.c),
                    volume: parseFloat(kline.v),
                };

                if (
                    isFiniteNumber(updateData.time) && updateData.time > 0 &&
                    isFiniteNumber(updateData.open) && isFiniteNumber(updateData.high) &&
                    isFiniteNumber(updateData.low) && isFiniteNumber(updateData.close) &&
                    isFiniteNumber(updateData.volume)
                ) {
                    currentPriceRef.current = updateData.close;
                    setPrice(symbol, updateData.close);
                    try { seriesRef.current.update(updateData as any); } catch { /* ignore stale update */ }
                }
            }
        }
    }, [lastJsonMessage]);

    // 2b. Poll server every 5s for latest indicator values (host-side computation)
    useEffect(() => {
        const pollUrl = buildIndicatorUrl(type, symbol, globalInterval);
        if (!pollUrl) return;
        const controller = new AbortController();
        const fetchIndicators = () => {
            fetch(pollUrl, { signal: controller.signal })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((ind: IndicatorResponse) => {
                if ('error' in ind || !ind?.klines?.length) return;
                    const candles = buildValidChartCandles(ind.klines);
                    if (!candles.length) return;
                    const lastCandle = candles[candles.length - 1];
                    const last = lastCandle.index;
                    const time = lastCandle.time as any;
                    currentPriceRef.current = lastCandle.close;
                    setPrice(symbol, lastCandle.close);

                    if (typeof ind.ema21[last] === 'number' && ema21SeriesRef.current) ema21SeriesRef.current.update({ time, value: ind.ema21[last]! });
                    if (typeof ind.ema50[last] === 'number' && ema50SeriesRef.current) ema50SeriesRef.current.update({ time, value: ind.ema50[last]! });
                    if (typeof ind.vwap[last] === 'number' && vwapSeriesRef.current) vwapSeriesRef.current.update({ time, value: ind.vwap[last]! });
                    if (typeof ind.rsi[last] === 'number' && rsiSeriesRef.current) rsiSeriesRef.current.update({ time, value: ind.rsi[last]! });
                    if (typeof ind.bb_upper[last] === 'number' && bbUpperSeriesRef.current) bbUpperSeriesRef.current.update({ time, value: ind.bb_upper[last]! });
                    if (typeof ind.bb_middle[last] === 'number' && bbMiddleSeriesRef.current) bbMiddleSeriesRef.current.update({ time, value: ind.bb_middle[last]! });
                    if (typeof ind.bb_lower[last] === 'number' && bbLowerSeriesRef.current) bbLowerSeriesRef.current.update({ time, value: ind.bb_lower[last]! });
                    if (typeof ind.macd[last] === 'number' && macdSeriesRef.current) macdSeriesRef.current.update({ time, value: ind.macd[last]! });
                    if (typeof ind.macd_signal[last] === 'number' && macdSignalSeriesRef.current) macdSignalSeriesRef.current.update({ time, value: ind.macd_signal[last]! });

                    const lAtr = ind.atr[last];
                    const lBBWidth = ind.bb_width[last];
                    const lMACD = ind.macd[last];
                    const lSignal = ind.macd_signal[last];
                    const lHist = ind.macd_hist[last];
                    if (typeof lAtr === 'number') setLatestAtr(lAtr);
                    if (typeof lBBWidth === 'number') setLatestBBWidth(lBBWidth);
                    if (typeof lMACD === 'number' && typeof lSignal === 'number' && typeof lHist === 'number') {
                        setLatestMACD({ macd: lMACD, signal: lSignal, histogram: lHist });
                    }
                    useTerminalStore.getState().setIndicators(symbol, {
                        ema21: ind.ema21[last] ?? undefined,
                        ema50: ind.ema50[last] ?? undefined,
                        vwap: ind.vwap[last] ?? undefined,
                        atr: lAtr ?? undefined,
                        atrSma: ind.atr_sma?.[last] ?? undefined,
                        rsi: ind.rsi[last] ?? undefined,
                        macd: (typeof lMACD === 'number' && typeof lSignal === 'number' && typeof lHist === 'number')
                            ? { macd: lMACD, signal: lSignal, histogram: lHist } : undefined,
                        bb: (typeof ind.bb_upper[last] === 'number' && typeof ind.bb_middle[last] === 'number' && typeof ind.bb_lower[last] === 'number' && typeof lBBWidth === 'number')
                            ? { upper: ind.bb_upper[last], middle: ind.bb_middle[last], lower: ind.bb_lower[last], width: lBBWidth } : undefined,
                        stochRsi: (typeof ind.stoch_k[last] === 'number' && typeof ind.stoch_d[last] === 'number')
                            ? { k: ind.stoch_k[last], d: ind.stoch_d[last] } : undefined,
                    });
                })
                .catch((e: unknown) => { if (e instanceof Error && e.name !== 'AbortError') { /* bot server not available */ } });
        };

        const indicatorPoll = setInterval(fetchIndicators, 15000);
        return () => { clearInterval(indicatorPoll); controller.abort(); };
    }, [symbol, type, globalInterval, setPrice]);

    // 3. Draw Volume Profile Lines
    useEffect(() => {
        if (!seriesRef.current) return;

        if (pocLineRef.current) {
            try { seriesRef.current.removePriceLine(pocLineRef.current); } catch (e) { }
            pocLineRef.current = null;
        }
        if (vahLineRef.current) {
            try { seriesRef.current.removePriceLine(vahLineRef.current); } catch (e) { }
            vahLineRef.current = null;
        }
        if (valLineRef.current) {
            try { seriesRef.current.removePriceLine(valLineRef.current); } catch (e) { }
            valLineRef.current = null;
        }

        if (sessionPoc) {
            pocLineRef.current = seriesRef.current.createPriceLine({
                price: sessionPoc,
                color: '#fbbf24', // Yellow color for POC
                lineWidth: 2,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: 'POC',
            });
        }

        if (sessionVah) {
            vahLineRef.current = seriesRef.current.createPriceLine({
                price: sessionVah,
                color: 'rgba(255, 255, 255, 0.3)',
                lineWidth: 1,
                lineStyle: 3, // Dotted
                axisLabelVisible: true,
                title: 'VAH',
            });
        }

        if (sessionVal) {
            valLineRef.current = seriesRef.current.createPriceLine({
                price: sessionVal,
                color: 'rgba(255, 255, 255, 0.3)',
                lineWidth: 1,
                lineStyle: 3, // Dotted
                axisLabelVisible: true,
                title: 'VAL',
            });
        }
    }, [sessionPoc, sessionVah, sessionVal]);

    // 4. Draw Custom Price Alerts
    useEffect(() => {
        if (!seriesRef.current || !chartRef.current) return;

        alertLinesRef.current.forEach(line => {
            try { seriesRef.current?.removePriceLine(line); } catch (e) { }
        });
        alertLinesRef.current = [];

        const currentSymbol = symbol.toUpperCase();
        const myAlerts = priceAlerts.filter(a => a.symbol.toUpperCase() === currentSymbol);

        myAlerts.forEach(alert => {
            const line = seriesRef.current?.createPriceLine({
                price: alert.price,
                color: '#E040FB', // Purple for alerts
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: `🔔 ALERT: ${formatPrice(alert.price)}`,
            });
            if (line) {
                line.applyOptions({ title: `ALERT ${getAlertBadge(alert.direction)}: ${formatPrice(alert.price)}` });
                alertLinesRef.current.push(line);
            }
        });
    }, [priceAlerts, symbol]);

    const handleAddManualAlert = () => {
        const p = parseFloat(manualAlertPrice);
        if (!isNaN(p) && p > 0) {
            addPriceAlert({
                id: Math.random().toString(36).substr(2, 9),
                symbol: symbol,
                price: p,
                direction: getAlertDirection(p),
                createdAt: Date.now()
            });
            setManualAlertPrice('');
        }
    };

    return (
        <div className="relative w-full h-full group">
            {/* HUD Overlay */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none flex flex-col gap-1 text-xs drop-shadow-md">
                <div className="flex gap-4 bg-[#18042B]/80 px-2 py-1.5 rounded w-fit border border-purple-500/30">
                    <div className="flex flex-col">
                        <span className="text-terminal-muted opacity-70 text-[9px]">ATR (14)</span>
                        <span className="font-mono text-terminal-fg font-bold">{latestAtr !== null ? formatPrice(latestAtr) : '...'}</span>
                    </div>
                    {type === 'futures' && (
                        <>
                            <div className="w-px h-full bg-terminal-border/30"></div>
                            <div className="flex flex-col">
                                <span className="text-terminal-muted opacity-70 text-[9px]">FUNDING</span>
                                <span className={`font-mono font-bold ${fundingRate && fundingRate > 0 ? 'text-terminal-green' : fundingRate && fundingRate < 0 ? 'text-terminal-red' : 'text-terminal-fg'}`}>
                                    {fundingRate ? `${(fundingRate * 100).toFixed(4)}%` : '...'}
                                </span>
                            </div>
                        </>
                    )}
                    <div className="w-px h-full bg-terminal-border/30"></div>
                    <div className="flex flex-col">
                        <span className="text-terminal-muted opacity-70 text-[9px]">OI TREND</span>
                        {oiHistory && oiHistory.length > 1 ? (
                            <span className={`font-mono font-bold ${oiHistory[oiHistory.length - 1].value > oiHistory[oiHistory.length - 2].value ? 'text-terminal-green' : 'text-terminal-red'}`}>
                                {oiHistory[oiHistory.length - 1].value > oiHistory[oiHistory.length - 2].value ? '▲ INCREASING' : '▼ DECREASING'}
                            </span>
                        ) : (
                            <span className="font-mono text-terminal-muted font-bold">...</span>
                        )}
                    </div>
                </div>

                <div className="flex gap-3 px-2 mt-1">
                    <span className="text-[#2962FF] font-mono text-[9px] font-bold">EMA 21</span>
                    <span className="text-[#FF6D00] font-mono text-[9px] font-bold">EMA 50</span>
                    <span className="text-[#FDD835] font-mono text-[9px] font-bold">VWAP</span>
                    <span className="text-[#E040FB] font-mono text-[9px] font-bold">RSI(14)</span>
                    <span className="text-[rgba(100,200,255,0.8)] font-mono text-[9px] font-bold">BB</span>
                    <span className="text-[#26a69a] font-mono text-[9px] font-bold">MACD</span>
                </div>

                {/* BB Squeeze + MACD State */}
                {(typeof latestBBWidth === 'number' || latestMACD !== null) && (
                    <div className="flex gap-3 bg-[#18042B]/80 px-2 py-1.5 rounded w-fit border border-purple-500/30 mt-1">
                        {typeof latestBBWidth === 'number' && (
                            <div className="flex flex-col">
                                <span className="text-terminal-muted opacity-70 text-[9px]">BB WIDTH</span>
                                <span className={`font-mono font-bold ${latestBBWidth < 2 ? 'text-yellow-400' : latestBBWidth < 4 ? 'text-terminal-fg' : 'text-terminal-green'}`}>
                                    {latestBBWidth.toFixed(2)}%{latestBBWidth < 2 ? ' SQUEEZE' : ''}
                                </span>
                            </div>
                        )}
                        {latestMACD !== null && (
                            <>
                                {typeof latestBBWidth === 'number' && <div className="w-px h-full bg-terminal-border/30"></div>}
                                <div className="flex flex-col">
                                    <span className="text-terminal-muted opacity-70 text-[9px]">MACD</span>
                                    <span className={`font-mono font-bold ${latestMACD.histogram > 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                                        {latestMACD.histogram > 0 ? '▲' : '▼'} {latestMACD.histogram.toFixed(4)}
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-terminal-muted opacity-70 text-[9px]">SIGNAL</span>
                                    <span className={`font-mono font-bold ${latestMACD.macd > latestMACD.signal ? 'text-terminal-green' : 'text-terminal-red'}`}>
                                        {latestMACD.macd > latestMACD.signal ? 'BULL' : 'BEAR'}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Alerts Indicator & Controls */}
                <div className="mt-2 flex gap-2 pointer-events-auto">
                    <div className="flex bg-[#18042B]/80 border border-purple-500/50 rounded overflow-hidden backdrop-blur-sm">
                        <button
                            onClick={() => setIsSettingAlert(!isSettingAlert)}
                            className={`flex items-center gap-2 px-2 py-1 transition-all ${isSettingAlert ? 'bg-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'text-purple-400 hover:bg-purple-500/20'}`}
                            title="Click button then click on chart to set alert"
                        >
                            <span>{isSettingAlert ? '📍' : '➕'}</span>
                            <span className="font-bold text-[10px]">{isSettingAlert ? 'CLICK ON CHART' : 'ADD ALERT'}</span>
                        </button>

                        <div className="w-px bg-purple-500/30"></div>

                        <ManualPriceAlertControl
                            manualAlertPrice={manualAlertPrice}
                            onPriceChange={setManualAlertPrice}
                            onSave={handleAddManualAlert}
                            referencePrice={manualAlertReferencePrice}
                        />
                    </div>

                    {priceAlerts.filter(a => a.symbol === symbol).length > 0 && (
                        <div className="group/alerts relative">
                            <button className="flex items-center gap-2 bg-purple-500/20 hover:bg-purple-500/40 border border-purple-500/50 px-2 py-1 rounded transition-colors backdrop-blur-sm">
                                <span className="text-purple-400">🔔</span>
                                <span className="text-purple-300 font-bold text-[10px]">
                                    {priceAlerts.filter(a => a.symbol === symbol).length} ACTIVE
                                </span>
                            </button>

                            {/* Management Menu */}
                            <div className="absolute top-full left-0 mt-2 bg-[#18042B]/95 border border-purple-500/30 rounded shadow-2xl overflow-hidden opacity-0 group-hover/alerts:opacity-100 transition-opacity min-w-[180px] z-20 backdrop-blur-md">
                                <div className="bg-purple-900/40 px-3 py-2 border-b border-purple-500/20 text-[10px] uppercase font-bold text-purple-200">
                                    Manage Alerts
                                </div>
                                <div className="max-h-[200px] overflow-y-auto">
                                    {priceAlerts.filter(a => a.symbol === symbol).map(alert => (
                                        <div key={alert.id} className="flex items-center justify-between px-3 py-2 border-b border-purple-500/10 hover:bg-white/5 transition-colors">
                                            <div className="flex flex-col">
                                                <span className="text-terminal-fg font-mono font-bold">{formatPrice(alert.price)}</span>
                                                <span className="text-[9px] text-purple-300/80 uppercase tracking-wide">{getAlertBadge(alert.direction)}</span>
                                                <span className="text-[9px] text-terminal-muted opacity-60">{new Date(alert.createdAt).toLocaleTimeString()}</span>
                                            </div>
                                            <button
                                                onClick={() => removePriceAlert(alert.id)}
                                                className="text-terminal-red hover:bg-red-500/20 p-1 rounded transition-colors text-[10px]"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div ref={chartContainerRef} className={`absolute inset-0 ${isSettingAlert ? 'cursor-crosshair' : ''}`} />
        </div>
    );
}
