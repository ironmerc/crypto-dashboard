import { useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { BarChart2 } from 'lucide-react';
import { type MarketType } from '../constants/binance';
import { formatPrice, formatAmount } from '../utils/formatters';

interface OrderBookProps {
    symbol: string;
    type: MarketType;
}

export function OrderBook({ symbol, type }: OrderBookProps) {
    const orderBook = useTerminalStore(state => state.orderBook[symbol]);
    const currentPrice = useTerminalStore(state => state.prices[symbol]) || 0;
    const globalInterval = useTerminalStore(state => state.globalInterval);

    // Calculate grouping tick size based on timeframe
    const getTickSize = (interval: string, price: number) => {
        let base = Number((price * 0.0001).toPrecision(1)); // Base ~0.01%
        if (base === 0) base = price < 0.1 ? 0.000001 : 0.01;

        switch (interval) {
            case '1m': return base;
            case '5m': return base * 5;
            case '15m': return base * 10;
            case '30m': return base * 20;
            case '1h': return base * 50;
            case '4h': return base * 100;
            case '12h': return base * 200;
            case '1d': return base * 500;
            case '1w': return base * 1000;
            case '1M': return base * 2000;
            default: return base * 5;
        }
    };

    const tickSize = currentPrice ? getTickSize(globalInterval, currentPrice) : 1;

    // We need deeper data for intelligence
    const allBids = orderBook?.bids || [];
    const allAsks = orderBook?.asks || [];

    // Group levels for display based on Timeframe Tick Size
    const groupLevels = (levels: any[], isAsk: boolean) => {
        if (!levels || levels.length === 0) return [];
        const map = new Map<number, { price: number, amount: number, value: number }>();

        levels.forEach(level => {
            let bucket = Math.floor(level.price / tickSize) * tickSize;
            if (isAsk) {
                bucket = Math.ceil(level.price / tickSize) * tickSize;
            }
            if (!map.has(bucket)) {
                map.set(bucket, { price: bucket, amount: 0, value: 0 });
            }
            const current = map.get(bucket)!;
            current.amount += level.amount;
            current.value += level.value;
        });

        const grouped = Array.from(map.values());
        if (isAsk) {
            grouped.sort((a, b) => a.price - b.price); // Ascending
        } else {
            grouped.sort((a, b) => b.price - a.price); // Descending
        }
        return grouped;
    };

    const groupedBids = useMemo(() => groupLevels(allBids, false), [allBids, tickSize]);
    const groupedAsks = useMemo(() => groupLevels(allAsks, true), [allAsks, tickSize]);

    const bids = groupedBids.slice(0, 20);
    const asks = groupedAsks.slice(0, 20);

    const WALL_THRESHOLD = 500000; // Highlight anything > $500k

    return (
        <div className="bg-terminal-surface/20 backdrop-blur-md border border-terminal-border/60 rounded-xl p-4 h-full flex flex-col font-mono text-[11px] leading-tight flex-grow overflow-hidden group shadow-sm transition-all duration-300 hover:border-terminal-border relative">
            <h3 className="text-terminal-text/70 uppercase tracking-[0.2em] mb-2 text-[10px] flex items-center gap-2 border-b border-terminal-border/30 pb-2 shrink-0 z-10">
                <BarChart2 size={14} className="text-terminal-blue" />
                <span className="text-terminal-blue font-bold tracking-widest">DOM Visualizer <span className="opacity-50 ml-1">[{type.toUpperCase()}]</span></span>
            </h3>

            {/* Book Data */}
            <div className="flex h-full overflow-hidden">
                {/* Bids (Buyers - Support) */}
                <div className="w-1/2 pr-2 overflow-hidden flex flex-col pt-1">
                    <div className="flex justify-between text-terminal-muted text-[10px] mb-1 uppercase opacity-60 px-2 shrink-0 bg-terminal-surface/40 py-1 rounded-md border border-terminal-border/20 shadow-inner">
                        <span>Amount</span>
                        <span className="flex items-center gap-1">Bid <span className="text-[8px] tracking-normal opacity-70">({formatPrice(tickSize)})</span></span>
                    </div>
                    <div className="overflow-y-auto scrollbar-thin flex-grow">
                        {bids.map((bid, i) => {
                            const isWall = bid.value >= WALL_THRESHOLD;
                            return (
                                <div
                                    key={`bid-${i}`}
                                    className={`flex justify-between px-1 hover:bg-[#00cc3322] cursor-default ${isWall ? 'bg-terminal-green/20 font-bold border-l-2 border-terminal-green text-white shadow-[inset_4px_0_10px_rgba(0,204,51,0.2)]' : 'text-terminal-green'
                                        }`}
                                >
                                    <span>{formatAmount(bid.amount)}</span>
                                    <span>{formatPrice(bid.price)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Asks (Sellers - Resistance) */}
                <div className="w-1/2 pl-2 overflow-hidden flex flex-col border-l border-terminal-border/40 pt-1">
                    <div className="flex justify-between text-terminal-muted text-[10px] mb-1 uppercase opacity-60 px-2 shrink-0 bg-terminal-surface/40 py-1 rounded-md border border-terminal-border/20 shadow-inner">
                        <span className="flex items-center gap-1">Ask <span className="text-[8px] tracking-normal opacity-70">({formatPrice(tickSize)})</span></span>
                        <span>Amount</span>
                    </div>
                    <div className="overflow-y-auto scrollbar-thin flex-grow">
                        {asks.map((ask, i) => {
                            const isWall = ask.value >= WALL_THRESHOLD;
                            return (
                                <div
                                    key={`ask-${i}`}
                                    className={`flex justify-between px-1 hover:bg-[#ff333322] cursor-default ${isWall ? 'bg-terminal-red/20 font-bold border-r-2 border-terminal-red text-white shadow-[inset_-4px_0_10px_rgba(255,51,51,0.2)]' : 'text-terminal-red'
                                        }`}
                                >
                                    <span>{formatPrice(ask.price)}</span>
                                    <span>{formatAmount(ask.amount)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
