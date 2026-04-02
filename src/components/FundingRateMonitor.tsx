import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { type MarketType } from '../constants/binance';

// Stable empty-array fallbacks — MUST be module-level constants.
// Inline `?? []` creates a new reference on every render, causing Zustand
// to see a changed selector result and trigger an infinite re-render loop.
const EMPTY_HISTORY: { timestamp: number; value: number }[] = [];

interface FundingRateMonitorProps {
    symbol: string;
    type: MarketType;
}

function formatRate(rate: number): string {
    return (rate * 100).toFixed(4) + '%';
}

function formatCountdown(ms: number): string {
    if (ms <= 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
}

function rateColor(rate: number): string {
    if (rate > 0.0005) return 'text-terminal-red';
    if (rate < -0.0005) return 'text-terminal-green';
    return 'text-terminal-fg';
}

function rateBg(rate: number): string {
    if (rate > 0.0005) return 'bg-terminal-red';
    if (rate < -0.0005) return 'bg-terminal-green';
    return 'bg-terminal-muted';
}

export function FundingRateMonitor({ symbol, type }: FundingRateMonitorProps) {
    const symbolUpper = symbol.toUpperCase();
    const fundingRate = useTerminalStore(s => s.fundingRate[symbolUpper] ?? 0);
    const predictedRate = useTerminalStore(s => s.predictedFundingRate[symbolUpper] ?? 0);
    const nextFundingTime = useTerminalStore(s => s.nextFundingTime[symbolUpper] ?? 0);
    const fundingHistory = useTerminalStore(s => s.fundingHistory[symbolUpper] ?? EMPTY_HISTORY);
    const longShortRatio = useTerminalStore(s => s.longShortRatio[symbolUpper] ?? 1);
    const oiHistory = useTerminalStore(s => s.oiHistory[symbolUpper] ?? EMPTY_HISTORY);

    const countdown = useMemo(() => {
        if (!nextFundingTime) return 0;
        return Math.max(0, nextFundingTime - Date.now());
    }, [nextFundingTime]);

    const last8History = useMemo(() => {
        const bucketSize = 8 * 60 * 60 * 1000;
        const buckets = new Map<number, number>();
        for (const { timestamp, value } of fundingHistory) {
            const bucket = Math.floor(timestamp / bucketSize);
            buckets.set(bucket, value);
        }
        return Array.from(buckets.entries())
            .sort((a, b) => a[0] - b[0])
            .slice(-8)
            .map(([, value]) => value);
    }, [fundingHistory]);

    const cumulative24h = useMemo(() => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        return fundingHistory
            .filter(h => h.timestamp >= cutoff)
            .reduce((sum, h) => sum + h.value, 0);
    }, [fundingHistory]);

    const oiTrend = useMemo(() => {
        if (oiHistory.length < 2) return 0;
        const latest = oiHistory[oiHistory.length - 1].value;
        const oldest = oiHistory[0].value;
        return oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;
    }, [oiHistory]);

    const maxHistBar = useMemo(() => {
        return Math.max(...last8History.map(Math.abs), 0.0001);
    }, [last8History]);

    const longPct = useMemo(() => {
        const total = longShortRatio + 1;
        return (longShortRatio / total) * 100;
    }, [longShortRatio]);

    if (type !== 'futures') {
        return (
            <div className="h-full flex items-center justify-center text-terminal-muted text-xs bg-terminal-surface/20 backdrop-blur-md border border-terminal-border/40 rounded-xl">
                Funding data available for futures only
            </div>
        );
    }

    return (
        <div className="bg-terminal-surface/20 backdrop-blur-md border border-terminal-border/60 rounded-xl p-4 h-full flex flex-col font-mono text-xs overflow-hidden space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-terminal-border/30 pb-2 shrink-0">
                <h3 className="text-terminal-muted uppercase tracking-[0.2em] text-[10px]">Funding Monitor</h3>
                <span className="text-terminal-muted text-[10px]">{symbolUpper}</span>
            </div>

            {/* Current rate + predicted */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30">
                    <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1">Current Rate</div>
                    <div className={`text-lg font-bold leading-none ${rateColor(fundingRate)}`}>
                        {formatRate(fundingRate)}
                    </div>
                    <div className="text-terminal-muted text-[10px] mt-1">per 8h</div>
                </div>
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30">
                    <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1">Predicted Next</div>
                    <div className={`text-lg font-bold leading-none ${rateColor(predictedRate)}`}>
                        {formatRate(predictedRate)}
                    </div>
                    <div className="text-terminal-muted text-[10px] mt-1">
                        in {formatCountdown(countdown)}
                    </div>
                </div>
            </div>

            {/* 24h cumulative + OI trend */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30">
                    <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1">24h Cum. Cost</div>
                    <div className={`font-bold ${rateColor(cumulative24h)}`}>
                        {formatRate(cumulative24h)}
                    </div>
                </div>
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30">
                    <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1">OI Trend (24h)</div>
                    <div className={`font-bold ${oiTrend >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                        {oiTrend >= 0 ? '+' : ''}{oiTrend.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* 8-period funding history bars */}
            {last8History.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1">
                        Funding History (last {last8History.length} periods)
                    </div>
                    <div className="flex items-end gap-0.5 h-8">
                        {last8History.map((rate, i) => {
                            const heightPct = Math.abs(rate) / maxHistBar;
                            const heightPx = Math.max(2, Math.round(heightPct * 28));
                            return (
                                <div
                                    key={i}
                                    className="flex-1 flex flex-col justify-end"
                                    title={formatRate(rate)}
                                >
                                    <div
                                        className={`w-full rounded-sm opacity-80 ${rateBg(rate)}`}
                                        style={{ height: `${heightPx}px` }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex justify-between text-terminal-muted text-[9px] mt-0.5 opacity-60">
                        <span>-48h</span>
                        <span>now</span>
                    </div>
                </div>
            )}

            {/* Long / Short ratio bar */}
            <div>
                <div className="flex justify-between text-terminal-muted text-[10px] mb-1">
                    <span className="uppercase tracking-wide">Long/Short Ratio</span>
                    <span className="text-terminal-fg">{longShortRatio.toFixed(2)}</span>
                </div>
                <div className="h-2 bg-terminal-bg/50 rounded overflow-hidden border border-terminal-border/20">
                    <div
                        className="h-full bg-terminal-green rounded opacity-80"
                        style={{ width: `${longPct.toFixed(1)}%` }}
                    />
                </div>
                <div className="flex justify-between text-[9px] mt-0.5">
                    <span className="text-terminal-green">L {longPct.toFixed(0)}%</span>
                    <span className="text-terminal-red">S {(100 - longPct).toFixed(0)}%</span>
                </div>
            </div>
        </div>
    );
}
