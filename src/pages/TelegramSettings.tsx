import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTerminalStore } from '../store/useTerminalStore';
import { sendTelegramAlert, getCurrentSession } from '../hooks/useSmartAlerts';
import { ShieldAlert, ArrowLeft, Activity, Clock, Bell, Settings, Trash2, Sliders, Zap, Layers, Globe, Info } from 'lucide-react';
import { fetchConfigFromBot } from '../utils/syncConfig';

const ALL_TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"];
const ALL_SESSIONS = ["London", "US", "Asia"];

const HELP_CONTENT: Record<string, string> = {
    // Categories
    'oi_spike': 'Monitors sudden leverage changes. Spikes suggest new aggressive positioning; Flushes suggest liquidations or mass profit-taking.',
    'whale': 'Tracks large individual orders and net flows. Can signal localized support/resistance or institutional aggression.',
    'liquidation': 'Alerts on forced order closures. High clusters of liquidations often mark local price exhaustion.',
    'atr_expand': 'Uses ATR Ratio to detect when price ranges are expanding rapidly (high risk) or contracting (breakout potential).',
    'rvol_spike': 'Alerts when volume is significantly higher than the 20-period average, indicating high conviction.',
    'ema_cross': 'Identifies Trend vs. Range conditions based on EMA 21/50 crossovers and price positioning.',
    'rsi_extreme': 'Signals overbought (>70) or oversold (<30) conditions where momentum may be exhausted.',
    'extreme_funding': 'Alerts on unbalanced leverage. Extremely high/low rates increase the risk of cascading squeeze events.',
    'order_flow': 'Combines Price and OI delta to identify Active Long Building vs Short Covering dynamics.',
    'level_testing': 'Detects when price interacts with high-volume nodes like POC or technical anchors like VWAP.',
    'context_summary': 'A state analyzer that alerts only when the combined Regime, Flow, and Volatility states shift.',
    'market_context': 'Periodic (4h) and Daily (24h) summaries of overall market health and cumulative flows.',

    // Thresholds
    'whaleMinAmount': 'The minimum dollar volume required to trigger a individual Whale Trade notification.',
    'liquidationMinAmount': 'The minimum dollar volume of a forced order to trigger a Liquidation notification.',
    'oiSpikePercentage': 'The percentage change in Open Interest over a 5-minute rolling window required for an alert.',
    'atrExpansionRatio': 'The ratio of current candle range vs average range. 1.3x indicates significant volatility expansion.',
    'rvolMultiplier': 'The multiplier above average volume required to trigger an RVOL Spike alert.',
    'fundingExtremeRate': 'The percentage rate at which funding is considered unbalanced (e.g., 0.05% per 8h).',
    'emaSeparationPct': 'The percentage gap between EMA 21 and 50 required to classify a trend as "Strong."',
    'rsiOverbought': 'The RSI level above which the market is considered over-extended and vulnerable to a pullback.',
    'rsiOversold': 'The RSI level below which the market is considered oversold and potential for a relief bounce.',
    'whaleMomentumDelta': 'The net aggression floor ($) required to trigger a Whale Momentum Shift alert.'
};

