import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { Target, TrendingUp, Activity, Zap, AlertTriangle } from 'lucide-react';

interface MarketContextProps {
    symbol: string;
}

export function MarketContext({ symbol }: MarketContextProps) {
    const prices = useTerminalStore(state => state.prices);
    const ema21 = useTerminalStore(state => state.currentEMA21[symbol]);
    const ema50 = useTerminalStore(state => state.currentEMA50[symbol]);
    const vwap = useTerminalStore(state => state.currentVWAP[symbol]);
    const atr = useTerminalStore(state => state.currentATR[symbol]);
    const atrSma = useTerminalStore(state => state.currentAtrSma[symbol]);
    const rsi = useTerminalStore(state => state.currentRSI[symbol]);

    const sessionPoc = useTerminalStore(state => state.sessionPoc[symbol]);
    const recentTrades = useTerminalStore(state => state.recentTrades[symbol]);

    const oiHistory = useTerminalStore(state => state.oiHistory[symbol]);
    const fundingRate = useTerminalStore(state => state.fundingRate[symbol]);
    const orderBook = useTerminalStore(state => state.orderBook[symbol]);

    const bidWalls = useTerminalStore(state => state.bidWalls[symbol]) || [];
    const askWalls = useTerminalStore(state => state.askWalls[symbol]) || [];

    const price = prices[symbol];

    // 1. Session Awareness
    const sessionInfo = useMemo(() => {
        const utcHour = new Date().getUTCHours();
        const utcMin = new Date().getUTCMinutes();
        const time = utcHour + utcMin / 60;

        let active = [];
        if (time >= 0 && time < 9) active.push('Asia');
        if (time >= 8 && time < 16) active.push('London');
        if (time >= 13.5 && time < 20) active.push('US');

        let overlap = active.length > 1;
        return {
            names: active.length > 0 ? active.join(' / ') : 'After Hours',
            overlap
        };
    }, []);

    // 2. Regime Classification
    const regime = useMemo(() => {
        if (!price || !ema21 || !ema50) return { type: 'Unknown', strength: 'Neutral', text: 'Gathering Data...', color: 'text-terminal-muted' };

        // Price vs EMAs
        const pUp = price > ema21 && ema21 > ema50;
        const pDown = price < ema21 && ema21 < ema50;

        // Separation Magnitude 
        const separationPct = Math.abs((ema21 - ema50) / ema50) * 100;
        const isStrong = separationPct > 0.15; // 0.15% separation

        if (pUp) return { type: 'Uptrend', strength: isStrong ? 'Strong' : 'Weak', text: `Trending Up (${isStrong ? 'Strong' : 'Weak'})`, color: 'text-terminal-green' };
        if (pDown) return { type: 'Downtrend', strength: isStrong ? 'Strong' : 'Weak', text: `Trending Down (${isStrong ? 'Strong' : 'Weak'})`, color: 'text-terminal-red' };

        return { type: 'Range', strength: 'Neutral', text: 'Range Bound / Chop', color: 'text-terminal-muted' };
    }, [price, ema21, ema50]);

    // 3. Relative Volatility
    const volatility = useMemo(() => {
        if (!atr || !atrSma) return { state: 'Normal', risk: 'Low', ratio: 1, color: 'text-terminal-fg' };

        const ratio = atr / atrSma;
        if (ratio < 0.75) return { state: 'Compacting/Squeeze', risk: 'High', ratio, color: 'text-yellow-500' };
        if (ratio > 1.25) return { state: 'Expansion', risk: 'Medium', ratio, color: 'text-terminal-green' };
        return { state: 'Normal', risk: 'Low', ratio, color: 'text-terminal-fg' };
    }, [atr, atrSma]);

    // 4. Derivatives Interpretation
    const derivatives = useMemo(() => {
        if (!oiHistory || oiHistory.length < 2 || !price) return { text: 'Gathering flow data...', color: 'text-terminal-muted', oiChangePct: 0, significant: false };

        // Check last 15 min if possible, else whatever we have
        const now = Date.now();
        const recent = oiHistory.filter(h => now - h.timestamp <= 15 * 60 * 1000);
        if (recent.length < 2) return { text: 'Flow stable', color: 'text-terminal-muted', oiChangePct: 0, significant: false };

        const oldest = recent[0];
        const newest = recent[recent.length - 1];

        const oiChangePct = ((newest.value - oldest.value) / oldest.value) * 100;
        const priceDir = ema21 && price > ema21 ? 1 : -1;

        let text = 'Mixed Flow';
        let color = 'text-terminal-muted';

        const significant = Math.abs(oiChangePct) > 0.5; // 0.5% OI change in 15m is significant
        if (significant) {
            if (oiChangePct > 0 && priceDir > 0) { text = 'Active Long Building'; color = 'text-terminal-green'; }
            else if (oiChangePct > 0 && priceDir < 0) { text = 'Active Short Building'; color = 'text-terminal-red'; }
            else if (oiChangePct < 0 && priceDir > 0) { text = 'Short Covering Rally'; color = 'text-yellow-500'; }
            else if (oiChangePct < 0 && priceDir < 0) { text = 'Long Liquidations'; color = 'text-red-500'; }
        } else {
            text = 'No Major Flow Change';
        }

        return { text, oiChangePct, significant, color };
    }, [oiHistory, price, ema21]);

    // 5. Execution Intelligence
    const execution = useMemo(() => {
        if (!orderBook || !orderBook.bids[0] || !orderBook.asks[0] || !price) return null;

        const spreadRaw = orderBook.asks[0].price - orderBook.bids[0].price;
        const spreadPct = (spreadRaw / price) * 100;

        let spreadQuality = 'Good';
        if (spreadPct > 0.05) spreadQuality = 'Poor (Wide)';
        else if (spreadPct < 0.01) spreadQuality = 'Tight';

        // Distance to Nearest Wall
        const distBid = bidWalls.length > 0 ? ((price - bidWalls[0].price) / price * 100).toFixed(2) : '-';
        const distAsk = askWalls.length > 0 ? ((askWalls[0].price - price) / price * 100).toFixed(2) : '-';

        return { spreadPct, spreadQuality, distBid, distAsk };
    }, [orderBook, bidWalls, askWalls, price]);

    // 6. Level Interaction Status
    const levelInteraction = useMemo(() => {
        if (!price) return { text: 'Scanning Levels...', color: 'text-terminal-muted' };

        // Determine recent micro-trend using last 50 trades or EMA21 fallback
        let microTrend = 'flat';
        if (recentTrades && recentTrades.length > 0) {
            const oldest = recentTrades[recentTrades.length - 1].price;
            if (price > oldest * 1.0001) microTrend = 'up';
            else if (price < oldest * 0.9999) microTrend = 'down';
        } else {
            microTrend = ema21 && price > ema21 ? 'up' : 'down';
        }

        const checkLevel = (level: number, name: string) => {
            if (!level) return null;
            const distToLevel = (price - level) / level * 100;
            const absDist = Math.abs(distToLevel);

            // Testing Limit (Within 0.05%)
            if (absDist <= 0.05) {
                if (name === 'POC') return { text: `Consolidating at POC`, color: 'text-yellow-500' };
                return { text: `Testing ${name}`, color: 'text-yellow-500' };
            }

            // Approaching / Rejecting Limit (Within 0.2%)
            if (absDist <= 0.2) {
                if (level > price && microTrend === 'up') return { text: `Approaching ${name}`, color: 'text-terminal-fg' };
                if (level < price && microTrend === 'down') return { text: `Approaching ${name}`, color: 'text-terminal-fg' };

                if (level > price && microTrend === 'down') return { text: `Rejecting ${name}`, color: 'text-terminal-red' };
                if (level < price && microTrend === 'up') return { text: `Rejecting ${name}`, color: 'text-terminal-green' };
            }

            return null;
        }

        const levels = [];
        if (askWalls.length > 0) levels.push({ price: askWalls[0].price, name: 'Major Resistance', isSup: false });
        if (bidWalls.length > 0) levels.push({ price: bidWalls[0].price, name: 'Major Support', isSup: true });
        if (sessionPoc) levels.push({ price: sessionPoc, name: 'POC', isSup: price > sessionPoc });
        if (vwap) levels.push({ price: vwap, name: 'VWAP', isSup: price > vwap });

        let nearestDist = Infinity;
        let activeStatus = null;

        for (const lvl of levels) {
            const absDist = Math.abs(price - lvl.price) / lvl.price * 100;
            const status = checkLevel(lvl.price, lvl.name);
            if (status && absDist < nearestDist) {
                nearestDist = absDist;
                activeStatus = status;
            }
        }

        // Check for "Breaking" condition outside the proximity filter
        // e.g. Price just crossed VWAP heavily -> Breaking VWAP
        if (!activeStatus) {
            for (const lvl of levels) {
                const dist = (price - lvl.price) / lvl.price * 100;
                // If it crossed up through resistance/VWAP just recently
                if (dist > 0 && dist < 0.1 && !lvl.isSup && microTrend === 'up') return { text: `Breaking ${lvl.name}`, color: 'text-terminal-green' };
                // If it crossed down through support/VWAP just recently
                if (dist < 0 && dist > -0.1 && lvl.isSup && microTrend === 'down') return { text: `Breaking ${lvl.name}`, color: 'text-terminal-red' };
            }
        }

        return activeStatus || { text: 'In Vacuum (No Immediate Levels)', color: 'text-terminal-muted' };

    }, [price, sessionPoc, askWalls, bidWalls, vwap, ema21, recentTrades]);

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
