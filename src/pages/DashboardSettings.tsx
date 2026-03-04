import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Search, CircleDot, Settings2, Zap, Loader2 } from 'lucide-react';
import { useTerminalStore } from '../store/useTerminalStore';

const BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1/exchangeInfo';

// Top perpetuals shown when input is empty
const DEFAULT_POPULAR = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'NEARUSDT',
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT',
];

export default function DashboardSettings() {
    const monitoredSymbols = useTerminalStore((s) => s.telegramConfig.monitoredSymbols);
    const addMonitoredSymbol = useTerminalStore((s) => s.addMonitoredSymbol);
    const removeMonitoredSymbol = useTerminalStore((s) => s.removeMonitoredSymbol);

    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState('');
    const [flash, setFlash] = useState<string | null>(null);
    const [allFuturesSymbols, setAllFuturesSymbols] = useState<string[]>([]);
    const [loadingSymbols, setLoadingSymbols] = useState(true);
    const [showDropdown, setShowDropdown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch all Binance Futures USDT-M perpetual symbols on mount
    useEffect(() => {
        fetch(BINANCE_FUTURES_API)
            .then((r) => r.json())
            .then((data) => {
                const symbols: string[] = data.symbols
                    .filter((s: { contractType: string; quoteAsset: string }) =>
                        s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT'
                    )
                    .map((s: { symbol: string }) => s.symbol)
                    .sort();
                setAllFuturesSymbols(symbols);
            })
            .catch(() => setAllFuturesSymbols(DEFAULT_POPULAR))
            .finally(() => setLoadingSymbols(false));
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const basePool = allFuturesSymbols.length ? allFuturesSymbols : DEFAULT_POPULAR;

    const suggestions = inputValue
        ? basePool.filter(
            (s) => s.includes(inputValue.toUpperCase()) && !monitoredSymbols.includes(s)
        ).slice(0, 12)
        : basePool.filter((s) => !monitoredSymbols.includes(s)).slice(0, 20);

    function handleAdd(symbol?: string) {
        const sym = (symbol ?? inputValue).trim().toUpperCase();
        if (!sym) return;
        if (monitoredSymbols.includes(sym)) {
            setError(`${sym} is already monitored.`);
            setShowDropdown(false);
            return;
        }
        if (!/^[A-Z0-9]{3,16}$/.test(sym)) {
            setError('Invalid symbol format. Example: SOLUSDT');
            return;
        }
        addMonitoredSymbol(sym);
        setInputValue('');
        setError('');
        setShowDropdown(false);
        setFlash(sym);
        setTimeout(() => setFlash(null), 1500);
        inputRef.current?.focus();
    }

    function handleRemove(sym: string) {
        if (monitoredSymbols.length <= 1) {
            setError('You must monitor at least one symbol.');
            return;
        }
        removeMonitoredSymbol(sym);
        setError('');
    }

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === 'Enter') handleAdd();
        if (e.key === 'Escape') setShowDropdown(false);
    }

    return (
        <div className="min-h-screen bg-terminal-bg text-terminal-fg font-mono">
            {/* Header */}
            <div className="border-b border-terminal-border px-6 py-4 flex items-center gap-4 bg-terminal-surface">
                <Link
                    to="/"
                    className="flex items-center gap-2 text-terminal-muted hover:text-terminal-fg transition-colors text-sm"
                >
                    <ArrowLeft size={14} />
                    Dashboard
                </Link>
                <span className="text-terminal-border">|</span>
                <div className="flex items-center gap-2">
                    <Settings2 size={14} className="text-terminal-green" />
                    <span className="text-terminal-green font-bold tracking-widest text-sm uppercase">
                        Dashboard Settings
                    </span>
                </div>

                {/* Futures badge */}
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded border border-terminal-blue/40 bg-terminal-blue/5 text-terminal-blue text-[10px] uppercase tracking-widest font-bold">
                    <Zap size={10} />
                    Binance USDT-M Perpetuals
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

                {/* Section: Monitored Assets */}
                <section>
                    <div className="flex items-center gap-2 mb-1">
                        <CircleDot size={13} className="text-terminal-green" />
                        <h2 className="text-terminal-green text-xs font-bold uppercase tracking-widest">
                            Monitored Perpetuals
                        </h2>
                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border border-terminal-border text-terminal-muted">
                            {monitoredSymbols.length} active
                        </span>
                        {loadingSymbols && (
                            <Loader2 size={11} className="ml-1 text-terminal-muted animate-spin" />
                        )}
                    </div>
                    <p className="text-terminal-muted text-xs mb-5">
                        These <span className="text-terminal-blue">USDT-M futures contracts</span> are tracked on the Dashboard Watchlist and drive Telegram alerts via the market engine.
                    </p>

                    {/* Active chips */}
                    <div className="flex flex-wrap gap-2 min-h-[52px] p-3 rounded-lg border border-terminal-border bg-black/30 mb-4">
                        {monitoredSymbols.length === 0 && (
                            <span className="text-terminal-muted text-xs self-center">No assets monitored.</span>
                        )}
                        {monitoredSymbols.map((sym) => (
                            <span
                                key={sym}
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono transition-all duration-300
                  ${flash === sym
                                        ? 'border-terminal-green text-terminal-green bg-terminal-green/10 scale-105 shadow-[0_0_8px_rgba(0,255,65,0.3)]'
                                        : 'border-terminal-border text-terminal-fg hover:border-terminal-muted'
                                    }`}
                            >
                                {sym.replace('USDT', '')}
                                <span className="text-terminal-muted/50 text-[9px]">PERP</span>
                                <button
                                    onClick={() => handleRemove(sym)}
                                    className="text-terminal-muted hover:text-terminal-red transition-colors ml-0.5"
                                    aria-label={`Remove ${sym}`}
                                >
                                    <X size={11} />
                                </button>
                            </span>
                        ))}
                    </div>

                    {/* Add input with dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted pointer-events-none" />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => {
                                        setInputValue(e.target.value);
                                        setError('');
                                        setShowDropdown(true);
                                    }}
                                    onFocus={() => setShowDropdown(true)}
                                    onKeyDown={handleKey}
                                    placeholder="Search perpetual, e.g. SOL → SOLUSDT"
                                    className="w-full bg-terminal-surface border border-terminal-border rounded-lg pl-9 pr-4 py-2 text-sm text-terminal-fg placeholder:text-terminal-muted/40 focus:outline-none focus:border-terminal-green transition-colors"
                                />
                            </div>
                            <button
                                onClick={() => handleAdd()}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-terminal-green text-terminal-green text-sm hover:bg-terminal-green/10 transition-colors active:scale-95"
                            >
                                <Plus size={14} />
                                Add
                            </button>
                        </div>

                        {/* Live dropdown */}
                        {showDropdown && suggestions.length > 0 && (
                            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 border border-terminal-border rounded-lg bg-[#0d0d0d] shadow-2xl overflow-hidden">
                                <div className="px-3 py-1.5 text-[10px] text-terminal-muted uppercase tracking-widest border-b border-terminal-border flex justify-between">
                                    <span>{inputValue ? `Matches for "${inputValue.toUpperCase()}"` : 'Popular Perpetuals'}</span>
                                    <span>{suggestions.length} results</span>
                                </div>
                                <div className="max-h-52 overflow-y-auto">
                                    {suggestions.map((sym) => (
                                        <button
                                            key={sym}
                                            onMouseDown={(e) => { e.preventDefault(); handleAdd(sym); }}
                                            className="w-full text-left px-4 py-2 text-xs flex items-center justify-between hover:bg-terminal-green/5 hover:text-terminal-green transition-colors border-b border-terminal-border/30 last:border-0"
                                        >
                                            <span className="font-bold">{sym.replace('USDT', '')}</span>
                                            <span className="text-terminal-muted text-[10px]">USDT-PERP · Binance Futures</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {error && (
                        <p className="text-terminal-red text-xs mt-2 flex items-center gap-1">
                            <X size={11} /> {error}
                        </p>
                    )}
                </section>

                {/* Placeholder for future settings */}
                <section className="border border-dashed border-terminal-border/40 rounded-lg p-6 text-center">
                    <p className="text-terminal-muted/50 text-xs uppercase tracking-widest">More settings coming soon</p>
                </section>

            </div>
        </div>
    );
}
