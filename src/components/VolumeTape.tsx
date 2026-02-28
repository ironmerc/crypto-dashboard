import { useTerminalStore } from '../store/useTerminalStore';
import { format } from 'date-fns';
import { BarChart2 } from 'lucide-react';

interface VolumeTapeProps {
    symbol: string;
}

export function VolumeTape({ symbol }: VolumeTapeProps) {
    const trades = useTerminalStore(state => state.recentTrades[symbol]);
    const recentTrades = trades || [];

    const vDelta = useTerminalStore(state => state.volumeDelta[symbol]);
    const delta = vDelta || { buyVolume: 0, sellVolume: 0, delta: 0 };

    const totalVolume = delta.buyVolume + delta.sellVolume;
    const buyPercent = totalVolume > 0 ? (delta.buyVolume / totalVolume) * 100 : 50;

    return (
        <div className="flex flex-col h-full overflow-hidden font-mono text-[10px]">
            <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest mb-2 flex items-center gap-2 border-b border-terminal-border/30 pb-2 shrink-0">
                <BarChart2 className="w-3 h-3 text-[#ff00ff]" /> Order Flow
            </h2>

            {/* Delta Status */}
            <div className="flex flex-col gap-1 mb-2 shrink-0">
                <div className="flex justify-between text-[9px] text-terminal-muted uppercase">
                    <span>Buy Vol</span>
                    <span>Sell Vol</span>
                </div>
                <div className="w-full h-1.5 bg-terminal-border/50 rounded overflow-hidden flex">
                    <div
                        className="h-full bg-terminal-green transition-all"
                        style={{ width: `${buyPercent}%` }}
                    />
                    <div
                        className="h-full bg-terminal-red transition-all"
                        style={{ width: `${100 - buyPercent}%` }}
                    />
                </div>
                <div className="flex justify-between items-end">
                    <span className="text-terminal-green font-bold text-[10px]">{(delta.buyVolume / 1000).toFixed(1)}k</span>
                    <div className="text-center">
                        <span className="text-[9px] text-terminal-muted uppercase block">Delta</span>
                        <span className={`font-bold ${delta.delta >= 0 ? 'text-terminal-green glow-text' : 'text-terminal-red glow-red'}`}>
                            {delta.delta > 0 ? '+' : ''}{(delta.delta / 1000).toFixed(1)}k
                        </span>
                    </div>
                    <span className="text-terminal-red font-bold text-[10px]">{(delta.sellVolume / 1000).toFixed(1)}k</span>
                </div>
            </div>

            {/* Tape Header */}
            <div className="flex justify-between text-terminal-muted text-[9px] uppercase opacity-50 px-1 mt-1 mb-1 shrink-0 border-b border-terminal-border/10 pb-1">
                <span>Time</span>
                <span>Price</span>
                <span>Size</span>
            </div>

            {/* Tape Stream */}
            <div className="flex-grow overflow-y-auto scrollbar-thin space-y-[2px]">
                {recentTrades.map(trade => {
                    const isBuy = trade.side === 'BUY';
                    return (
                        <div
                            key={trade.id}
                            className={`flex justify-between px-1 items-center hover:bg-white/5 cursor-default ${isBuy ? 'text-terminal-green' : 'text-terminal-red'}`}
                        >
                            <span className="text-[9px] opacity-70">{format(trade.timestamp, 'HH:mm:ss')}</span>
                            <span className="font-bold">{trade.price.toFixed(2)}</span>
                            <span>{trade.amount.toFixed(4)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