function InfoTooltip({ id }: { id: string }) {
    const [show, setShow] = useState(false);
    const content = HELP_CONTENT[id];
    if (!content) return null;

    return (
        <div className="relative inline-block ml-2 group">
            <button
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
                onClick={() => setShow(!show)}
                className="p-1 hover:text-indigo-400 text-slate-600 transition-colors"
            >
                <Info className="w-3 h-3" />
            </button>
            {show && (
                <div className="absolute z-[100] bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 border border-slate-800 rounded shadow-2xl animate-in fade-in zoom-in duration-200">
                    <p className="text-[10px] text-slate-300 font-mono leading-relaxed pointer-events-none">
                        {content}
                    </p>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                </div>
            )}
        </div>
    );
}

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
    const [activeTab, setActiveTab] = useState<'general' | 'alerts' | 'diagnostics'>('general');

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

    const fireMockAlert = async (type: string, inputCategory: string) => {
        if (!config || !config.globalEnabled) {
            alert("Master Egress Toggle is OFF. Manual diagnostic tests are blocked.");
            return;
        }

        let title = "";
        let message = "";
        let category = inputCategory || type;

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
                title = `BTCUSDT 💥 Major Liquidation`;
                message = `<b>Side:</b> 🔥 SHORT\n<b>Amount:</b> $1.2M\n<b>Price:</b> $64,250\n\n<b>Session:</b> ${getCurrentSession()}`;
                category = "liquidation";
                break;
            case 'whale':
                title = `BTCUSDT 🐋 Whale Trade`;
                message = `<b>Direction:</b> 🟢 BUY\n<b>Size:</b> $3.5M\n<b>Price:</b> $64,100\n\n<b>Session:</b> ${getCurrentSession()}`;
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
                category = "extreme_funding";
                break;
            case 'va_breakout':
                title = `[BTCUSDT] 📈 Value Area Breakout`;
                message = "<b>Direction:</b> 🟢 Breaking VAH (Bullish)\n<b>Current Price:</b> $65,100\n<b>VAH:</b> $64,800\n<b>VAL:</b> $63,200\n\n<i>Price has gained acceptance outside the high-volume node.</i>";
                category = "level_testing";
                break;
            case 'whale_momentum':
                title = `[BTCUSDT] 🐋💨 Whale Momentum Shift`;
                message = "<b>Direction:</b> 🟢 Massive Accumulation\n<b>15m Net Flow Shift:</b> +$8.4M\n\n<i>Smart money is aggressively executing along a single vector.</i>";
                category = "whale";
                break;
            case 'rvol':
                title = `[BTCUSDT] 🌋 Abnormal RVOL Detected`;
                message = "<b>RVOL Spike:</b> 4.2x Average\n<b>Dominant Pressure:</b> 🟢 Buying\n<b>5m Volume:</b> $24.5M\n\n<i>Extremely high activity detected.</i>";
                category = "rvol_spike";
                break;
            case 'daily_wrap':
                title = `[BTCUSDT] 📅 Daily Market Wrap-Up`;
                message = "<b>Closing Price:</b> $64,500\n<b>Net Whale Flow (24h):</b> +$15.2M\n<b>Net OI Change (24h):</b> +$42.1M\n<b>Current Funding:</b> 0.0125%\n\n<i>Session closed, data reset for the new day.</i>";
                category = "market_context";
                break;
            case 'order_flow':
                title = `[BTCUSDT] 📊 Flow Shift Detected`;
                message = "<b>Dynamics:</b> Active Long Building\n<b>OI Delta:</b> +2.45%\n<b>Price Delta:</b> +0.85%\n\n<i>Aggressive positioning detected.</i>";
                category = "order_flow";
                break;
            case 'level_testing':
                title = `[BTCUSDT] 🎯 Level Interaction`;
                message = "<b>Status:</b> Testing POC\n<b>Price:</b> $64,250\n\n<i>Interaction with high-volume node.</i>";
                category = "level_testing";
                break;
            case 'context_summary':
                title = `[BTCUSDT] ⚡ Context Summary Shift`;
                message = "<b>Uptrend (Strong) → Active Long Building</b>\n\n<b>Regime:</b> Uptrend\n<b>Volatility:</b> Normal\n<b>Positioning:</b> Active Long Building";
                category = "context_summary";
                break;
            default:
                title = `[SYSTEM] Diagnostic Ping`;
                message = "This is a manual test from the ops console.";
                category = "test_ping";
                break;
        }

        try {
            await sendTelegramAlert(title, message, category, 0, category);
            // toast if available
        } catch (e) {
            console.error("Mock alert failed", e);
        }
    };

    return (
        <div className="h-screen bg-slate-950 text-slate-300 font-mono flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-none p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4 sm:gap-0 z-10 w-full">
                <div className="flex items-center space-x-3 w-full sm:w-auto">
                    <ShieldAlert className="w-5 h-5 text-indigo-400 shrink-0" />
                    <div>
                        <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">Telegram Operations</h1>
                        <p className="text-[10px] text-slate-500 font-mono hidden sm:block">Mission Control & Strategy Egress</p>
                    </div>
                </div>
                <div className="flex items-center w-full sm:w-auto justify-end space-x-4">
                    <div className="flex bg-slate-950/50 p-1 rounded-lg border border-slate-800">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'general' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            General
                        </button>
                        <button
                            onClick={() => setActiveTab('alerts')}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'alerts' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Alerts
                        </button>
                        <button
                            onClick={() => setActiveTab('diagnostics')}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'diagnostics' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Logs
                        </button>
                    </div>
                    <Link to="/" className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm bg-slate-800/50 px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500 whitespace-nowrap">
                        <ArrowLeft className="w-4 h-4 shrink-0" />
                        <span className="hidden sm:inline">Back</span>
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 w-full custom-scrollbar">
                {!config || !config.thresholds ? (
                    <div className="max-w-4xl mx-auto flex flex-col items-center justify-center h-64 bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                        <ShieldAlert className="w-12 h-12 text-terminal-red mb-4 opacity-50" />
                        <h2 className="text-lg font-bold text-white mb-2">Configuration State Error</h2>
                        <p className="text-slate-400 text-sm max-w-md text-center font-mono">Telegram configuration or thresholds are missing from the store.</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-6 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-bold transition-colors shadow-lg"
                        >
                            Reload Application
                        </button>
                    </div>
                ) : (
                    <div className="max-w-5xl mx-auto">
                        {activeTab === 'general' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* Left Side: System status & Masters */}
                                <div className="space-y-8">
                                    <section>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                            <Activity className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Connection Status
                                        </h3>
                                        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm">
                                            <div className="space-y-6">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-400 text-sm">Backend Link</span>
                                                    {status.status === 'online' ? (
                                                        <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-bold flex items-center">
                                                            <div className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]"></div> Online
                                                        </span>
                                                    ) : (
                                                        <span className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-xs font-bold flex items-center">
                                                            <div className="w-2 h-2 rounded-full bg-red-400 mr-2"></div> Offline
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="pt-4 border-t border-slate-800/50 flex justify-between items-center">
                                                    <span className="text-slate-400 text-sm">Target Identity</span>
                                                    <span className="text-indigo-400 font-mono font-bold">@{status.bot_username || '---'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                            <Settings className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Strategy Egress
                                        </h3>
                                        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm space-y-6">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h4 className="text-white font-bold text-sm">Master Broadcast Toggle</h4>
                                                    <p className="text-[10px] text-slate-500 mt-1 max-w-[200px]">Globally enable or disable all outgoing Telegram alerts.</p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer scale-110">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={config.globalEnabled || false}
                                                        onChange={(e) => updateConfig({ globalEnabled: e.target.checked })}
                                                    />
                                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>

                                            <div className="pt-6 border-t border-slate-800/50 flex items-center justify-between">
                                                <div>
                                                    <h4 className="text-white font-bold text-sm">System State Shift Alerts</h4>
                                                    <p className="text-[10px] text-slate-500 mt-1 max-w-[200px]">Alert when global market regime or volatility regime changes.</p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer scale-110">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={config.alertOnStateChange || false}
                                                        onChange={(e) => updateConfig({ alertOnStateChange: e.target.checked })}
                                                    />
                                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                            <Globe className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Active Sessions
                                        </h3>
                                        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm">
                                            <div className="flex flex-wrap gap-4">
                                                {ALL_SESSIONS.map(session => (
                                                    <label key={session} className="flex items-center space-x-3 cursor-pointer group">
                                                        <div className="relative">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={config.activeSessions?.includes(session)}
                                                                onChange={(e) => {
                                                                    const current = config.activeSessions || [];
                                                                    const next = e.target.checked
                                                                        ? [...current, session]
                                                                        : current.filter(s => s !== session);
                                                                    updateConfig({ activeSessions: next });
                                                                }}
                                                            />
                                                            <div className="w-10 h-5 bg-slate-800 rounded-full peer peer-checked:bg-indigo-600/50 transition-colors"></div>
                                                            <div className="absolute top-1 left-1 w-3 h-3 bg-slate-500 rounded-full peer-checked:translate-x-5 peer-checked:bg-indigo-400 transition-all"></div>
                                                        </div>
                                                        <span className="text-xs font-bold text-slate-400 group-hover:text-slate-200 transition-colors">{session}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <p className="text-[10px] text-slate-600 mt-4 leading-relaxed italic">
                                                * Alerts will only be egressed to Telegram during these active trading windows.
                                            </p>
                                        </div>
                                    </section>
                                </div>

                                {/* Right Side: Assets & Time */}
                                <div className="space-y-8">
                                    <section>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                            <Layers className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Monitored Assets
                                        </h3>
                                        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm">
                                            <div className="flex space-x-2 mb-4">
                                                <input
                                                    type="text"
                                                    value={newSymbol}
                                                    onChange={(e) => setNewSymbol(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                                                    placeholder="e.g. BTCUSDT"
                                                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 transition-colors placeholder:text-slate-600 outline-none"
                                                />
                                                <button
                                                    onClick={addSymbol}
                                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg active:scale-95"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {(!config.monitoredSymbols || config.monitoredSymbols.length === 0) ? (
                                                    <div className="w-full py-6 text-center border-2 border-dashed border-slate-800/50 rounded-xl bg-slate-950/20">
                                                        <p className="text-[11px] text-slate-600 font-mono">No active tickers monitored</p>
                                                    </div>
                                                ) : (
                                                    config.monitoredSymbols.map(s => (
                                                        <div key={s} className="flex items-center bg-slate-950 p-2 rounded-lg border border-slate-800 group hover:border-indigo-500/50 transition-colors">
                                                            <span className="text-[11px] font-bold text-slate-300 px-2">{s}</span>
                                                            <button onClick={() => removeSymbol(s)} className="p-1 text-slate-600 hover:text-red-400 transition-colors rounded-md bg-slate-900 group-hover:bg-slate-800">
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                            <Clock className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Quiet Hours
                                        </h3>
                                        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm">
                                            <div className="flex items-center justify-between mb-6">
                                                <div>
                                                    <h4 className="text-white font-bold text-sm">Silent Mode</h4>
                                                    <p className="text-[10px] text-slate-500 mt-1">Suppress alerts during specific windows.</p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={config.quietHours?.enabled || false}
                                                        onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, enabled: e.target.checked } })}
                                                    />
                                                    <div className="w-9 h-5 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            {config.quietHours?.enabled && (
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Start</label>
                                                        <input
                                                            type="time"
                                                            value={config.quietHours?.start || "22:00"}
                                                            onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, start: e.target.value } })}
                                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-indigo-400 outline-none focus:border-indigo-500"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">End</label>
                                                        <input
                                                            type="time"
                                                            value={config.quietHours?.end || "06:00"}
                                                            onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, end: e.target.value } })}
                                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-indigo-400 outline-none focus:border-indigo-500"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        )}

                        {activeTab === 'alerts' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* Left: Subscriptions */}
                                <section className="space-y-4">
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                        <Bell className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Alert Subscriptions
                                    </h3>

                                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm h-full">
                                        <div className="space-y-6">
                                            {/* Subscription groups implementation... */}
                                            {['oi_spike', 'atr_expand', 'liquidation', 'whale', 'extreme_funding', 'ema_cross', 'rsi_extreme', 'rvol_spike', 'order_flow', 'level_testing', 'context_summary', 'market_context'].map(id => (
                                                <div key={id} className="p-4 bg-slate-950/50 border border-slate-800/50 rounded-xl space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center space-x-3">
                                                            <div className={`w-2 h-2 rounded-full ${(config.categories?.[id] ?? true) ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-slate-700'}`}></div>
                                                            <span className="text-sm font-bold text-slate-200 capitalize tracking-tight">{id.replace('_', ' ')}</span>
                                                            <InfoTooltip id={id} />
                                                        </div>
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={config.categories?.[id] ?? true}
                                                                onChange={(e) => updateConfig({ categories: { ...config.categories, [id]: e.target.checked } })}
                                                            />
                                                            <div className="w-9 h-5 bg-slate-800 border border-slate-700 rounded-full peer peer-checked:bg-indigo-600 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-white"></div>
                                                        </label>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-slate-800/30">
                                                        <div className="flex-1 min-w-[200px]">
                                                            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Active Timeframes</label>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {ALL_TIMEFRAMES.map(tf => {
                                                                    const isActive = config.timeframes?.[id]?.includes(tf);
                                                                    return (
                                                                        <button
                                                                            key={tf}
                                                                            onClick={() => {
                                                                                const current = config.timeframes?.[id] || [];
                                                                                const next = isActive ? current.filter(t => t !== tf) : [...current, tf];
                                                                                updateConfig({ timeframes: { ...config.timeframes, [id]: next } });
                                                                            }}
                                                                            className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${isActive
                                                                                ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300 ring-1 ring-indigo-500/20 shadow-sm"
                                                                                : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400"
                                                                                }`}
                                                                        >
                                                                            {tf}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="w-20">
                                                            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1 text-center">Cooldown</label>
                                                            <select
                                                                value={config.cooldowns?.[id] || 300}
                                                                onChange={(e) => updateConfig({ cooldowns: { ...config.cooldowns, [id]: parseInt(e.target.value) } })}
                                                                className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] text-indigo-400 font-bold outline-none hover:border-indigo-500/50 transition-colors"
                                                            >
                                                                <option value="60">1m</option>
                                                                <option value="300">5m</option>
                                                                <option value="900">15m</option>
                                                                <option value="3600">1h</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </section>

                                {/* Right: Thresholds */}
                                <section className="space-y-4">
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                        <Sliders className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Sensitivity Parameters
                                    </h3>

                                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm">
                                        <div className="space-y-6">
                                            <div className="mb-6">
                                                <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Edit Target</label>
                                                <select
                                                    value={editingSymbol}
                                                    onChange={(e) => setEditingSymbol(e.target.value)}
                                                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-2 text-xs text-indigo-400 focus:border-indigo-500 outline-none"
                                                >
                                                    <option value="global">Global Defaults</option>
                                                    {config.monitoredSymbols?.map(s => (
                                                        <option key={s} value={s}>{s} Overrides</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="space-y-8">
                                                {/* Whale Amount */}
                                                <div>
                                                    <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                        Whale Trade Floor ($) <InfoTooltip id="whaleMinAmount" />
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="10000"
                                                        max="10000000"
                                                        step="100000"
                                                        value={config.thresholds?.[editingSymbol]?.whaleMinAmount || config.thresholds?.global?.whaleMinAmount || 500000}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value);
                                                            const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                            updateConfig({
                                                                thresholds: {
                                                                    ...config.thresholds,
                                                                    [editingSymbol]: { ...current, whaleMinAmount: val }
                                                                }
                                                            });
                                                        }}
                                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                    />
                                                    <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                        <span>10k</span>
                                                        <span className="text-indigo-400 font-bold">${((config.thresholds?.[editingSymbol]?.whaleMinAmount || config.thresholds?.global?.whaleMinAmount || 500000) / 1000000).toFixed(1)}M</span>
                                                        <span>10M</span>
                                                    </div>
                                                </div>

                                                {/* Liquidation Amount */}
                                                <div>
                                                    <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                        Liq. Event Floor ($) <InfoTooltip id="liquidationMinAmount" />
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="10000"
                                                        max="10000000"
                                                        step="100000"
                                                        value={config.thresholds?.[editingSymbol]?.liquidationMinAmount || config.thresholds?.global?.liquidationMinAmount || 1000000}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value);
                                                            const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                            updateConfig({
                                                                thresholds: {
                                                                    ...config.thresholds,
                                                                    [editingSymbol]: { ...current, liquidationMinAmount: val }
                                                                }
                                                            });
                                                        }}
                                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                    />
                                                    <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                        <span>10k</span>
                                                        <span className="text-indigo-400 font-bold">${((config.thresholds?.[editingSymbol]?.liquidationMinAmount || config.thresholds?.global?.liquidationMinAmount || 1000000) / 1000000).toFixed(1)}M</span>
                                                        <span>10M</span>
                                                    </div>
                                                </div>

                                                {/* OI Spike */}
                                                <div>
                                                    <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                        OI Surge (%) <InfoTooltip id="oiSpikePercentage" />
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="0.1"
                                                        max="10"
                                                        step="0.1"
                                                        value={config.thresholds?.[editingSymbol]?.oiSpikePercentage || config.thresholds?.global?.oiSpikePercentage || 1.5}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                            updateConfig({
                                                                thresholds: {
                                                                    ...config.thresholds,
                                                                    [editingSymbol]: { ...current, oiSpikePercentage: val }
                                                                }
                                                            });
                                                        }}
                                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                    />
                                                    <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                        <span>0.1%</span>
                                                        <span className="text-indigo-400 font-bold">{config.thresholds?.[editingSymbol]?.oiSpikePercentage || config.thresholds?.global?.oiSpikePercentage || 1.5}%</span>
                                                        <span>10%</span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4 border-t border-slate-800/50">
                                                    {/* ATR Expansion */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            ATR Range Surge (x) <InfoTooltip id="atrExpansionRatio" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="1.0"
                                                            max="5.0"
                                                            step="0.1"
                                                            value={config.thresholds?.[editingSymbol]?.atrExpansionRatio || config.thresholds?.global?.atrExpansionRatio || 1.3}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, atrExpansionRatio: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>1.0x</span>
                                                            <span className="text-indigo-400 font-bold">{config.thresholds?.[editingSymbol]?.atrExpansionRatio || config.thresholds?.global?.atrExpansionRatio || 1.3}x</span>
                                                            <span>5.0x</span>
                                                        </div>
                                                    </div>

                                                    {/* RVOL Multiplier */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            Volume Surge (x) <InfoTooltip id="rvolMultiplier" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="1.0"
                                                            max="10.0"
                                                            step="0.5"
                                                            value={config.thresholds?.[editingSymbol]?.rvolMultiplier || config.thresholds?.global?.rvolMultiplier || 3.0}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, rvolMultiplier: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>1.0x</span>
                                                            <span className="text-indigo-400 font-bold">{config.thresholds?.[editingSymbol]?.rvolMultiplier || config.thresholds?.global?.rvolMultiplier || 3.0}x</span>
                                                            <span>10.0x</span>
                                                        </div>
                                                    </div>

                                                    {/* Funding Extreme */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            Extreme Funding (%) <InfoTooltip id="fundingExtremeRate" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="0.01"
                                                            max="0.5"
                                                            step="0.01"
                                                            value={config.thresholds?.[editingSymbol]?.fundingExtremeRate || config.thresholds?.global?.fundingExtremeRate || 0.05}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, fundingExtremeRate: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>0.01%</span>
                                                            <span className="text-indigo-400 font-bold">{config.thresholds?.[editingSymbol]?.fundingExtremeRate || config.thresholds?.global?.fundingExtremeRate || 0.05}%</span>
                                                            <span>0.5%</span>
                                                        </div>
                                                    </div>

                                                    {/* EMA Separation */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            Trend Stretch (%) <InfoTooltip id="emaSeparationPct" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="0.05"
                                                            max="1.0"
                                                            step="0.05"
                                                            value={config.thresholds?.[editingSymbol]?.emaSeparationPct || config.thresholds?.global?.emaSeparationPct || 0.15}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, emaSeparationPct: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>0.05%</span>
                                                            <span className="text-indigo-400 font-bold">{config.thresholds?.[editingSymbol]?.emaSeparationPct || config.thresholds?.global?.emaSeparationPct || 0.15}%</span>
                                                            <span>1.0%</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4 border-t border-slate-800/50">
                                                    {/* RSI Overbought */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            RSI Overbought <InfoTooltip id="rsiOverbought" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="50"
                                                            max="90"
                                                            step="1"
                                                            value={config.thresholds?.[editingSymbol]?.rsiOverbought || config.thresholds?.global?.rsiOverbought || 70}
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, rsiOverbought: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>50</span>
                                                            <span className="text-emerald-400 font-bold">{config.thresholds?.[editingSymbol]?.rsiOverbought || config.thresholds?.global?.rsiOverbought || 70}</span>
                                                            <span>90</span>
                                                        </div>
                                                    </div>

                                                    {/* RSI Oversold */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            RSI Oversold <InfoTooltip id="rsiOversold" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="10"
                                                            max="50"
                                                            step="1"
                                                            value={config.thresholds?.[editingSymbol]?.rsiOversold || config.thresholds?.global?.rsiOversold || 30}
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, rsiOversold: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>10</span>
                                                            <span className="text-red-400 font-bold">{config.thresholds?.[editingSymbol]?.rsiOversold || config.thresholds?.global?.rsiOversold || 30}</span>
                                                            <span>50</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="pt-4 border-t border-slate-800/50">
                                                    {/* Whale Momentum Delta */}
                                                    <div>
                                                        <label className="flex items-center text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                                            Whale Net Aggression Floor ($) <InfoTooltip id="whaleMomentumDelta" />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min="100000"
                                                            max="10000000"
                                                            step="100000"
                                                            value={config.thresholds?.[editingSymbol]?.whaleMomentumDelta || config.thresholds?.global?.whaleMomentumDelta || 5000000}
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value);
                                                                const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, whaleMomentumDelta: val } } });
                                                            }}
                                                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                        />
                                                        <div className="flex justify-between mt-2 font-mono text-[10px] text-slate-400">
                                                            <span>100k</span>
                                                            <span className="text-indigo-400 font-bold">${(config.thresholds?.[editingSymbol]?.whaleMomentumDelta || config.thresholds?.global?.whaleMomentumDelta || 5000000).toLocaleString()}</span>
                                                            <span>10M</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'diagnostics' && (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-[calc(100vh-250px)]">
                                {/* Validation Box */}
                                <section className="lg:col-span-1 space-y-4">
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                                        <ShieldAlert className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Validation Suite
                                    </h3>
                                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 backdrop-blur-sm">
                                        <p className="text-[11px] text-slate-400 mb-4 h-12">Execute diagnostic egress to verify bot connectivity and payload rendering.</p>
                                        <div className="space-y-4">
                                            <select
                                                value={selectedTest}
                                                onChange={(e) => setSelectedTest(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
                                            >
                                                <option value="oi_spike">OI Spike/Flush</option>
                                                <option value="atr_expand">Volatility Expansion</option>
                                                <option value="liquidation">Liquidations</option>
                                                <option value="whale">Whale Activity</option>
                                                <option value="order_flow">Order Flow Shift</option>
                                                <option value="level_testing">Level Testing</option>
                                                <option value="context_summary">Context Summary</option>
                                                <option value="market_context_summary">Market Wrap/Summary</option>
                                                <option value="ping">System Ping</option>
                                            </select>
                                            <button
                                                onClick={() => fireMockAlert(selectedTest, selectedTest)}
                                                disabled={!config.globalEnabled}
                                                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-lg border border-indigo-500/50 shadow-lg active:scale-95 transition-all flex items-center justify-center space-x-2"
                                            >
                                                <Zap className="w-3.5 h-3.5" />
                                                <span>Fire Mock Alert</span>
                                            </button>
                                        </div>
                                    </div>
                                </section>

                                {/* Egress Ledger */}
                                <section className="lg:col-span-2 space-y-4 flex flex-col min-h-0">
                                    <div className="flex justify-between items-center mb-0">
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center">
                                            <Activity className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Egress Ledger
                                        </h3>
                                        <span className="text-[10px] text-slate-500 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-800">Latest 50</span>
                                    </div>

                                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 backdrop-blur-sm flex-1 overflow-y-auto custom-scrollbar">
                                        {(!history || history.length === 0) ? (
                                            <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                                                <Layers className="w-8 h-8 mb-2" />
                                                <p className="text-[11px] font-mono">No recent activity detected</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {history.map((item, i) => (
                                                    <div key={i} className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-[11px] animate-in fade-in slide-in-from-right-2 duration-300">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <div className="flex items-center space-x-2">
                                                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${item.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                                                    }`}>
                                                                    {item.category}
                                                                </span>
                                                                <span className="font-bold text-slate-200">{item.symbol}</span>
                                                            </div>
                                                            <span className="text-slate-600 font-mono text-[9px]">
                                                                {new Date(item.timestamp).toLocaleTimeString()}
                                                            </span>
                                                        </div>
                                                        <p className="text-slate-400 leading-relaxed font-mono line-clamp-2">{item.message}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Scoped CSS for scrollbar */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #334155;
                    border-radius: 10px;
                }
                .custom-scrollbar {
                    scrollbar-width: thin;
                    scrollbar-color: #334155 transparent;
                }
            `}</style>
        </div>
    );
}
