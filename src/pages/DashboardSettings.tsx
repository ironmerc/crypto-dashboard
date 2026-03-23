import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Search, CircleDot, Settings2, Zap, Loader2 } from 'lucide-react';
import { useTerminalStore } from '../store/useTerminalStore';
import { BINANCE_ENDPOINTS, DEFAULT_POPULAR_SYMBOLS, type MarketType } from '../constants/binance';
import { MarketToggle } from '../components/common/MarketToggle';

export default function DashboardSettings() {
    const monitoredSymbolsStrings = useTerminalStore((s) => s.telegramConfig.monitoredSymbols);
    const monitoredSymbols = monitoredSymbolsStrings.map(s => 
        typeof s === 'string' ? { symbol: s, type: 'futures' as const } : s
    );
    const addMonitoredSymbol = useTerminalStore((s) => s.addMonitoredSymbol);
    const removeMonitoredSymbol = useTerminalStore((s) => s.removeMonitoredSymbol);
    const theme = useTerminalStore((s) => s.theme);
    const setTheme = useTerminalStore((s) => s.setTheme);

    const [marketType, setMarketType] = useState<MarketType>('futures');
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState('');
    const [flash, setFlash] = useState<string | null>(null);
    const [allSymbols, setAllSymbols] = useState<string[]>([]);
    const [loadingSymbols, setLoadingSymbols] = useState(true);
    const [showDropdown, setShowDropdown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch Binance symbols based on marketType
    useEffect(() => {
        setLoadingSymbols(true);
        const endpoint = marketType === 'futures' 
            ? `${BINANCE_ENDPOINTS.FUTURES.REST}/fapi/v1/exchangeInfo`
            : `${BINANCE_ENDPOINTS.SPOT.REST}/api/v3/exchangeInfo`;

        fetch(endpoint)
            .then((r) => r.json())
            .then((data) => {
                const symbols: string[] = data.symbols
                    .filter((s: any) => {
                        if (marketType === 'futures') {
                            return s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT';
                        } else {
                            return s.status === 'TRADING' && s.quoteAsset === 'USDT';
                        }
                    })
                    .map((s: any) => s.symbol)
                    .sort();
                setAllSymbols(symbols);
            })
            .catch(() => setAllSymbols(DEFAULT_POPULAR_SYMBOLS))
            .finally(() => setLoadingSymbols(false));
    }, [marketType]);

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

    const basePool = allSymbols.length ? allSymbols : DEFAULT_POPULAR_SYMBOLS;

    const suggestions = inputValue
        ? basePool.filter(
            (s) => s.includes(inputValue.toUpperCase()) && 
            !monitoredSymbols.some(m => m.symbol === s && m.type === marketType)
        ).slice(0, 12)
        : basePool.filter((s) => 
            !monitoredSymbols.some(m => m.symbol === s && m.type === marketType)
        ).slice(0, 20);

    function handleAdd(symbol?: string) {
        let sym = (symbol ?? inputValue).trim().toUpperCase();
        if (!sym) return;

        // Smart normalization: if user typed 'BTC', make it 'BTCUSDT'
        // Most Binance pairs used in this dashboard are XXXUSDT
        if (!basePool.includes(sym)) {
            const withUsdt = `${sym}USDT`;
            if (basePool.includes(withUsdt)) {
                sym = withUsdt;
            } else {
                // Try to find the first symbol that starts with sym and ends with USDT
                // Use a case-insensitive match just in case, though sym is already upper
                const match = basePool.find(s => s === `${sym}USDT` || s.startsWith(sym) && s.endsWith('USDT'));
                if (match) sym = match;
            }
        }
        
        // Final validation against pool if pool is loaded
        if (allSymbols.length > 0 && !allSymbols.includes(sym)) {
            setError(`Symbol ${sym} not found on Binance ${marketType.toUpperCase()}.`);
            return;
        }
        
        const isDuplicate = monitoredSymbols.some(m => 
            m.symbol === sym && m.type === marketType
        );

        if (isDuplicate) {
            setError(`${sym} is already monitored as ${marketType}.`);
            setShowDropdown(false);
            return;
        }
        
        if (!/^[A-Z0-9]{3,16}$/.test(sym)) {
            setError('Invalid symbol format. Example: SOLUSDT');
            return;
        }
        
        addMonitoredSymbol(sym, marketType);
        setInputValue('');
        setError('');
        setShowDropdown(false);
        setFlash(`${sym}:${marketType}`);
        setTimeout(() => setFlash(null), 1500);
        inputRef.current?.focus();
    }

    function handleRemove(sym: string, type: 'spot' | 'futures') {
        if (monitoredSymbols.length <= 1) {
            setError('You must monitor at least one symbol.');
            return;
        }
        removeMonitoredSymbol(sym, type);
        setError('');
    }

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === 'Enter') handleAdd();
        if (e.key === 'Escape') setShowDropdown(false);
    }

    return (
        <div className="min-h-screen bg-terminal-bg text-terminal-fg font-mono">
            {/* Header */}
            <div className="border-b border-terminal-border px-6 py-4 flex items-center gap-4 bg-terminal-surface/30 backdrop-blur-md sticky top-0 z-50">
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

                <div className="ml-auto">
                    <MarketToggle activeType={marketType} onChange={setMarketType} className="w-48" />
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

                {/* Section: Monitored Assets */}
                <section>
                    <div className="flex items-center gap-2 mb-1">
                        <CircleDot size={13} className="text-terminal-green" />
                        <h2 className="text-terminal-green text-xs font-bold uppercase tracking-widest">
                            Monitored Assets
                        </h2>
                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border border-terminal-border text-terminal-muted">
                            {monitoredSymbols.length} active
                        </span>
                        {loadingSymbols && (
                            <Loader2 size={11} className="ml-1 text-terminal-muted animate-spin" />
                        )}
                    </div>
                    <p className="text-terminal-muted text-xs mb-5">
                        These <span className="text-terminal-blue">Binance Spot & Futures</span> assets are tracked on the Dashboard Watchlist and drive Telegram alerts.
                    </p>

                    {/* Active chips */}
                    <div className="flex flex-wrap gap-2 min-h-[52px] p-3 rounded-xl border border-terminal-border/60 bg-terminal-surface/30 backdrop-blur-sm mb-4 shadow-inner">
                        {monitoredSymbols.length === 0 && (
                            <span className="text-terminal-muted text-xs self-center">No assets monitored.</span>
                        )}
                        {monitoredSymbols.map((m) => {
                            const key = `${m.symbol}:${m.type}`;
                            return (
                                <span
                                    key={key}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono transition-all duration-300
                                    ${flash === key
                                        ? 'border-terminal-green text-terminal-green bg-terminal-green/10 scale-105 shadow-[0_0_8px_rgba(0,255,65,0.3)]'
                                        : 'border-terminal-border text-terminal-fg hover:border-terminal-muted'
                                    }`}
                                >
                                    {m.symbol?.replace('USDT', '')}
                                    <span className={`text-[9px] font-bold px-1 rounded ${
                                        m.type === 'futures' ? 'text-terminal-blue bg-terminal-blue/10' : 'text-terminal-green bg-terminal-green/10'
                                    }`}>
                                        {m.type === 'futures' ? 'PERP' : 'SPOT'}
                                    </span>
                                    <button
                                        onClick={() => handleRemove(m.symbol, m.type)}
                                        className="text-terminal-muted hover:text-terminal-red transition-colors ml-0.5"
                                        aria-label={`Remove ${m.symbol} ${m.type}`}
                                    >
                                        <X size={11} />
                                    </button>
                                </span>
                            );
                        })}
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
                                    placeholder={`Search ${marketType}, e.g. SOL → SOLUSDT`}
                                    className="w-full bg-terminal-bg/50 border border-terminal-border/80 rounded-lg pl-9 pr-4 py-2.5 text-sm text-terminal-fg placeholder:text-terminal-muted/40 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green/50 transition-all shadow-inner"
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
                                    <span>{inputValue ? `Matches for "${inputValue.toUpperCase()}"` : `Popular ${marketType.toUpperCase()}`}</span>
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
                                            <span className="text-terminal-muted text-[10px]">
                                                {marketType === 'futures' ? 'USDT-PERP · Binance Futures' : 'USDT · Binance Spot'}
                                            </span>
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

                {/* Section: Appearance */}
                <section>
                    <div className="flex items-center gap-2 mb-1">
                        <Zap size={13} className="text-terminal-green" />
                        <h2 className="text-terminal-green text-xs font-bold uppercase tracking-widest">
                            Appearance
                        </h2>
                    </div>
                    <p className="text-terminal-muted text-xs mb-5">
                        Choose your preferred interface aesthetic. Changes are applied system-wide.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => setTheme('terminal')}
                            className={`flex flex-col gap-3 p-4 rounded-xl border transition-all duration-300 text-left ${theme === 'terminal'
                                ? 'border-terminal-green bg-terminal-green/10 ring-1 ring-terminal-green/50 shadow-[0_0_15px_rgba(0,255,65,0.15)] glow-text'
                                : 'border-terminal-border/60 bg-terminal-surface/40 backdrop-blur-sm hover:border-terminal-border hover:shadow-lg'
                                }`}
                        >
                            <div className="flex justify-between items-center">
                                <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'terminal' ? 'text-terminal-green' : 'text-terminal-fg'}`}>
                                    Hacker Terminal
                                </span>
                                {theme === 'terminal' && <CircleDot size={12} className="text-terminal-green" />}
                            </div>
                            <div className="flex flex-col gap-1.5 opacity-60">
                                <div className="h-2 w-full bg-terminal-fg/20 rounded-full" />
                                <div className="h-2 w-3/4 bg-terminal-fg/20 rounded-full" />
                            </div>
                        </button>

                        <button
                            onClick={() => setTheme('professional')}
                            className={`flex flex-col gap-3 p-4 rounded-xl border transition-all duration-300 text-left ${theme === 'professional'
                                ? 'border-terminal-blue bg-terminal-blue/10 ring-1 ring-terminal-blue/50 shadow-[0_0_15px_rgba(45,136,255,0.2)] glow-text'
                                : 'border-terminal-border/60 bg-terminal-surface/40 backdrop-blur-sm hover:border-terminal-border hover:shadow-lg'
                                }`}
                        >
                            <div className="flex justify-between items-center">
                                <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'professional' ? 'text-terminal-blue' : 'text-terminal-fg'}`}>
                                    Indigo Professional
                                </span>
                                {theme === 'professional' && <CircleDot size={12} className="text-terminal-blue" />}
                            </div>
                            <div className="flex flex-col gap-1.5 opacity-60">
                                <div className="h-2 w-full bg-terminal-blue/20 rounded-full" />
                                <div className="h-2 w-3/4 bg-terminal-blue/20 rounded-full" />
                            </div>
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
