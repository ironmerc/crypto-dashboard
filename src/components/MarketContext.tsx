import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { Target, TrendingUp, Activity, Zap, AlertTriangle } from 'lucide-react';
import { calculateMarketContextFromState, type MarketContextStateSlice } from '../lib/marketContextEngine';

import { type MarketType } from '../constants/binance';

interface MarketContextProps {
    symbol: string;
    type: MarketType;
}

export function MarketContext({ symbol, type }: MarketContextProps) {
    const price = useTerminalStore(state => state.prices[symbol]);
    const ema21 = useTerminalStore(state => state.currentEMA21[symbol]);
    const ema50 = useTerminalStore(state => state.currentEMA50[symbol]);
    const vwap = useTerminalStore(state => state.currentVWAP[symbol]);
    const atr = useTerminalStore(state => state.currentATR[symbol]);
    const atrSma = useTerminalStore(state => state.currentAtrSma[symbol]);
    const oiHistory = useTerminalStore(state => state.oiHistory[symbol]);
    const orderBook = useTerminalStore(state => state.orderBook[symbol]);
    const sessionPoc = useTerminalStore(state => state.sessionPoc[symbol]);
    const sessionVah = useTerminalStore(state => state.sessionVah[symbol]);
    const sessionVal = useTerminalStore(state => state.sessionVal[symbol]);
    const recentTrades = useTerminalStore(state => state.recentTrades[symbol]);
    const rsi = useTerminalStore(state => state.currentRSI[symbol]);
    const macd = useTerminalStore(state => state.currentMACD[symbol]);
    const bb = useTerminalStore(state => state.currentBB[symbol]);
    const stochRsi = useTerminalStore(state => state.currentStochRSI[symbol]);
    const fundingRate = useTerminalStore(state => state.fundingRate[symbol]);

    const marketContextState = useMemo<MarketContextStateSlice>(() => ({
        prices: { [symbol]: price },
        currentEMA21: { [symbol]: ema21 },
        currentEMA50: { [symbol]: ema50 },
        currentVWAP: { [symbol]: vwap },
        currentATR: { [symbol]: atr },
        currentAtrSma: { [symbol]: atrSma },
        oiHistory: { [symbol]: oiHistory },
        orderBook: { [symbol]: orderBook },
        sessionPoc: { [symbol]: sessionPoc },
        sessionVah: { [symbol]: sessionVah },
        sessionVal: { [symbol]: sessionVal },
        recentTrades: { [symbol]: recentTrades },
        currentRSI: { [symbol]: rsi },
        currentMACD: { [symbol]: macd },
        currentBB: { [symbol]: bb },
        currentStochRSI: { [symbol]: stochRsi },
    }), [symbol, price, ema21, ema50, vwap, atr, atrSma, oiHistory, orderBook, sessionPoc, sessionVah, sessionVal, recentTrades, rsi, macd, bb, stochRsi]);

    const {
        regime,
        volatility,
        derivatives,
        execution,
        levelInteraction,
        momentum
    } = useMemo(() => calculateMarketContextFromState(marketContextState, symbol), [marketContextState, symbol]);

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
        return <div className="h-full flex items-center justify-center text-terminal-muted text-xs bg-terminal-surface/20 backdrop-blur-md border border-terminal-border/40 rounded-xl">Waiting for Context...</div>;
    }

    return (
        <div className="bg-terminal-surface/20 backdrop-blur-md border border-terminal-border/60 rounded-xl p-4 h-full flex flex-col font-mono text-xs overflow-hidden group shadow-sm transition-all duration-300 hover:border-terminal-border relative">
            <h3 className="text-terminal-text/70 uppercase tracking-[0.2em] mb-2 text-[10px] flex items-center gap-2 border-b border-terminal-border/30 pb-2 shrink-0 z-10">
                <Target size={14} className="text-[#fbbf24]" />
                <span className="text-[#fbbf24] font-bold tracking-widest">Market DNA <span className="opacity-50 ml-1">[{type.toUpperCase()}]</span></span>
            </h3>
            <div className="flex items-center justify-between mb-3 border-b border-terminal-border/40 pb-2">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-accent-primary" />
                    <h2 className="text-sm font-bold tracking-wider text-terminal-fg">Market Context & Decision Support</h2>
                </div>
                <div className={`text-xs font-bold px-2 py-0.5 rounded-md ${sessionInfo.overlap ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30' : 'bg-terminal-surface/40 text-terminal-muted border border-terminal-border/20'}`}>
                    {sessionInfo.names} Session
                </div>
            </div>

            {/* Headline */}
            <div className="mb-4">
                <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                    <Zap className="w-3 h-3 text-accent-primary" /> Summary
                </div>
                <div className="text-sm font-bold text-white bg-terminal-surface/40 px-3 py-2 rounded-lg border border-terminal-border/40 shadow-inner">
                    {headline}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-1 flex-grow overflow-y-auto pr-1 scrollbar-thin">
                {/* Regime Panel */}
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30 flex flex-col justify-between hover:bg-terminal-bg/40 transition-colors">
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
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30 flex flex-col justify-between hover:bg-terminal-bg/40 transition-colors">
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
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30 flex flex-col justify-between hover:bg-terminal-bg/40 transition-colors">
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
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30 flex flex-col justify-between hover:bg-terminal-bg/40 transition-colors">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <Target className="w-3 h-3" /> Execution Context
                        </div>
                        <div className="text-sm font-bold">
                            Spread: <span className={execution?.spreadQuality === 'Tight' ? 'text-terminal-green' : execution?.spreadQuality.includes('Poor') ? 'text-terminal-red' : 'text-terminal-fg'}>{execution?.spreadQuality || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Level Interaction Panel */}
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30 flex flex-col justify-between col-span-2 hover:bg-terminal-bg/40 transition-colors">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <Target className="w-3 h-3 text-accent-primary" /> Level Interaction Status
                        </div>
                        <div className={`text-sm font-bold ${levelInteraction.color}`}>{levelInteraction.text}</div>
                    </div>
                </div>

                {/* Momentum Panel */}
                <div className="bg-terminal-bg/30 p-2.5 rounded-lg border border-terminal-border/30 flex flex-col justify-between col-span-2 hover:bg-terminal-bg/40 transition-colors">
                    <div>
                        <div className="text-[10px] uppercase text-terminal-muted tracking-wide mb-1 flex items-center gap-1">
                            <Zap className="w-3 h-3 text-[#26a69a]" /> Momentum Signals
                        </div>
                        <div className={`text-sm font-bold ${momentum.color}`}>{momentum.text}</div>
                    </div>
                    <div className="text-xs text-terminal-muted mt-2 flex justify-between border-t border-terminal-border/10 pt-1 flex-wrap gap-x-3">
                        {momentum.macdHistogram !== null && (
                            <span>MACD Hist: <span className={momentum.macdHistogram > 0 ? 'text-terminal-green' : 'text-terminal-red'}>{momentum.macdHistogram.toFixed(4)}</span></span>
                        )}
                        {momentum.stochRsiK !== null && (
                            <span>StochRSI: <span className={momentum.stochState === 'Overbought' ? 'text-terminal-red' : momentum.stochState === 'Oversold' ? 'text-terminal-green' : 'text-terminal-fg'}>{momentum.stochRsiK.toFixed(1)}</span></span>
                        )}
                        {momentum.bbWidth !== null && (
                            <span>BB%: <span className={momentum.bbSqueeze ? 'text-yellow-400 font-bold' : 'text-terminal-fg'}>{momentum.bbWidth.toFixed(2)}{momentum.bbSqueeze ? ' SQUEEZE' : ''}</span></span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
