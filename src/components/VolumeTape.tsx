import { useTerminalStore } from '../store/useTerminalStore';
import { format } from 'date-fns';
import { BarChart2 } from 'lucide-react';
import { type MarketType } from '../constants/binance';
import { formatPrice, formatAmount, formatValue } from '../utils/formatters';

interface VolumeTapeProps {
    symbol: string;
    type: MarketType;
}

export function VolumeTape({ symbol, type }: VolumeTapeProps) {
    const trades = useTerminalStore(state => state.recentTrades[symbol]);
    const recentTrades = trades || [];

    const vDelta = useTerminalStore(state => state.volumeDelta[symbol]);
    const delta = vDelta || { buyVolume: 0, sellVolume: 0, delta: 0 };

    const totalVolume = delta.buyVolume + delta.sellVolume;
    const buyPercent = totalVolume > 0 ? (delta.buyVolume / totalVolume) * 100 : 50;

    return (
        <div className="bg-terminal-surface/20 backdrop-blur-md border border-terminal-border/60 rounded-xl p-4 h-full flex flex-col font-mono text-xs overflow-hidden group shadow-sm transition-all duration-300 hover:border-terminal-border relative">
            <h3 className="text-terminal-text/70 uppercase tracking-[0.2em] mb-2 text-[10px] flex items-center gap-2 border-b border-terminal-border/30 pb-2 shrink-0 z-10">
                <BarChart2 size={14} className="text-[#fbbf24]" />
                <span className="text-[#fbbf24] font-bold tracking-widest">Order Flow <span className="opacity-50 ml-1">[{type.toUpperCase()}]</span></span>
            </h3>

            {/* Delta Status */}
            <div className="flex flex-col gap-1 mb-2 shrink-0 z-10">
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
                    <span className="text-terminal-green font-bold text-[10px]">{formatValue(delta.buyVolume)}</span>
                    <div className="text-center">
                        <span className="text-[9px] text-terminal-muted uppercase block">Delta</span>
                        <span className={`font-bold ${delta.delta >= 0 ? 'text-terminal-green glow-text' : 'text-terminal-red glow-red'}`}>
                            {delta.delta > 0 ? '+' : ''}{formatValue(delta.delta)}
                        </span>
                    </div>
                    <span className="text-terminal-red font-bold text-[10px]">{formatValue(delta.sellVolume)}</span>
                </div>
            </div>

            {/* Tape Header */}
            <div className="flex justify-between text-terminal-muted text-[10px] mb-1 uppercase opacity-60 px-2 mt-1 shrink-0 bg-terminal-surface/40 py-1 rounded-md border border-terminal-border/20 shadow-inner z-10">
                <span>Time</span>
                <span>Price</span>
                <span>Size</span>
            </div>

            {/* Tape Stream */}
            <div className="flex-grow overflow-y-auto scrollbar-thin space-y-[2px] z-10">
                {recentTrades.map(trade => {
                    const isBuy = trade.side === 'BUY';
                    return (
                        <div
                            key={trade.id}
                            className={`flex justify-between px-1 items-center hover:bg-white/5 cursor-default ${isBuy ? 'text-terminal-green' : 'text-terminal-red'}`}
                        >
                            <span className="text-[9px] opacity-70">{format(trade.timestamp, 'HH:mm:ss')}</span>
                            <span className="font-bold">{formatPrice(trade.price)}</span>
                            <span>{formatAmount(trade.amount)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
