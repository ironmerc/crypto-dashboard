import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTerminalStore } from '../store/useTerminalStore';
import { ShieldAlert, ArrowLeft, Activity, Clock, Bell, Settings, Shield, Trash2, Sliders, Zap, Layers } from 'lucide-react';
import { fetchConfigFromBot } from '../utils/syncConfig';

const ALL_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"];

interface BotStatus {
    status: 'online' | 'offline' | 'unreachable';
    bot_username?: string;
    target_chat_id?: string;
    last_message_timestamp?: string;
    server_time_utc?: string;
}

export default function TelegramSettings() {
    const config = useTerminalStore((state) => state.telegramConfig);
    const updateConfig = useTerminalStore((state) => state.updateTelegramConfig);
    const addMonitoredSymbol = useTerminalStore((state) => state.addMonitoredSymbol);
    const removeMonitoredSymbol = useTerminalStore((state) => state.removeMonitoredSymbol);

    const [status, setStatus] = useState<BotStatus>({ status: 'unreachable' });
    const [history, setHistory] = useState<{ timestamp: string; symbol: string; category: string; severity: string; message: string; }[]>([]);
    const [selectedTest, setSelectedTest] = useState('oi_spike');
    const [editingSymbol, setEditingSymbol] = useState('global');
    const [newSymbol, setNewSymbol] = useState('');

    useEffect(() => {
        const abortController = new AbortController();

        const fetchStatus = async () => {
            try {
                const res = await fetch('/api/bot/status', { signal: abortController.signal });
                if (res.ok) {
                    const data = await res.json();
                    setStatus(data);
                } else {
                    setStatus({ status: 'unreachable' });
                }
            } catch {
                setStatus({ status: 'unreachable' });
            }
        };

        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/bot/history', { signal: abortController.signal });
                if (res.ok) {
                    const data = await res.json();
                    setHistory(data);
                }
            } catch {
                // Silent catch for history
            }
        };

        fetchConfigFromBot();
        fetchStatus();
        fetchHistory();

        const statusInterval = setInterval(fetchStatus, 5000);
        const historyInterval = setInterval(fetchHistory, 15000);

        return () => {
            clearInterval(statusInterval);
            clearInterval(historyInterval);
            abortController.abort();
        };
    }, []);

    const addSymbol = () => {
        if (!newSymbol) return;
        addMonitoredSymbol(newSymbol);
        setNewSymbol('');
    };

    const removeSymbol = (s: string) => {
        removeMonitoredSymbol(s);
        if (editingSymbol === s) setEditingSymbol('global');
    };

    const fireMockAlert = async (type: string) => {
        if (!config || !config.globalEnabled) {
            alert("Master Egress Toggle is OFF. Manual diagnostic tests are blocked.");
            return;
        }

        let title = "";
        let message = "";
        let category = type;
        const symbol = "BTCUSDT";

        switch (type) {
            case 'oi_spike':
                title = `[BTCUSDT] 🚀 OI Spike Detected`;
                message = "<b>Delta:</b> +$5.2M in 5m\n<b>Current OI:</b> $125.4M\n\n<i>Sudden influx of leverage detected.</i>";
                category = "oi_spike";
                break;
            case 'atr_expand':
                title = `[BTCUSDT] ⚡ Volatility Expansion (ATR)`;
                message = "<b>Current ATR:</b> $450\n<b>Average ATR:</b> $210\n<b>Multiplier:</b> 2.1x\n\n<i>Rapid expansion in price ranges. Expect turbulence.</i>";
                category = "atr_expand";
                break;
            case 'liquidation':
                title = `[BTCUSDT] 💥 Major Liquidation`;
                message = "<b>Side:</b> Short\n<b>Amount:</b> $1.2M\n<b>Price:</b> $64,250\n\n<i>Forced coverage detected in the market.</i>";
                category = "liquidation";
                break;
            case 'whale':
                title = `[BTCUSDT] 🐋 Giant Trade Executed`;
                message = "<b>Direction:</b> BUY\n<b>Size:</b> $3.5M\n<b>Price:</b> $64,100\n\n<i>A massive block order just filled on the tape.</i>";
                category = "whale";
                break;
            case 'market_context_summary':
                title = `[BTCUSDT] 🧭 Market Context Summary`;
                message = "<b>Regime:</b> Trending Up (Strong)\n<b>Volatility:</b> Expansion (High Risk)\n<b>Positioning:</b> Active Long Building (OI +1.2%)\n<b>Execution:</b> Spread Tight\n\n<i>Macro conditions support trend-following strategies.</i>";
                category = "market_context";
                break;
            case 'funding_extreme':
                title = `[BTCUSDT] ⚠️ Extreme Funding Rate`;
                message = "<b>Current Rate:</b> 0.0521%\n<b>Implication:</b> Extreme Long Bias\n\n<i>Leverage is heavily skewed. Risk of a long squeeze is elevated.</i>";
                category = "funding";
                break;
            case 'va_breakout':
                title = `[BTCUSDT] 📈 Value Area Breakout`;
                message = "<b>Direction:</b> 🟢 Breaking VAH (Bullish)\n<b>Current Price:</b> $65,100\n<b>VAH:</b> $64,800\n<b>VAL:</b> $63,200\n\n<i>Price has gained acceptance outside the high-volume node.</i>";
                category = "value_area";
                break;
            case 'whale_momentum':
                title = `[BTCUSDT] 🐋💨 Whale Momentum Shift`;
                message = "<b>Direction:</b> 🟢 Massive Accumulation\n<b>15m Net Flow Shift:</b> +$8.4M\n\n<i>Smart money is aggressively executing along a single vector.</i>";
                category = "whale";
                break;
            case 'rvol':
                title = `[BTCUSDT] 🌋 Abnormal RVOL Detected`;
                message = "<b>RVOL Spike:</b> 4.2x Average\n<b>Dominant Pressure:</b> 🟢 Buying\n<b>5m Volume:</b> $24.5M\n\n<i>Extremely high activity detected.</i>";
                category = "rvol";
                break;
            case 'daily_wrap':
                title = `[BTCUSDT] 📅 Daily Market Wrap-Up`;
                message = "<b>Closing Price:</b> $64,500\n<b>Net Whale Flow (24h):</b> +$15.2M\n<b>Net OI Change (24h):</b> +$42.1M\n<b>Current Funding:</b> 0.0125%\n\n<i>Session closed, data reset for the new day.</i>";
                category = "market_context";
                break;
            default:
                title = `[SYSTEM] Diagnostic Ping`;
                message = "This is a manual test from the ops console.";
                category = "test_ping";
                break;
        }

        try {
            const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/alert';
            await fetch(botUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `<b>🚨 ${title}</b>\n\n${message}`,
                    type: `TEST_MOCK_${type.toUpperCase()}_${Date.now()}`,
                    severity: "info",
                    symbol: symbol,
                    cooldown: 0,
                    category: category
                })
            });
            const res = await fetch('/api/bot/history');
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            }
        } catch (e) {
            console.error('Failed test alert', e);
        }
    };

    return (
        <div className="h-screen bg-slate-950 text-slate-300 font-mono flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-none p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4 sm:gap-0 z-10 w-full">
                <div className="flex items-center space-x-3 w-full sm:w-auto">
                    <ShieldAlert className="w-5 h-5 text-indigo-400 shrink-0" />
                    <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">Telegram Operations</h1>
                </div>
                <div className="flex items-center w-full sm:w-auto justify-end">
                    <Link to="/" className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm bg-slate-800/50 px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500 whitespace-nowrap">
                        <ArrowLeft className="w-4 h-4 shrink-0" />
                        <span className="hidden sm:inline">Back to Dashboard</span>
                        <span className="sm:hidden">Back</span>
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-6 w-full custom-scrollbar">
                {!config || !config.thresholds ? (
                    <div className="max-w-6xl mx-auto flex flex-col items-center justify-center h-64 bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                        <ShieldAlert className="w-12 h-12 text-terminal-red mb-4 opacity-50" />
                        <h2 className="text-lg font-bold text-white mb-2">Configuration State Error</h2>
                        <p className="text-slate-400 text-sm max-w-md text-center">Telegram configuration or thresholds are missing from the store. This may happen during initial synchronization.</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-6 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-bold transition-colors"
                        >
                            Reload Application
                        </button>
                    </div>
                ) : (
                    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

                        {/* Left Column: Status & Global Config */}
                        <div className="space-y-6">
                            {/* System Status */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                    <Activity className="w-4 h-4 mr-2" /> System Status
                                </h2>
                                <div className="space-y-4 text-sm">
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-500">Connection</span>
                                        {status.status === 'online' ? (
                                            <span className="px-2 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded flex items-center">
                                                <div className="w-2 h-2 rounded-full bg-green-400 mr-2 animate-pulse"></div> Online
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded flex items-center">
                                                <div className="w-2 h-2 rounded-full bg-red-400 mr-2"></div> Unreachable
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center border-t border-slate-800 pt-3">
                                        <span className="text-slate-500">Bot Username</span>
                                        <span className="text-slate-300 font-medium">@{status.bot_username || '---'}</span>
                                    </div>
                                    <div className="flex justify-between items-center border-t border-slate-800 pt-3">
                                        <span className="text-slate-500">Chat ID</span>
                                        <span className="text-slate-300 font-medium">{status.target_chat_id || '---'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Symbol Manager */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                    <Layers className="w-4 h-4 mr-2" /> Monitored Assets
                                </h2>
                                <div className="space-y-4">
                                    <div className="flex space-x-2">
                                        <input
                                            type="text"
                                            value={newSymbol}
                                            onChange={(e) => setNewSymbol(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                                            placeholder="ETHUSDT..."
                                            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
                                        />
                                        <button
                                            onClick={addSymbol}
                                            className="px-3 py-1.5 shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded transition-colors"
                                        >
                                            ADD
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {(!config.monitoredSymbols || config.monitoredSymbols.length === 0) ? (
                                            <div className="w-full py-4 text-center border border-dashed border-slate-800 rounded-lg">
                                                <span className="text-[10px] text-slate-500 italic">No assets monitored. Add one above (e.g. BTCUSDT)</span>
                                            </div>
                                        ) : (
                                            config.monitoredSymbols.map(s => (
                                                <div key={s} className="flex items-center space-x-1.5 bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300 group/tag break-all max-w-full">
                                                    <span className="truncate">{s}</span>
                                                    <button onClick={() => removeSymbol(s)} className="text-slate-500 hover:text-red-400 transition-colors shrink-0">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Global Routing Rules */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                    <Settings className="w-4 h-4 mr-2" /> Global Routing
                                </h2>
                                <div className="space-y-5">
                                    <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded flex-wrap gap-3">
                                        <div className="flex items-center space-x-3 min-w-0">
                                            <div className={`w-2 h-2 shrink-0 rounded-full ${config.globalEnabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-slate-600'}`}></div>
                                            <span className="text-xs font-bold text-slate-200 truncate">MASTER TOGGLE</span>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={config.globalEnabled || false}
                                                onChange={(e) => updateConfig({ globalEnabled: e.target.checked })}
                                            />
                                            <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                                        </label>
                                    </div>



                                    <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between gap-3">
                                        <span className="text-xs text-slate-400 break-words flex-1">Alert on State Change</span>
                                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={config.alertOnStateChange || false}
                                                onChange={(e) => updateConfig({ alertOnStateChange: e.target.checked })}
                                            />
                                            <div className="w-8 h-4 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            {/* Quiet Hours */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center">
                                        <Clock className="w-4 h-4 mr-2 text-indigo-400" /> Quiet Hours
                                    </h2>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={config.quietHours?.enabled || false}
                                            onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, enabled: e.target.checked } })}
                                        />
                                        <div className="w-8 h-4 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
                                    </label>
                                </div>
                                <p className="text-[10px] text-slate-500 mb-4 leading-relaxed italic">Suppresses non-critical alerts based on local time.</p>
                                {config.quietHours?.enabled && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Start</label>
                                            <input
                                                type="time"
                                                value={config.quietHours?.start || "22:00"}
                                                onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, start: e.target.value } })}
                                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">End</label>
                                            <input
                                                type="time"
                                                value={config.quietHours?.end || "06:00"}
                                                onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, end: e.target.value } })}
                                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Dynamic Thresholds */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
                                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center shrink-0">
                                        <Sliders className="w-4 h-4 mr-2" /> Thresholds
                                    </h2>
                                    <select
                                        value={editingSymbol}
                                        onChange={(e) => setEditingSymbol(e.target.value)}
                                        className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 sm:py-1 text-[10px] sm:text-xs text-indigo-400 font-bold focus:outline-none w-full sm:w-auto overflow-hidden text-ellipsis"
                                    >
                                        <option value="global">GLOBAL DEFAULTS</option>
                                        {(config.monitoredSymbols || []).map(s => (
                                            <option key={s} value={s}>{s} OVERRIDE</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-4">
                                    {[
                                        { id: 'whaleMinAmount', label: 'Whale Min ($)', step: 50000, min: 100000, max: 10000000 },
                                        { id: 'liquidationMinAmount', label: 'Liq Min ($)', step: 100000, min: 100000, max: 10000000 },
                                        { id: 'oiSpikePercentage', label: 'OI Spike (%)', step: 0.1, min: 0.5, max: 5 },
                                        { id: 'atrExpansionRatio', label: 'ATR Expansion (x)', step: 0.1, min: 1.1, max: 3.0 },
                                        { id: 'rvolMultiplier', label: 'RVOL Multiplier (x)', step: 0.5, min: 1.5, max: 10 },
                                        { id: 'rsiOverbought', label: 'RSI Overbought', step: 1, min: 60, max: 90 },
                                        { id: 'rsiOversold', label: 'RSI Oversold', step: 1, min: 10, max: 40 },
                                    ].map(t => {
                                        const safeThresholds = config.thresholds || { global: {} };
                                        const symbolThresholds = safeThresholds[editingSymbol] || safeThresholds.global || {};
                                        const value = (symbolThresholds as any)[t.id] || 0;

                                        const formatValue = (val: number, id: string) => {
                                            if (id.includes('Amount')) {
                                                if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
                                                if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
                                                return `$${val}`;
                                            }
                                            if (id.includes('Percentage')) return `${val}%`;
                                            if (id.includes('Ratio') || id.includes('Multiplier')) return `${val}x`;
                                            return val;
                                        };

                                        return (
                                            <div key={t.id} className="group">
                                                <div className="flex justify-between text-[10px] mb-1">
                                                    <span className="text-slate-500 group-hover:text-slate-300 transition-colors uppercase tracking-tighter">{t.label}</span>
                                                    <span className="text-indigo-400 font-bold font-mono">{formatValue(value, t.id)}</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min={t.min}
                                                    max={t.max}
                                                    step={t.step}
                                                    value={value}
                                                    onChange={(e) => {
                                                        const nextThresholds = { ...safeThresholds };
                                                        nextThresholds[editingSymbol] = {
                                                            ...(nextThresholds[editingSymbol] || safeThresholds.global),
                                                            [t.id]: parseFloat(e.target.value)
                                                        };
                                                        updateConfig({ thresholds: nextThresholds });
                                                    }}
                                                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Middle Column: Subscriptions */}
                        <div className="space-y-6">
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center">
                                        <Bell className="w-4 h-4 mr-2" /> Subscription Channels
                                    </h2>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold">Toggle All</span>
                                        <input
                                            type="checkbox"
                                            checked={Object.values(config.categories || {}).every(v => v === true)}
                                            onChange={(e) => {
                                                const categories = [
                                                    'oi_spike', 'atr_expand', 'liquidation', 'whale',
                                                    'funding', 'value_area', 'rvol', 'execution_quality',
                                                    'regime_shift', 'volatility_state', 'order_flow', 'level_testing',
                                                    'context_summary'
                                                ];
                                                const nextCats: Record<string, boolean> = {};
                                                categories.forEach(c => nextCats[c] = e.target.checked);
                                                updateConfig({ categories: nextCats });
                                            }}
                                            className="w-4 h-4 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 bg-slate-900"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    {(() => {
                                        const alertGroups = [
                                            {
                                                title: 'Core Activity',
                                                icon: <Activity className="w-4 h-4 text-emerald-400" />,
                                                items: [
                                                    { id: 'oi_spike', label: 'OI Spikes/Flushes', defaultCd: 600 },
                                                    { id: 'atr_expand', label: 'Volatility Expansion', defaultCd: 300 },
                                                    { id: 'liquidation', label: 'Major Liquidations', defaultCd: 60 },
                                                    { id: 'whale', label: 'Whale Activity', defaultCd: 60 },
                                                ]
                                            },
                                            {
                                                title: 'Market Dynamics',
                                                icon: <Layers className="w-4 h-4 text-blue-400" />,
                                                items: [
                                                    { id: 'regime_shift', label: 'Regime Shifts (MTF)', defaultCd: 900, hasTimeframes: true },
                                                    { id: 'volatility_state', label: 'Volatility States (MTF)', defaultCd: 300, hasTimeframes: true },
                                                    { id: 'order_flow', label: 'Flow Anomalies (MTF)', defaultCd: 300, hasTimeframes: true },
                                                    { id: 'level_testing', label: 'Level Interactions (MTF)', defaultCd: 600, hasTimeframes: true },
                                                ]
                                            },
                                            {
                                                title: 'Context & Alpha',
                                                icon: <Zap className="w-4 h-4 text-amber-400" />,
                                                items: [
                                                    { id: 'context_summary', label: 'Context Summary Shifts', defaultCd: 900, hasTimeframes: true },
                                                    { id: 'funding', label: 'Funding Extremes', defaultCd: 3600 },
                                                    { id: 'value_area', label: 'Value Area Breaks', defaultCd: 300 },
                                                    { id: 'rvol', label: 'RVOL Anomalies', defaultCd: 300 },
                                                    { id: 'execution_quality', label: 'Execution Quality', defaultCd: 300 },
                                                ]
                                            }
                                        ];

                                        return (
                                            <div className="space-y-6">
                                                {alertGroups.map(group => (
                                                    <div key={group.title} className="space-y-3">
                                                        <div className="flex items-center space-x-2 px-1">
                                                            {group.icon}
                                                            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{group.title}</h4>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-2.5">
                                                            {group.items.map(cat => (
                                                                <div key={cat.id} className="flex flex-col space-y-2 p-2 sm:p-3 bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/60 hover:bg-slate-800/30 rounded-lg transition-all group/card overflow-hidden">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={config.categories?.[cat.id] ?? true}
                                                                                onChange={(e) => updateConfig({ categories: { [cat.id]: e.target.checked } })}
                                                                                className="w-4 h-4 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 bg-slate-950 cursor-pointer shrink-0"
                                                                            />
                                                                            <span className="text-[11px] sm:text-sm font-medium text-slate-200 truncate">{cat.label}</span>
                                                                        </div>
                                                                        <div className="flex items-center shrink-0">
                                                                            <select
                                                                                value={config.cooldowns?.[cat.id] || cat.defaultCd}
                                                                                onChange={(e) => updateConfig({ cooldowns: { [cat.id]: parseInt(e.target.value) } })}
                                                                                className="bg-slate-950 border border-slate-700/50 rounded-md px-1 sm:px-1.5 py-0.5 text-[10px] text-slate-400 focus:outline-none hover:border-slate-600 transition-colors h-6"
                                                                            >
                                                                                <option value="60">1m CD</option>
                                                                                <option value="300">5m CD</option>
                                                                                <option value="600">10m CD</option>
                                                                                <option value="900">15m CD</option>
                                                                                <option value="3600">1h CD</option>
                                                                                <option value="14400">4h CD</option>
                                                                            </select>
                                                                        </div>
                                                                    </div>

                                                                    {(cat as any).hasTimeframes && (config.categories?.[cat.id] ?? true) && (
                                                                        <div className="flex flex-wrap items-center gap-1.5 pl-7 mt-1.5">
                                                                            {ALL_TIMEFRAMES.map(tf => {
                                                                                const enabledTfs = config.timeframes?.[cat.id] || ALL_TIMEFRAMES;
                                                                                const isChecked = enabledTfs.includes(tf);
                                                                                return (
                                                                                    <button
                                                                                        key={tf}
                                                                                        onClick={() => {
                                                                                            const nextTfs = isChecked
                                                                                                ? enabledTfs.filter(t => t !== tf)
                                                                                                : [...enabledTfs, tf];
                                                                                            updateConfig({ timeframes: { [cat.id]: nextTfs } });
                                                                                        }}
                                                                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all ${isChecked
                                                                                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'
                                                                                            : 'bg-slate-950/40 border-slate-800 text-slate-600 underline decoration-slate-800'
                                                                                            }`}
                                                                                    >
                                                                                        {tf.toUpperCase()}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Ledger & Validation */}
                        <div className="space-y-6">
                            {/* Alert Test Suite */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                    <ShieldAlert className="w-4 h-4 mr-2 text-indigo-400" /> Validation Suite
                                </h2>
                                <div className="space-y-3">
                                    <div className="flex flex-col space-y-1.5">
                                        <label className="text-[10px] text-slate-500 uppercase font-bold px-0.5">Test Vector</label>
                                        <select
                                            value={selectedTest}
                                            onChange={(e) => setSelectedTest(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none hover:border-slate-700 transition-colors"
                                        >
                                            <option value="oi_spike">OI Spike/Flush</option>
                                            <option value="atr_expand">Volatility Expansion</option>
                                            <option value="liquidation">Liquidations</option>
                                            <option value="whale">Whale Activity</option>
                                            <option value="funding_extreme">Funding Rate Extremes</option>
                                            <option value="va_breakout">Value Area Breakout</option>
                                            <option value="whale_momentum">Whale Momentum Shift</option>
                                            <option value="rvol">Abnormal RVOL</option>
                                            <option value="market_context_summary">Market Summary</option>
                                            <option value="daily_wrap">Daily Wrap-Up</option>
                                            <option value="ping">System Ping</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={() => fireMockAlert(selectedTest)}
                                        disabled={!config.globalEnabled}
                                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white text-xs font-bold py-2 rounded border border-indigo-500/50 transition-all flex items-center justify-center space-x-2"
                                    >
                                        <Zap className="w-3.5 h-3.5" />
                                        <span>Fire Diagnostic Alert</span>
                                    </button>
                                </div>
                            </div>

                            {/* Egress Ledger */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 flex flex-col h-[500px]">
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center">
                                        <Shield className="w-4 h-4 mr-2" /> Egress Ledger
                                    </h2>
                                    <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Latest 50</span>
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                                    {(!history || history.length === 0) ? (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-600 text-sm">
                                            <Trash2 className="w-8 h-8 mb-2 opacity-50" />
                                            <span>No egress logs found</span>
                                        </div>
                                    ) : (
                                        history.map((item, i) => {
                                            const d = new Date(item.timestamp);
                                            const timeStr = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                            const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

                                            let badgeColor = "bg-slate-500/20 text-slate-400 border-slate-500/30";
                                            if (item.category === 'oi_spike') badgeColor = "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
                                            if (item.category === 'atr_expand') badgeColor = "bg-amber-500/20 text-amber-400 border-amber-500/30";
                                            if (item.severity === 'critical') badgeColor = "bg-red-500/20 text-red-400 border-red-500/30";

                                            return (
                                                <div key={i} className="bg-slate-950 border border-slate-800 rounded p-3 text-sm hover:border-slate-700 transition-colors">
                                                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2 gap-2 sm:gap-0">
                                                        <div className="flex items-center flex-wrap gap-2">
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-bold shrink-0 ${badgeColor}`}>
                                                                {item.category}
                                                            </span>
                                                            <span className="font-bold text-slate-300 break-all">{item.symbol}</span>
                                                        </div>
                                                        <span className="text-xs text-slate-500 font-mono whitespace-nowrap">
                                                            {dateStr} {timeStr}
                                                        </span>
                                                    </div>
                                                    <div className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                                                        {item.message}
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {/* Scoped CSS for scrollbar inside the ledger */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                @media (min-width: 640px) {
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 6px;
                    }
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #334155;
                    border-radius: 10px;
                }
            `}</style>
        </div >
    );
}
