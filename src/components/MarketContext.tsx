import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { Target, TrendingUp, Activity, Zap, AlertTriangle } from 'lucide-react';
import { calculateMarketContext } from '../lib/marketContextEngine';

interface MarketContextProps {
    symbol: string;
}

export function MarketContext({ symbol }: MarketContextProps) {
    const ema21 = useTerminalStore(state => state.currentEMA21[symbol]);
    const ema50 = useTerminalStore(state => state.currentEMA50[symbol]);
    const fundingRate = useTerminalStore(state => state.fundingRate[symbol]);

    const {
        price,
        rsi,
        regime,
        volatility,
        derivatives,
        execution,
        levelInteraction
    } = calculateMarketContext(symbol);

    // 1. Session Awareness (UI specific)
    const sessionInfo = useMemo(() => {
        const utcHour = new Date().getUTCHours();
        const utcMin = new Date().getUTCMinutes();
        const time = utcHour + utcMin / 60;

        const active = [];
        if (time >= 0 && time < 9) active.push('Asia');
        if (time >= 8 && time < 16) active.push('London');
        if (time >= 13.5 && time < 20) active.push('US');

        const overlap = active.length > 1;
        return {
            names: active.length > 0 ? active.join(' / ') : 'After Hours',
            overlap
        };
    }, []);

    // Summary Headline
    const headline = useMemo(() => {
        let r = regime.type;
        if (volatility.state.includes('Squeeze')) r += ' \u2192 Breakout Risk Rising';
        else if (volatility.state === 'Expansion') r += ' \u2192 Volatility Expanding';
        else if (derivatives.significant) r += ` \u2192 ${derivatives.text}`;
        return r;
    }, [regime, volatility, derivatives]);

    if (!price) {
        return <div className="h-full flex items-center justify-center text-terminal-muted text-xs bg-[#0a0510] border border-terminal-border/30 rounded-lg">Waiting for Context...</div>;
    }

    return (
        <div className="flex flex-col h-full bg-[#0a0510] text-terminal-fg p-3 rounded-lg border border-terminal-border/30 shadow-lg font-sans overflow-hidden">
            <div className="flex items-center justify-between mb-3 border-b border-terminal-border/30 pb-2">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#E040FB]" />
                    <h2 className="text-sm font-bold tracking-wider text-[#e6e6e6]">Market Context & Decision Support</h2>
                </div>
                <div className={`text-xs font-bold px-2 py-0.5 rounded ${sessionInfo.overlap ? 'bg-terminal-hl/20 text-terminal-fg border border-terminal-hl' : 'bg-black/30 text-terminal-muted'}`}>
                    {sessionInfo.names} Session
                </div>
            </div>

            {/* Headline */}
            <div className="mb-4">
                <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Summary
                </div>
                <div className="text-sm font-bold text-white bg-[#1a1025] px-3 py-2 rounded border border-purple-500/20 shadow-inner">
                    {headline}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-1 flex-grow overflow-y-auto pr-1 custom-scrollbar">
                {/* Regime Panel */}
                <div className="bg-[#12081a] p-2.5 rounded border border-terminal-border/20 flex flex-col justify-between">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> Regime & Bias
                        </div>
                        <div className={`text-sm font-bold ${regime.color}`}>{regime.text}</div>
                    </div>
                    <div className="text-xs text-terminal-muted mt-2 flex justify-between border-t border-terminal-border/10 pt-1">
                        <span>RSI: {rsi?.toFixed(1) || '-'}</span>
                        <span>EMA Sep: {ema50 && ema21 ? Math.abs((ema21 - ema50) / ema50 * 100).toFixed(2) : '-'}%</span>
                    </div>
                </div>

                {/* Volatility Panel */}
                <div className="bg-[#12081a] p-2.5 rounded border border-terminal-border/20 flex flex-col justify-between">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Volatility
                        </div>
                        <div className={`text-sm font-bold ${volatility.color}`}>{volatility.state}</div>
                    </div>
                    <div className="text-xs text-terminal-muted mt-2 flex justify-between border-t border-terminal-border/10 pt-1">
                        <span>ATR/SMA: {volatility.ratio ? volatility.ratio.toFixed(2) + 'x' : '-'}</span>
                        <span className={volatility.risk === 'High' ? 'text-yellow-500 font-bold' : ''}>Risk: {volatility.risk}</span>
                    </div>
                </div>

                {/* Derivatives Panel */}
                <div className="bg-[#12081a] p-2.5 rounded border border-terminal-border/20 flex flex-col justify-between">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <Activity className="w-3 h-3" /> Positioning Synthesis
                        </div>
                        <div className={`text-sm font-bold ${derivatives.color}`}>{derivatives.text}</div>
                    </div>
                    <div className="text-xs text-terminal-muted mt-2 flex justify-between border-t border-terminal-border/10 pt-1">
                        <span>OI 15m: {derivatives.oiChangePct ? (derivatives.oiChangePct > 0 ? '+' : '') + derivatives.oiChangePct.toFixed(2) + '%' : '-'}</span>
                        <span className={fundingRate && fundingRate > 0 ? 'text-terminal-green' : fundingRate && fundingRate < 0 ? 'text-terminal-red' : ''}>
                            Fund: {fundingRate ? (fundingRate * 100).toFixed(4) + '%' : '-'}
                        </span>
                    </div>
                </div>

                {/* Execution Panel */}
                <div className="bg-[#12081a] p-2.5 rounded border border-terminal-border/20 flex flex-col justify-between">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <Target className="w-3 h-3" /> Execution Context
                        </div>
                        <div className="text-sm font-bold">
                            Spread: <span className={execution?.spreadQuality === 'Tight' ? 'text-terminal-green' : execution?.spreadQuality.includes('Poor') ? 'text-terminal-red' : 'text-terminal-fg'}>{execution?.spreadQuality || '-'}</span>
                        </div>
                    </div>
                    <div className="text-xs text-terminal-muted mt-2 flex justify-between border-t border-terminal-border/10 pt-1">
                        <span className="text-terminal-red">Res: +{execution?.distAsk || '-'}%</span>
                        <span className="text-terminal-green">Sup: -{execution?.distBid || '-'}%</span>
                    </div>
                </div>

                {/* Level Interaction Panel */}
                <div className="bg-[#12081a] p-2.5 rounded border border-terminal-border/20 flex flex-col justify-between col-span-2">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <Target className="w-3 h-3 text-[#E040FB]" /> Level Interaction Status
                        </div>
                        <div className={`text-sm font-bold ${levelInteraction.color}`}>{levelInteraction.text}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
