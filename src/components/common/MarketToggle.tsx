import React from 'react';
import { type MarketType } from '../../constants/binance';
import { Zap, CircleDot } from 'lucide-react';

interface MarketToggleProps {
    activeType: MarketType;
    onChange: (type: MarketType) => void;
    className?: string;
}

export const MarketToggle: React.FC<MarketToggleProps> = ({ activeType, onChange, className = '' }) => {
    return (
        <div className={`flex items-center p-1 rounded-lg bg-terminal-surface/50 border border-terminal-border ${className}`}>
            <button
                onClick={() => onChange('futures')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold transition-all ${
                    activeType === 'futures'
                        ? 'bg-terminal-blue text-white shadow-lg shadow-terminal-blue/20'
                        : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/5'
                }`}
            >
                <Zap size={10} />
                Futures
            </button>
            <button
                onClick={() => onChange('spot')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold transition-all ${
                    activeType === 'spot'
                        ? 'bg-terminal-green text-black shadow-lg shadow-terminal-green/20'
                        : 'text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/5'
                }`}
            >
                <CircleDot size={10} />
                Spot
            </button>
        </div>
    );
};
