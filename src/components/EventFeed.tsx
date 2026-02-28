import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { format } from 'date-fns';
import { AlertTriangle, Activity, FishSymbol, Zap } from 'lucide-react';

interface EventFeedProps {
    symbol: string;
}

export function EventFeed({ symbol }: EventFeedProps) {
    const allEvents = useTerminalStore(state => state.events);
    const events = useMemo(() => allEvents.filter(e => e.symbol === symbol), [allEvents, symbol]);
    const whaleDeltaMap = useTerminalStore(state => state.whaleDelta);
    const globalInterval = useTerminalStore(state => state.globalInterval);

    // Only calculate Delta for the active symbol
    const totalWhaleDelta = whaleDeltaMap[symbol] || 0;
    const deltaColor = totalWhaleDelta > 0 ? 'text-terminal-green' : totalWhaleDelta < 0 ? 'text-terminal-red' : 'text-terminal-muted';
    const recentWhales = events.filter(e => e.type === 'Whale').slice(0, 10);
    const recentBuys = recentWhales.filter(e => e.side === 'BUY').length;
    const recentSells = recentWhales.filter(e => e.side === 'SELL').length;

    let aggressionTrend = 'NEUTRAL';
    if (recentWhales.length > 2) {
        if (recentBuys > recentSells * 2) aggressionTrend = 'INCREASING (BUY)';
        else if (recentSells > recentBuys * 2) aggressionTrend = 'INCREASING (SELL)';
    }

    const whaleBias = totalWhaleDelta > 5000000 ? 'STRONG BUY' :
        totalWhaleDelta < -5000000 ? 'STRONG SELL' :
            totalWhaleDelta > 0 ? 'BUY-SIDE' :
                totalWhaleDelta < 0 ? 'SELL-SIDE' : 'NEUTRAL';

    return (
        <div className="bg-[#050505] border border-terminal-border/30 rounded p-4 h-full flex flex-col font-mono text-sm leading-tight relative overflow-hidden group">

            {/* Glitch Overlay for aesthetic */}
            <div className="absolute inset-0 bg-scanline pointer-events-none opacity-50 z-10" />

            <h3 className="text-terminal-text/70 uppercase tracking-[0.2em] mb-2 text-xs flex justify-between items-center border-b border-terminal-border/30 pb-2 z-20 shrink-0">
                <div className="flex items-center gap-2">
                    <Activity size={14} className="text-[#fbbf24] animate-pulse" />
                    <span className="text-[#fbbf24] font-bold">Smart Money Feed</span>
                </div>
            </h3>

            {/* Smart Money Context Panel */}
            <div className="flex flex-col gap-1 mb-3 shrink-0 z-20 bg-[#111] p-2 rounded border border-white/5 text-[10px]">
                <div className="flex justify-between">
                    <span className="text-terminal-text/50">Net Flow ({globalInterval}):</span>
                    <span className={`font-bold ${deltaColor}`}>
                        {totalWhaleDelta > 0 ? '+' : ''}{(totalWhaleDelta / 1000000).toFixed(2)}M USD
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-terminal-text/50">Whale Bias:</span>
                    <span className={`font-bold ${deltaColor}`}>{whaleBias}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-terminal-text/50">Aggression Trend:</span>
                    <span className={aggressionTrend.includes('BUY') ? 'text-terminal-green font-bold' : aggressionTrend.includes('SELL') ? 'text-terminal-red font-bold' : 'text-terminal-text/80'}>
                        {aggressionTrend}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin z-20">
                {events.length === 0 && (
                    <div className="text-terminal-text/40 italic flex h-full items-center justify-center text-xs">
                        Awaiting Intel...
                    </div>
                )}

                {events.map(ev => {
                    let isPositive = false; // Green (Aggressive Buy or Short Liq)
                    let displayType: string = ev.type;
                    let displaySide: string = ev.side;

                    // Signal Prioritization
                    let priorityLevel = 'INFO';
                    let IconBadge = ev.type === 'Whale' ? FishSymbol : AlertTriangle;

                    if (ev.type === 'Whale') {
                        isPositive = ev.side === 'BUY';
                        displaySide = isPositive ? 'AGGRESSIVE BUY' : 'AGGRESSIVE SELL';

                        if (ev.value >= 5000000) priorityLevel = 'CRITICAL';
                        else if (ev.value >= 1000000) priorityLevel = 'WARNING';
                    } else if (ev.type === 'Liquidation') {
                        isPositive = ev.side === 'BUY';
                        displaySide = isPositive ? 'LIQ SHORT' : 'LIQ LONG';
                        displayType = 'CASCADE';

                        if (ev.value >= 10000000) priorityLevel = 'CRITICAL';
                        else if (ev.value >= 2000000) priorityLevel = 'WARNING';
                    } else if (ev.type === 'SmartAlert') {
                        isPositive = ev.side === 'BUY' || ev.side === 'LONG';
                        displaySide = ev.title || 'SMART ALERT';
                        displayType = 'SYSTEM';
                        IconBadge = Zap;

                        // Smart alerts are always at least WARNING
                        priorityLevel = ev.title?.includes('SPIKE') || ev.title?.includes('FLUSH') || ev.title?.includes('VOLATILITY') ? 'CRITICAL' : 'WARNING';

                        if (ev.side === 'NEUTRAL') {
                            isPositive = false; // defaults to neutral styling slightly below
                        }
                    }

                    let colorClass = isPositive ? 'text-terminal-green' : 'text-terminal-red';
                    if (ev.type === 'SmartAlert' && ev.side === 'NEUTRAL') {
                        colorClass = 'text-yellow-500';
                    }

                    // Base styling
                    let bgClass = isPositive ? 'bg-terminal-green/5 border-terminal-green/20' : 'bg-terminal-red/5 border-terminal-red/20';
                    if (ev.type === 'SmartAlert' && ev.side === 'NEUTRAL') {
                        bgClass = 'bg-yellow-500/5 border-yellow-500/20';
                    }

                    let highlightGlow = '';
                    let priorityText = '';

                    // Escalate Styling based on Priority
                    if (priorityLevel === 'WARNING') {
                        if (ev.type === 'SmartAlert' && ev.side === 'NEUTRAL') {
                            bgClass = 'bg-yellow-500/20 border-yellow-500/50';
                            highlightGlow = 'shadow-[0_0_8px_rgba(234,179,8,0.2)]';
                        } else {
                            bgClass = isPositive ? 'bg-terminal-green/20 border-terminal-green/50' : 'bg-terminal-red/20 border-terminal-red/50';
                            highlightGlow = isPositive ? 'shadow-[0_0_8px_rgba(0,255,65,0.2)]' : 'shadow-[0_0_8px_rgba(255,51,51,0.2)]';
                        }
                        priorityText = ' ⚠️';
                    } else if (priorityLevel === 'CRITICAL') {
                        if (ev.type === 'SmartAlert' && ev.side === 'NEUTRAL') {
                            bgClass = 'bg-yellow-500/40 border-yellow-500';
                            highlightGlow = 'shadow-[0_0_15px_rgba(234,179,8,0.5)]';
                        } else {
                            bgClass = isPositive ? 'bg-terminal-green/40 border-terminal-green' : 'bg-terminal-red/40 border-terminal-red';
                            highlightGlow = isPositive ? 'shadow-[0_0_15px_rgba(0,255,65,0.5)]' : 'shadow-[0_0_15px_rgba(255,51,51,0.5)]';
                        }
                        priorityText = ' 🔥';
                    }

                    return (
                        <div
                            key={ev.id}
                            className={`p-2 border rounded flex flex-col gap-1 transition-all ${bgClass} ${highlightGlow}`}
                        >
                            <div className="flex justify-between items-center text-[10px] opacity-70">
                                <span>{format(ev.timestamp, 'HH:mm:ss.SSS')}</span>
                                <span className={`font-bold flex items-center gap-1 uppercase tracking-wider ${priorityLevel === 'CRITICAL' ? 'text-white' : ''}`}>
                                    <IconBadge size={12} />
                                    {displayType}{priorityText}
                                </span>
                            </div>
                            <div className="flex justify-between items-end">
                                <div>
                                    <span className={`font-bold ${colorClass} mr-2 text-xs`}>{displaySide}</span>
                                    <span className="text-xs text-white/80">{ev.symbol.replace('USDT', '')}</span>
                                    {ev.message && <div className="text-[10px] text-white/60 mt-1">{ev.message}</div>}
                                </div>
                                <div className="text-right whitespace-nowrap ml-2">
                                    {ev.type === 'SmartAlert' ? (
                                        <div className="text-white font-bold text-sm">ALERT</div>
                                    ) : (
                                        <>
                                            <div className="text-white font-bold text-sm">{(ev.value / 1000).toFixed(1)}k <span className="text-[10px] text-white/50 font-normal">USD</span></div>
                                            <div className="text-[10px] opacity-50">@ {ev.price.toLocaleString()}</div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
