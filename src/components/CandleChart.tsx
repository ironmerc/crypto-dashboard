import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine } from 'lightweight-charts';
import useWebSocket from 'react-use-websocket';
import { useTerminalStore } from '../store/useTerminalStore';
import { inferPriceAlertDirection } from '../store/priceAlerts';
import { calculateEMA, calculateVWAP, calculateRSI, calculateATR, calculateSMA, calculateMACD, calculateBollingerBands, calculateStochRSI } from '../utils/indicators';
import { type MarketType } from '../constants/binance';
import { getKlineUrl, getWsUrl } from '../utils/market';
import { formatPrice } from '../utils/formatters';
import { ManualPriceAlertControl } from './ManualPriceAlertControl';

interface CandleChartProps {
    symbol: string; // e.g., 'BTCUSDT'
    type: MarketType;
}

interface KlineData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
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
    const klinesDataRef = useRef<KlineData[]>([]);

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

    const getAlertDirection = (targetPrice: number) => {
        const fallbackPrice = klinesDataRef.current[klinesDataRef.current.length - 1]?.close || 0;
        return inferPriceAlertDirection(targetPrice, currentPrice || fallbackPrice);
    };

    const manualAlertReferencePrice = currentPrice || klinesDataRef.current[klinesDataRef.current.length - 1]?.close || null;

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
            autoscaleInfoProvider: (original: () => any) => {
                const res = original();
                return res;
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

        // Fetch initial historical data
        if (symbol.length < 5) return;
        const klinesUrl = getKlineUrl(symbol, globalInterval, type, 500);
        fetch(klinesUrl)
            .then(res => res.json())
            .then(data => {
                if (!Array.isArray(data)) return;
                const cdata = data.map((d: any) => ({
                    time: d[0] / 1000,
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                    volume: parseFloat(d[5]),
                })).filter(d => !isNaN(d.open) && !isNaN(d.close));

                if (cdata.length > 0 && seriesRef.current) {
                    klinesDataRef.current = cdata;
                    seriesRef.current.setData(cdata as any);

                    // Dynamic Precision adjustment based on first close price
                    const firstPrice = cdata[cdata.length - 1].close;
                    let precision = 2;
                    let minMove = 0.01;

                    if (firstPrice < 0.01) {
                        precision = 8;
                        minMove = 0.00000001;
                    } else if (firstPrice < 0.1) {
                        precision = 6;
                        minMove = 0.000001;
                    } else if (firstPrice < 1) {
                        precision = 4;
                        minMove = 0.0001;
                    } else if (firstPrice < 10) {
                        precision = 3;
                        minMove = 0.001;
                    }

                    seriesRef.current.applyOptions({
                        priceFormat: {
                            type: 'price',
                            precision: precision,
                            minMove: minMove,
                        },
                    });

                    // Compute Indicators on history
                    const closes = cdata.map((d: any) => d.close);
                    const highs = cdata.map((d: any) => d.high);
                    const lows = cdata.map((d: any) => d.low);
                    const typicals = cdata.map((d: any) => (d.high + d.low + d.close) / 3);
                    const volumes = cdata.map((d: any) => d.volume);

                    const ema21 = calculateEMA(closes, 21);
                    const ema50 = calculateEMA(closes, 50);
                    const vwap = calculateVWAP(typicals, volumes);
                    const rsi = calculateRSI(closes, 14);
                    const atr = calculateATR(highs, lows, closes, 14);
                    const macdResult = calculateMACD(closes);
                    const bbResult = calculateBollingerBands(closes);
                    const stochRsiResult = calculateStochRSI(closes);

                    // Compute SMA of ATR (handling nulls)
                    const atrValues = atr.filter(a => a !== null) as number[];
                    const atrSmaRaw = calculateSMA(atrValues, 14);
                    const atrSmaPad = Array(atr.length - atrSmaRaw.length).fill(null);
                    const atrSma = [...atrSmaPad, ...atrSmaRaw];

                    ema21SeriesRef.current?.setData(ema21.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    ema50SeriesRef.current?.setData(ema50.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    vwapSeriesRef.current?.setData(vwap.map((v, i) => ({ time: cdata[i].time, value: v })) as any);
                    rsiSeriesRef.current?.setData(rsi.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    bbUpperSeriesRef.current?.setData(bbResult.upper.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    bbMiddleSeriesRef.current?.setData(bbResult.middle.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    bbLowerSeriesRef.current?.setData(bbResult.lower.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    macdSeriesRef.current?.setData(macdResult.macd.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    macdSignalSeriesRef.current?.setData(macdResult.signal.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);

                    // Set initial ATR + BB width
                    if (atr.length > 0) setLatestAtr(atr[atr.length - 1]);
                    const lastBBWidth = bbResult.width[bbResult.width.length - 1];
                    if (lastBBWidth !== null) setLatestBBWidth(lastBBWidth);

                    const lastMACD = macdResult.macd[macdResult.macd.length - 1];
                    const lastSignal = macdResult.signal[macdResult.signal.length - 1];
                    const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
                    if (lastMACD !== null && lastSignal !== null && lastHist !== null) {
                        setLatestMACD({ macd: lastMACD, signal: lastSignal, histogram: lastHist });
                    }

                    // Push to global store
                    const lastBBUpper = bbResult.upper[bbResult.upper.length - 1];
                    const lastBBMiddle = bbResult.middle[bbResult.middle.length - 1];
                    const lastBBLower = bbResult.lower[bbResult.lower.length - 1];
                    const lastStochK = stochRsiResult.k[stochRsiResult.k.length - 1];
                    const lastStochD = stochRsiResult.d[stochRsiResult.d.length - 1];
                    useTerminalStore.getState().setIndicators(symbol, {
                        ema21: ema21[ema21.length - 1] ?? undefined,
                        ema50: ema50[ema50.length - 1] ?? undefined,
                        vwap: vwap[vwap.length - 1],
                        atr: atr[atr.length - 1] ?? undefined,
                        atrSma: atrSma[atrSma.length - 1] ?? undefined,
                        rsi: rsi[rsi.length - 1] ?? undefined,
                        macd: (lastMACD !== null && lastSignal !== null && lastHist !== null)
                            ? { macd: lastMACD, signal: lastSignal, histogram: lastHist } : undefined,
                        bb: (lastBBUpper !== null && lastBBMiddle !== null && lastBBLower !== null && lastBBWidth !== null)
                            ? { upper: lastBBUpper, middle: lastBBMiddle, lower: lastBBLower, width: lastBBWidth } : undefined,
                        stochRsi: (lastStochK !== null && lastStochD !== null)
                            ? { k: lastStochK, d: lastStochD } : undefined,
                    });
                }
            })
            .catch(err => console.error("Failed to fetch historical klines", err));

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

        const pollInterval = setInterval(() => {
            fetchPriceAlerts();
        }, 3000);

        return () => {
            clearInterval(pollInterval);
            window.removeEventListener('keydown', handleKeyDown);
            chart.unsubscribeClick(handleChartClick);
            chart.remove();
            pocLineRef.current = null;
            vahLineRef.current = null;
            valLineRef.current = null;
        };
    }, [symbol, type, globalInterval]);

    // 2. Real-time updates via WebSocket
    const wsUrl = getWsUrl(symbol, globalInterval, type);
    const lastUpdateTimeRef = useRef<number>(0);
    const THROTTLE_MS = 150; // Update indicators/HUD every 150ms max
    
    const { lastJsonMessage } = useWebSocket(wsUrl);

    useEffect(() => {
        if (lastJsonMessage && seriesRef.current) {
            const data = lastJsonMessage as any;
            if (data.e === 'kline' && data.k) {
                const kline = data.k;
                const updateData = {
                    time: kline.t / 1000,
                    open: parseFloat(kline.o),
                    high: parseFloat(kline.h),
                    low: parseFloat(kline.l),
                    close: parseFloat(kline.c),
                    volume: parseFloat(kline.v),
                };

                if (!isNaN(updateData.open) && !isNaN(updateData.close)) {
                    seriesRef.current.update(updateData as any);

                    const now = Date.now();
                    const shouldUpdateFull = now - lastUpdateTimeRef.current > THROTTLE_MS;

                    // Maintain rolling klines array for indicators
                    const klines = klinesDataRef.current;
                    const existing = klines.findIndex(d => d.time === updateData.time);
                    if (existing >= 0) {
                        klines[existing] = { ...klines[existing], ...updateData };
                    } else {
                        klines.push(updateData);
                        if (klines.length > 500) klines.shift();
                    }

                    if (shouldUpdateFull) {
                        lastUpdateTimeRef.current = now;

                        // Compute Indicators on history
                        const closes = klines.map(d => d.close);
                        const highs = klines.map(d => d.high);
                        const lows = klines.map(d => d.low);
                        const typicals = klines.map(d => (d.high + d.low + d.close) / 3);
                        const volumes = klines.map(d => d.volume);

                        const ema21 = calculateEMA(closes, 21);
                        const ema50 = calculateEMA(closes, 50);
                        const vwap = calculateVWAP(typicals, volumes);
                        const rsi = calculateRSI(closes, 14);
                        const atr = calculateATR(highs, lows, closes, 14);
                        const macdResult = calculateMACD(closes);
                        const bbResult = calculateBollingerBands(closes);
                        const stochRsiResult = calculateStochRSI(closes);

                        const atrValues = atr.filter(a => a !== null) as number[];
                        const atrSmaRaw = calculateSMA(atrValues, 14);
                        const atrSmaPad = Array(atr.length - atrSmaRaw.length).fill(null);
                        const atrSma = [...atrSmaPad, ...atrSmaRaw];

                        const lastIndex = klines.length - 1;
                        const time = updateData.time as any;

                        if (ema21[lastIndex] !== null && ema21SeriesRef.current) ema21SeriesRef.current.update({ time, value: ema21[lastIndex]! });
                        if (ema50[lastIndex] !== null && ema50SeriesRef.current) ema50SeriesRef.current.update({ time, value: ema50[lastIndex]! });
                        if (vwapSeriesRef.current) vwapSeriesRef.current.update({ time, value: vwap[lastIndex] });
                        if (rsi[lastIndex] !== null && rsiSeriesRef.current) rsiSeriesRef.current.update({ time, value: rsi[lastIndex]! });
                        if (atr[lastIndex] !== null) setLatestAtr(atr[lastIndex]);

                        // BB series updates
                        if (bbResult.upper[lastIndex] !== null && bbUpperSeriesRef.current) bbUpperSeriesRef.current.update({ time, value: bbResult.upper[lastIndex]! });
                        if (bbResult.middle[lastIndex] !== null && bbMiddleSeriesRef.current) bbMiddleSeriesRef.current.update({ time, value: bbResult.middle[lastIndex]! });
                        if (bbResult.lower[lastIndex] !== null && bbLowerSeriesRef.current) bbLowerSeriesRef.current.update({ time, value: bbResult.lower[lastIndex]! });
                        if (bbResult.width[lastIndex] !== null) setLatestBBWidth(bbResult.width[lastIndex]);

                        // MACD series updates
                        if (macdResult.macd[lastIndex] !== null && macdSeriesRef.current) macdSeriesRef.current.update({ time, value: macdResult.macd[lastIndex]! });
                        if (macdResult.signal[lastIndex] !== null && macdSignalSeriesRef.current) macdSignalSeriesRef.current.update({ time, value: macdResult.signal[lastIndex]! });
                        const lMACD = macdResult.macd[lastIndex];
                        const lSignal = macdResult.signal[lastIndex];
                        const lHist = macdResult.histogram[lastIndex];
                        if (lMACD !== null && lSignal !== null && lHist !== null) {
                            setLatestMACD({ macd: lMACD, signal: lSignal, histogram: lHist });
                        }

                        // Update global store
                        const lBBUpper = bbResult.upper[lastIndex];
                        const lBBMiddle = bbResult.middle[lastIndex];
                        const lBBLower = bbResult.lower[lastIndex];
                        const lBBWidth = bbResult.width[lastIndex];
                        const lStochK = stochRsiResult.k[lastIndex];
                        const lStochD = stochRsiResult.d[lastIndex];
                        useTerminalStore.getState().setIndicators(symbol, {
                            ema21: ema21[lastIndex] ?? undefined,
                            ema50: ema50[lastIndex] ?? undefined,
                            vwap: vwap[lastIndex],
                            atr: atr[lastIndex] ?? undefined,
                            atrSma: atrSma[lastIndex] ?? undefined,
                            rsi: rsi[lastIndex] ?? undefined,
                            macd: (lMACD !== null && lSignal !== null && lHist !== null)
                                ? { macd: lMACD, signal: lSignal, histogram: lHist } : undefined,
                            bb: (lBBUpper !== null && lBBMiddle !== null && lBBLower !== null && lBBWidth !== null)
                                ? { upper: lBBUpper, middle: lBBMiddle, lower: lBBLower, width: lBBWidth } : undefined,
                            stochRsi: (lStochK !== null && lStochD !== null)
                                ? { k: lStochK, d: lStochD } : undefined,
                        });

                        // Force +/- 5% Y-Axis to match the Heatmap exactly
                        const currentPrice = updateData.close;
                        seriesRef.current.applyOptions({
                            autoscaleInfoProvider: () => ({
                                priceRange: {
                                    minValue: currentPrice * 0.95,
                                    maxValue: currentPrice * 1.05,
                                },
                                margins: { above: 0, below: 0 }
                            })
                        });
                    }
                }
            }
        }
    }, [lastJsonMessage]);

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
                {(latestBBWidth !== null || latestMACD !== null) && (
                    <div className="flex gap-3 bg-[#18042B]/80 px-2 py-1.5 rounded w-fit border border-purple-500/30 mt-1">
                        {latestBBWidth !== null && (
                            <div className="flex flex-col">
                                <span className="text-terminal-muted opacity-70 text-[9px]">BB WIDTH</span>
                                <span className={`font-mono font-bold ${latestBBWidth < 2 ? 'text-yellow-400' : latestBBWidth < 4 ? 'text-terminal-fg' : 'text-terminal-green'}`}>
                                    {latestBBWidth.toFixed(2)}%{latestBBWidth < 2 ? ' SQUEEZE' : ''}
                                </span>
                            </div>
                        )}
                        {latestMACD !== null && (
                            <>
                                {latestBBWidth !== null && <div className="w-px h-full bg-terminal-border/30"></div>}
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
