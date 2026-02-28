import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

interface LiquidityIntelligenceProps {
    symbol: string;
}

export function LiquidityIntelligence({ symbol }: LiquidityIntelligenceProps) {
    const orderBook = useTerminalStore(state => state.orderBook[symbol]);
    const currentPrice = useTerminalStore(state => state.prices[symbol]) || 0;
    const globalInterval = useTerminalStore(state => state.globalInterval);
    const whaleDelta = useTerminalStore(state => state.whaleDelta[symbol]) || 0;

    // Scale threshold based on timeframe (longer timeframes require bigger walls)
    const getThreshold = (interval: string) => {
        switch (interval) {
            case '1m': case '5m': return 250000;
            case '15m': case '30m': return 500000;
            case '1h': case '4h': return 1000000;
            case '12h': case '1d': return 2500000;
            case '1w': case '1M': return 5000000;
            default: return 500000;
        }
    };

    const WALL_THRESHOLD = getThreshold(globalInterval);

    // Order Book Analysis
    const analytics = useMemo(() => {
        if (!orderBook || !currentPrice) return null;

        const { bids, asks } = orderBook;
        let totalBids = 0, totalAsks = 0;
        let bids1pct = 0, asks1pct = 0;
        let bids5pct = 0, asks5pct = 0;

        let nearestSupport: any = null;
        let nearestResistance: any = null;
        let majorSupportWall: any = null;
        let majorResistanceWall: any = null;

        let pVacuumUp: any = null;
        let pVacuumDown: any = null;

        const maxSupportDist = currentPrice * 0.95; // 5% down
        const maxResDist = currentPrice * 1.05; // 5% up

        bids.forEach(b => {
            totalBids += b.value;
            if (b.price >= currentPrice * 0.99) bids1pct += b.value;
            if (b.price >= maxSupportDist) bids5pct += b.value;

            if (b.value >= WALL_THRESHOLD) {
                if (!nearestSupport) nearestSupport = b;
                if (!majorSupportWall || b.value > majorSupportWall.value) majorSupportWall = b;
            }
        });

        asks.forEach(a => {
            totalAsks += a.value;
            if (a.price <= currentPrice * 1.01) asks1pct += a.value;
            if (a.price <= maxResDist) asks5pct += a.value;

            if (a.value >= WALL_THRESHOLD) {
                if (!nearestResistance) nearestResistance = a;
                if (!majorResistanceWall || a.value > majorResistanceWall.value) majorResistanceWall = a;
            }
        });

        // Vacuum Detection
        const findVacuum = (levels: any[], isAscending: boolean) => {
            if (levels.length < 20) return null;
            let minVolWindow = Infinity;
            let vacuumStart = levels[0].price;
            let vacuumEnd = levels[0].price;

            for (let i = 0; i < levels.length - 10; i++) {
                let windowVol = 0;
                for (let j = 0; j < 10; j++) windowVol += levels[i + j].value;

                if (windowVol < WALL_THRESHOLD * 0.2 && windowVol < minVolWindow) {
                    minVolWindow = windowVol;
                    vacuumStart = levels[i].price;
                    vacuumEnd = levels[i + 9].price;
                }
            }
            if (minVolWindow !== Infinity) {
                return isAscending
                    ? { start: Math.min(vacuumStart, vacuumEnd), end: Math.max(vacuumStart, vacuumEnd) }
                    : { start: Math.max(vacuumStart, vacuumEnd), end: Math.min(vacuumStart, vacuumEnd) };
            }
            return null;
        };

        pVacuumDown = findVacuum(bids, false);
        pVacuumUp = findVacuum(asks, true);

        const total1pct = bids1pct + asks1pct;
        const imbalance1pct = total1pct > 0 ? (bids1pct / total1pct) * 100 : 50;

        const total5pct = bids5pct + asks5pct;
        const skew5pct = total5pct > 0 ? (bids5pct / total5pct) * 100 : 50;

        const classifyWall = (wall: any, side: 'BUY' | 'SELL') => {
            if (!wall) return { type: 'NONE', color: 'text-terminal-muted', dist: 0, price: 0, size: 0 };
            const dist = Math.abs(wall.price - currentPrice) / currentPrice;
            const size = wall.value;
            let type = side === 'BUY' ? 'SUPPORT' : 'RESIST';
            if (size > WALL_THRESHOLD * 3 && dist < 0.01) type = 'MAGNET';
            else if (size > WALL_THRESHOLD * 2 && dist > 0.02) type = 'SPOOF';

            return {
                type,
                color: side === 'BUY' ? 'text-terminal-green' : 'text-terminal-red',
                dist: dist * 100,
                price: wall.price,
                size: wall.value
            };
        };

        const res = classifyWall(majorResistanceWall || nearestResistance || asks[0], 'SELL');
        const sup = classifyWall(majorSupportWall || nearestSupport || bids[0], 'BUY');

        let magnetClass = null;
        if (res.price && sup.price) {
            if (res.size > sup.size * 1.5) magnetClass = { ...res, label: 'UPPER' };
            else if (sup.size > res.size * 1.5) magnetClass = { ...sup, label: 'LOWER' };
            else {
                if (res.dist < sup.dist) magnetClass = { ...res, label: 'UPPER' };
                else magnetClass = { ...sup, label: 'LOWER' };
            }
        }

        return {
            imbalance1pct,
            skew5pct,
            support: sup,
            resistance: res,
            vacuumUp: pVacuumUp,
            vacuumDown: pVacuumDown,
            magnet: magnetClass
        };
    }, [orderBook, currentPrice]);

    return (
        <div className="flex flex-col h-full w-full font-mono bg-[#18042B]/80 text-[11px] leading-tight flex-grow overflow-hidden p-3 border border-purple-500/20 rounded shadow-[0_0_15px_rgba(168,85,247,0.1)] gap-2">
            <h2 className="text-[12px] uppercase text-purple-400 font-bold tracking-widest border-b border-purple-500/30 pb-2 flex justify-between items-center shrink-0">
                <span>Liquidity Intelligence</span>
                <span className="text-[9px] text-terminal-muted">{globalInterval} SYNC</span>
            </h2>

            {/* Imbalance & Skew Panels */}
            <div className="flex flex-col gap-1.5 shrink-0">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] uppercase font-bold text-terminal-muted tracking-wide">1% Range Imbalance</span>
                    <span className={(analytics?.imbalance1pct || 50) > 50 ? 'text-terminal-green text-[10px]' : 'text-terminal-red text-[10px]'}>
                        {(analytics?.imbalance1pct || 50) > 50 ? 'BULLISH' : 'BEARISH'}
                    </span>
                </div>
                {/* 1% Imbalance Meter Bar */}
                <div className="w-full h-1.5 bg-terminal-border/50 rounded overflow-hidden flex relative">
                    <div className="h-full bg-terminal-green transition-all" style={{ width: `${analytics?.imbalance1pct || 50}%` }} />
                    <div className="h-full bg-terminal-red transition-all" style={{ width: `${100 - (analytics?.imbalance1pct || 50)}%` }} />
                    <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-black/50 z-10" />
                </div>

                <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] uppercase font-bold text-terminal-muted tracking-wide">5% Density Skew</span>
                    <span className={(analytics?.skew5pct || 50) > 50 ? 'text-terminal-green text-[10px]' : 'text-terminal-red text-[10px]'}>
                        {(analytics?.skew5pct || 50) > 50 ? 'BID HEAVY' : 'ASK HEAVY'}
                    </span>
                </div>
                {/* 5% Skew Meter Bar */}
                <div className="w-full h-1.5 bg-terminal-border/50 rounded overflow-hidden flex relative">
                    <div className="h-full bg-terminal-green transition-all" style={{ width: `${analytics?.skew5pct || 50}%` }} />
                    <div className="h-full bg-terminal-red transition-all" style={{ width: `${100 - (analytics?.skew5pct || 50)}%` }} />
                    <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-black/50 z-10" />
                </div>
            </div>

            {/* Net Whale Flow */}
            <div className="flex items-center justify-between pt-2 border-t border-purple-500/10 shrink-0">
                <span className="text-[10px] uppercase font-bold text-terminal-muted tracking-wide">Whale Flow</span>
                <div className={`font-bold font-mono ${whaleDelta > 0 ? 'text-terminal-green glow-text' : whaleDelta < 0 ? 'text-terminal-red glow-red' : 'text-terminal-fg'}`}>
                    {whaleDelta > 0 ? '+' : ''}${(whaleDelta / 1000000).toFixed(2)}M
                </div>
            </div>

            {/* Scrollable Intelligence Details */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-purple-500/10 flex-grow justify-start overflow-y-auto scrollbar-thin">

                {/* Main Magnet */}
                <div className="flex justify-between items-center bg-[#fbbf24]/10 p-1.5 rounded border-l-2 border-[#fbbf24]">
                    <span className="text-[#fbbf24] font-bold text-[10px]">L2 MAGNET ({analytics?.magnet?.label || 'NONE'})</span>
                    <div className="flex flex-col items-end">
                        <span className={`${analytics?.magnet?.color || 'text-terminal-muted'} font-bold`}>{(analytics?.magnet?.price || 0).toFixed(1)}</span>
                        <span className="text-[9px] opacity-70">dist: {(analytics?.magnet?.dist || 0).toFixed(2)}% | ${((analytics?.magnet?.size || 0) / 1000000).toFixed(1)}M</span>
                    </div>
                </div>

                {/* Major Walls */}
                <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="bg-black/30 p-1.5 rounded flex flex-col gap-0.5 border-t-2 border-[#ff3333]">
                        <span className="text-terminal-muted text-[9px]">Major Resistance</span>
                        <span className={`${analytics?.resistance?.color} font-bold`}>{(analytics?.resistance?.price || 0).toFixed(1)}</span>
                        <span className="text-[9px] text-[#ff3333]">dist: +{(analytics?.resistance?.dist || 0).toFixed(2)}%<br />size: ${((analytics?.resistance?.size || 0) / 1000000).toFixed(1)}M</span>
                    </div>
                    <div className="bg-black/30 p-1.5 rounded flex flex-col gap-0.5 border-t-2 border-[#00cc33]">
                        <span className="text-terminal-muted text-[9px]">Major Support</span>
                        <span className={`${analytics?.support?.color} font-bold`}>{(analytics?.support?.price || 0).toFixed(1)}</span>
                        <span className="text-[9px] text-[#00cc33]">dist: -{(analytics?.support?.dist || 0).toFixed(2)}%<br />size: ${((analytics?.support?.size || 0) / 1000000).toFixed(1)}M</span>
                    </div>
                </div>

                {/* Vacuums */}
                <div className="flex justify-between items-center bg-black/30 p-1.5 rounded mt-1">
                    <span className="text-terminal-muted">Vacuum Up:</span>
                    {analytics?.vacuumUp ? (
                        <span className="text-white/80 font-bold">{analytics.vacuumUp.start.toFixed(0)} - {analytics.vacuumUp.end.toFixed(0)}</span>
                    ) : <span className="text-terminal-muted italic">Detecting...</span>}
                </div>
                <div className="flex justify-between items-center bg-black/30 p-1.5 rounded">
                    <span className="text-terminal-muted">Vacuum Down:</span>
                    {analytics?.vacuumDown ? (
                        <span className="text-white/80 font-bold">{analytics.vacuumDown.start.toFixed(0)} - {analytics.vacuumDown.end.toFixed(0)}</span>
                    ) : <span className="text-terminal-muted italic">Detecting...</span>}
                </div>
            </div>

        </div>
    );
}
