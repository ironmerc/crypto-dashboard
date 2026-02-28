// @ts-nocheck
import { useEffect, useRef, useMemo, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import useWebSocket from 'react-use-websocket';
import { useTerminalStore } from '../store/useTerminalStore';
import { calculateEMA, calculateVWAP, calculateRSI, calculateATR, calculateSMA } from '../utils/indicators';

interface CandleChartProps {
    symbol: string; // e.g., 'BTCUSDT'
}

export function CandleChart({ symbol }: CandleChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const pocLineRef = useRef<any>(null);
    const vahLineRef = useRef<any>(null);
    const valLineRef = useRef<any>(null);
    const liqLinesRef = useRef<any[]>([]);

    // Indicator Series Refs
    const ema21SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const klinesDataRef = useRef<any[]>([]);

    // Indicator States for HUD
    const [latestAtr, setLatestAtr] = useState<number | null>(null);

    const fundingRate = useTerminalStore(state => state.fundingRate[symbol]);
    const openInterest = useTerminalStore(state => state.openInterest[symbol]);
    const oiHistory = useTerminalStore(state => state.oiHistory[symbol]);

    const globalInterval = useTerminalStore(state => state.globalInterval);

    const sessionPoc = useTerminalStore(state => state.sessionPoc[symbol]);
    const sessionVah = useTerminalStore(state => state.sessionVah[symbol]);
    const sessionVal = useTerminalStore(state => state.sessionVal[symbol]);
    // Fix infinite loop: Zustand selector must return a stable reference
    const events = useTerminalStore(state => state.events);
    const liquidations = useMemo(() =>
        events.filter(e => e.type === 'Liquidation' && e.symbol === symbol),
        [events, symbol]
    );

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

        // Adjust the main chart margin so it doesn't overlap the RSI
        chart.priceScale('right').applyOptions({
            scaleMargins: {
                top: 0,
                bottom: 0.25, // leaves bottom 25% clear for RSI
            },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#00cc33',
            downColor: '#ff3333',
            borderVisible: false,
            wickUpColor: '#00cc33',
            wickDownColor: '#ff3333',
            autoscaleInfoProvider: (original) => {
                const res = original();
                if (res !== null && res.priceRange !== null) {
                    // Get current price from the last candle close (or you could use store)
                    // But we don't have direct access here without a ref.
                    // Returning null falls back to default.
                }
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

        // Add RSI Pane Layout (Margin configuration to sit below the main chart)
        chart.priceScale('rsi').applyOptions({
            scaleMargins: {
                top: 0.8, // bottom 20%
                bottom: 0,
            },
        });

        chartRef.current = chart;
        seriesRef.current = series;
        ema21SeriesRef.current = ema21Series;
        ema50SeriesRef.current = ema50Series;
        vwapSeriesRef.current = vwapSeries;
        rsiSeriesRef.current = rsiSeries;

        // Fetch initial historical data
        fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${globalInterval}&limit=100`)
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
                    seriesRef.current.setData(cdata);

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

                    // Compute SMA of ATR (handling nulls)
                    const atrValues = atr.filter(a => a !== null) as number[];
                    const atrSmaRaw = calculateSMA(atrValues, 14);
                    // Re-pad the array back to original length
                    const atrSmaPad = Array(atr.length - atrSmaRaw.length).fill(null);
                    const atrSma = [...atrSmaPad, ...atrSmaRaw];

                    ema21SeriesRef.current?.setData(ema21.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    ema50SeriesRef.current?.setData(ema50.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);
                    vwapSeriesRef.current?.setData(vwap.map((v, i) => ({ time: cdata[i].time, value: v })) as any);
                    rsiSeriesRef.current?.setData(rsi.map((v, i) => ({ time: cdata[i].time, value: v })).filter(d => d.value !== null) as any);

                    // Set initial ATR
                    if (atr.length > 0) setLatestAtr(atr[atr.length - 1]);

                    // Push to global store
                    useTerminalStore.getState().setIndicators(symbol, {
                        ema21: ema21[ema21.length - 1] ?? undefined,
                        ema50: ema50[ema50.length - 1] ?? undefined,
                        vwap: vwap[vwap.length - 1],
                        atr: atr[atr.length - 1] ?? undefined,
                        atrSma: atrSma[atrSma.length - 1] ?? undefined,
                        rsi: rsi[rsi.length - 1] ?? undefined,
                    });
                }
            })
            .catch(err => console.error("Failed to fetch historical klines", err));

        return () => {
            chart.remove();
            pocLineRef.current = null;
            vahLineRef.current = null;
            valLineRef.current = null;
            liqLinesRef.current = [];
        };
    }, [symbol, globalInterval]);

    // 2. Real-time updates via WebSocket
    const { lastJsonMessage } = useWebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${globalInterval}`);

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
                    seriesRef.current.update(updateData);

                    // Maintain rolling klines array for indicators
                    const klines = klinesDataRef.current;
                    const existing = klines.findIndex(d => d.time === updateData.time);
                    if (existing >= 0) {
                        klines[existing] = { ...klines[existing], ...updateData };
                    } else {
                        klines.push(updateData);
                        if (klines.length > 200) klines.shift(); // Keep last 200
                    }

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

                    // Update global store
                    useTerminalStore.getState().setIndicators(symbol, {
                        ema21: ema21[lastIndex] ?? undefined,
                        ema50: ema50[lastIndex] ?? undefined,
                        vwap: vwap[lastIndex],
                        atr: atr[lastIndex] ?? undefined,
                        atrSma: atrSma[lastIndex] ?? undefined,
                        rsi: rsi[lastIndex] ?? undefined,
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

    // 4. Draw Liquidation Clusters
    useEffect(() => {
        if (!seriesRef.current) return;

        // Clear old liquidations
        liqLinesRef.current.forEach(line => {
            try { seriesRef.current?.removePriceLine(line); } catch (e) { }
        });
        liqLinesRef.current = [];

        if (liquidations.length === 0) return;

        // Show top 20 largest liquidations to form visual memory "pools" or "clusters"
        const topLiqs = [...liquidations].sort((a, b) => b.value - a.value).slice(0, 20);

        topLiqs.forEach(liq => {
            const isShortLiq = liq.side === 'BUY'; // Short got squeezed (above price) -> green

            const line = seriesRef.current?.createPriceLine({
                price: liq.price,
                color: isShortLiq ? 'rgba(0, 204, 51, 0.8)' : 'rgba(255, 51, 51, 0.8)',
                lineWidth: 2,
                lineStyle: 1, // Solid
                axisLabelVisible: true,
                title: isShortLiq ? '💦 SHORT LIQ' : '💦 LONG LIQ',
            });
            if (line) liqLinesRef.current.push(line);
        });

    }, [liquidations]);

    // For HUD context
    const activeTicker = useTerminalStore(state => state.prices[symbol]);

    return (
        <div className="relative w-full h-full group">
            {/* HUD Overlay */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none flex flex-col gap-1 text-xs drop-shadow-md">
                <div className="flex gap-4 bg-[#18042B]/80 px-2 py-1.5 rounded w-fit border border-purple-500/30">
                    <div className="flex flex-col">
                        <span className="text-terminal-muted opacity-70 text-[9px]">ATR (14)</span>
                        <span className="font-mono text-terminal-fg font-bold">{latestAtr !== null ? `$${latestAtr.toFixed(1)}` : '...'}</span>
                    </div>
                    <div className="w-px h-full bg-terminal-border/30"></div>
                    <div className="flex flex-col">
                        <span className="text-terminal-muted opacity-70 text-[9px]">FUNDING</span>
                        <span className={`font-mono font-bold ${fundingRate && fundingRate > 0 ? 'text-terminal-green' : fundingRate && fundingRate < 0 ? 'text-terminal-red' : 'text-terminal-fg'}`}>
                            {fundingRate ? `${(fundingRate * 100).toFixed(4)}%` : '...'}
                        </span>
                    </div>
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
                </div>
            </div>

            <div ref={chartContainerRef} className="absolute inset-0" />
        </div>
    );
}
