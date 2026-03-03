import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTerminalStore } from '../store/useTerminalStore';
import { ShieldAlert, ArrowLeft, Send, Activity, Clock, Bell, Settings, Shield, Trash2, Sliders, Globe, Zap } from 'lucide-react';
import { fetchConfigFromBot } from '../utils/syncConfig';

interface BotStatus {
    status: 'online' | 'offline' | 'unreachable';
    bot_username?: string;
    target_chat_id?: string;
    last_message_timestamp?: string;
    server_time_utc?: string;
}

export default function TelegramSettings() {
    console.log('TelegramSettings mounting...', { hasConfig: !!useTerminalStore.getState().telegramConfig });
    const config = useTerminalStore((state) => state.telegramConfig);
    const updateConfig = useTerminalStore((state) => state.updateTelegramConfig);

    const [status, setStatus] = useState<BotStatus>({ status: 'unreachable' });
    const [history, setHistory] = useState<{ timestamp: string; symbol: string; category: string; severity: string; message: string; }[]>([]);

    const [testMessage, setTestMessage] = useState('This is a manual test from the ops console.');

    // 2. Fetch Data (Status & Ledger) - explicitly inside useEffect to avoid exhaustive-deps
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

        // Initial fetch
        fetchConfigFromBot();
        fetchStatus();
        fetchHistory();

        // Intervals
        const statusInterval = setInterval(fetchStatus, 5000);
        const historyInterval = setInterval(fetchHistory, 15000);

        return () => {
            clearInterval(statusInterval);
            clearInterval(historyInterval);
            abortController.abort();
        };
    }, []);

    const fireMockAlert = async (type: string) => {
        if (!config.globalEnabled) {
            alert("Master Egress Toggle is OFF. Manual diagnostic tests are blocked.");
            return;
        }

        let title = "";
        let message = "";
        let category = type;
        const symbol = "BTCUSDT";

        switch (type) {
            // Phase 1 Legacy
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

            // Phase 2 Advanced
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
                message = testMessage;
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
            // Re-fetch history immediately
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
            <div className="flex-none p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center z-10">
                <div className="flex items-center space-x-4">
                    <ShieldAlert className="w-5 h-5 text-indigo-400" />
                    <h1 className="text-xl font-bold text-white tracking-tight">Telegram Operations</h1>
                </div>
                <div className="flex items-center space-x-4">
                    <Link to="/" className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm bg-slate-800/50 px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500">
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Dashboard</span>
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
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

                        {/* Left Column: Status & Manual Testing */}
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
                                    <div className="flex justify-between items-center border-t border-slate-800 pt-3">
                                        <span className="text-slate-500">Last Message (UTC)</span>
                                        <span className="text-slate-300 text-xs">{status.last_message_timestamp || 'Never'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Alert Test Suite */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                    <ShieldAlert className="w-4 h-4 mr-2" /> Alert Validation Suite
                                </h2>
                                <div className="space-y-4">
                                    <div className="text-xs text-slate-500 mb-2">Click to fire a simulated alert to Telegram (bypasses cooldowns).</div>

                                    <div>
                                        <h3 className="text-xs font-semibold text-indigo-400 mb-2 border-b border-slate-800 pb-1">Legacy Alerts (Phase 1)</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => fireMockAlert('oi_spike')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">OI Spikes/Flushes</button>
                                            <button onClick={() => fireMockAlert('atr_expand')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">ATR Expansion</button>
                                            <button onClick={() => fireMockAlert('liquidation')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">Major Liquidations</button>
                                            <button onClick={() => fireMockAlert('whale')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors col-span-2">Whale Executions</button>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="text-xs font-semibold text-emerald-400 mb-2 border-b border-slate-800 pb-1 mt-4">Advanced Context (Phase 2)</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => fireMockAlert('market_context_summary')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">4H Context Summary</button>
                                            <button onClick={() => fireMockAlert('funding_extreme')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">Funding Extremes</button>
                                            <button onClick={() => fireMockAlert('va_breakout')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">Value Area Breakout</button>
                                            <button onClick={() => fireMockAlert('whale_momentum')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">Whale Net Momentum</button>
                                            <button onClick={() => fireMockAlert('rvol')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">RVOL Anomaly</button>
                                            <button onClick={() => fireMockAlert('daily_wrap')} disabled={!config.globalEnabled} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-[10px] py-1.5 px-2 rounded border border-slate-700 text-left truncate transition-colors">Daily Wrap-Up</button>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="text-xs font-semibold text-slate-400 mb-2 border-b border-slate-800 pb-1 mt-4">Custom Payload</h3>
                                        <textarea
                                            value={testMessage}
                                            onChange={e => setTestMessage(e.target.value)}
                                            rows={2}
                                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono text-xs mb-2"
                                        />
                                        <button
                                            onClick={() => fireMockAlert('custom')}
                                            disabled={!config.globalEnabled}
                                            className={`w-full flex items-center justify-center space-x-2 p-1.5 rounded text-xs transition-all ${config.globalEnabled
                                                ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                                                : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                                                }`}
                                        >
                                            <Send className={`w-3 h-3 ${!config.globalEnabled && "opacity-50"}`} />
                                            <span>Send Custom Ping</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Middle Column: Configuration */}
                        <div className="space-y-6">
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                    <Settings className="w-4 h-4 mr-2" /> Global Routing Rules
                                </h2>

                                {config ? (
                                    <>
                                        {/* Master Toggle */}
                                        <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded mb-6">
                                            <div>
                                                <div className="font-semibold text-white">Master Egress Toggle</div>
                                                <div className="text-xs text-slate-500 mt-1">Halt all outbound Telegram traffic globally.</div>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={config.globalEnabled}
                                                    onChange={(e) => updateConfig({ globalEnabled: e.target.checked })}
                                                />
                                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                                            </label>
                                        </div>

                                        {/* Sessions & Timeframes */}
                                        <div className="border border-slate-800 rounded p-4 space-y-4">
                                            <div className="flex items-center space-x-2 mb-2">
                                                <Globe className="w-4 h-4 text-slate-400" />
                                                <span className="font-semibold text-white">Active Sessions & MTF</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 uppercase mb-2">Sessions</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {['London', 'US', 'Asia'].map(s => (
                                                            <button
                                                                key={s}
                                                                onClick={() => {
                                                                    const current = config.activeSessions || [];
                                                                    const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
                                                                    updateConfig({ activeSessions: next });
                                                                }}
                                                                className={`px-2 py-1 text-[10px] rounded border transition-colors ${config.activeSessions?.includes(s) ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                                                            >
                                                                {s}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 uppercase mb-2">Timeframes</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {['15m', '1h', '4h'].map(tf => (
                                                            <button
                                                                key={tf}
                                                                onClick={() => {
                                                                    const current = config.monitoredTimeframes || [];
                                                                    const next = current.includes(tf) ? current.filter(x => x !== tf) : [...current, tf];
                                                                    updateConfig({ monitoredTimeframes: next });
                                                                }}
                                                                className={`px-2 py-1 text-[10px] rounded border transition-colors ${config.monitoredTimeframes?.includes(tf) ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                                                            >
                                                                {tf}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    <Zap className="w-3.5 h-3.5 text-yellow-500" />
                                                    <span className="text-xs text-slate-300">Alert on State Change (Regime Shift)</span>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={config.alertOnStateChange}
                                                        onChange={(e) => updateConfig({ alertOnStateChange: e.target.checked })}
                                                    />
                                                    <div className="w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-yellow-500"></div>
                                                </label>
                                            </div>
                                        </div>

                                        {/* Quiet Hours */}
                                        <div className="border border-slate-800 rounded p-4 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    <Clock className="w-4 h-4 text-slate-400" />
                                                    <span className="font-semibold text-white">Quiet Hours (Local Time)</span>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={config.quietHours?.enabled || false}
                                                        onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, enabled: e.target.checked } })}
                                                    />
                                                    <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                                                </label>
                                            </div>
                                            <div className="text-xs text-slate-500">Evaluates against your local browser time to suppress non-critical alerts, even across midnight wrappers (e.g. 22:00 -&gt; 06:00).</div>

                                            {config.quietHours?.enabled && (
                                                <div className="flex space-x-4 pt-2">
                                                    <div className="flex-1">
                                                        <label className="block text-xs text-slate-500 mb-1">Halt Traffic At</label>
                                                        <input
                                                            type="time"
                                                            value={config.quietHours?.start || "22:00"}
                                                            onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, start: e.target.value } })}
                                                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500"
                                                        />
                                                    </div>
                                                    <div className="flex-1">
                                                        <label className="block text-xs text-slate-500 mb-1">Resume Traffic At</label>
                                                        <input
                                                            type="time"
                                                            value={config.quietHours?.end || "06:00"}
                                                            onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, end: e.target.value } })}
                                                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-slate-500 p-4">Loading configuration...</div>
                                )}
                            </div>

                            {/* Subscriptions */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center">
                                        <Bell className="w-4 h-4 mr-2" /> Subscription Channels
                                    </h2>
                                    {config && (
                                        <div className="flex items-center space-x-2">
                                            <span className="text-[10px] text-slate-500 uppercase font-bold">Toggle All</span>
                                            <input
                                                type="checkbox"
                                                checked={Object.values(config.categories || {}).every(v => v === true)}
                                                onChange={(e) => {
                                                    const mtfCategories = ['regime_shift', 'volatility_state', 'order_flow', 'level_testing'];
                                                    const timeframes = ['15m', '1h', '4h'];
                                                    const categories = [
                                                        'oi_spike', 'atr_expand', 'liquidation', 'whale',
                                                        'funding', 'value_area', 'rvol', 'execution_quality',
                                                        ...mtfCategories.flatMap(cat => timeframes.map(tf => `${cat}_${tf}`))
                                                    ];
                                                    const nextCats: Record<string, boolean> = {};
                                                    categories.forEach(c => nextCats[c] = e.target.checked);
                                                    updateConfig({ categories: nextCats });
                                                }}
                                                className="w-4 h-4 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 bg-slate-900"
                                            />
                                        </div>
                                    )}
                                </div>
                                {config ? (
                                    <div className="space-y-2">
                                        {[
                                            // Core Alerts
                                            { id: 'oi_spike', label: 'Open Interest Spikes/Flushes', defaultCd: 600 },
                                            { id: 'atr_expand', label: 'ATR Volatility Expansion', defaultCd: 300 },
                                            { id: 'liquidation', label: 'Major Liquidations', defaultCd: 60 },
                                            { id: 'whale', label: 'Whale Activity', defaultCd: 60 },
                                            { id: 'funding', label: 'Funding Extremes', defaultCd: 3600 },
                                            { id: 'execution_quality', label: '⚡ Execution Context', defaultCd: 300 },

                                            // MTF Alerts with Per-Timeframe Toggles
                                            { id: 'regime_shift', label: '🧭 Regime Shifts', defaultCd: 900, isMTF: true },
                                            { id: 'volatility_state', label: '🌊 Volatility Transitions', defaultCd: 300, isMTF: true },
                                            { id: 'order_flow', label: '📊 Flow Anomalies', defaultCd: 300, isMTF: true },
                                            { id: 'level_testing', label: '🎯 Level Interactions', defaultCd: 600, isMTF: true },
                                        ].map(cat => (
                                            <div key={cat.id} className="p-3 border border-slate-800/50 hover:bg-slate-800/20 rounded transition-colors group">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center space-x-2">
                                                        {!cat.isMTF && (
                                                            <input
                                                                type="checkbox"
                                                                checked={config.categories?.[cat.id] ?? true}
                                                                onChange={(e) => updateConfig({ categories: { [cat.id]: e.target.checked } })}
                                                                className="w-4 h-4 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 bg-slate-900"
                                                            />
                                                        )}
                                                        <span className="text-sm font-medium text-slate-300">{cat.label}</span>
                                                    </div>
                                                    <div className="flex items-center space-x-2 shrink-0">
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-wide">Cooldown</span>
                                                        <select
                                                            value={config.cooldowns?.[cat.id] || cat.defaultCd}
                                                            onChange={(e) => updateConfig({ cooldowns: { [cat.id]: parseInt(e.target.value) } })}
                                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none h-7"
                                                        >
                                                            <option value="60">1m</option>
                                                            <option value="300">5m</option>
                                                            <option value="600">10m</option>
                                                            <option value="900">15m</option>
                                                            <option value="3600">1h</option>
                                                            <option value="14400">4h</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                {cat.isMTF && (
                                                    <div className="flex items-center space-x-4 pl-6">
                                                        {['15m', '1h', '4h'].map(tf => (
                                                            <label key={tf} className="flex items-center space-x-2 cursor-pointer group/tf">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={config.categories?.[`${cat.id}_${tf}`] ?? true}
                                                                    onChange={(e) => updateConfig({ categories: { [`${cat.id}_${tf}`]: e.target.checked } })}
                                                                    className="w-3.5 h-3.5 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 bg-slate-900"
                                                                />
                                                                <span className="text-[11px] font-bold text-slate-500 group-hover/tf:text-slate-300 transition-colors uppercase">{tf}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {/* Smart Alert Thresholds */}
                                        <div className="mt-4 border-t border-slate-800 pt-4">
                                            <div className="flex items-center space-x-2 mb-4">
                                                <Sliders className="w-4 h-4 text-indigo-400" />
                                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Dynamic Thresholds</span>
                                            </div>

                                            <div className="space-y-3">
                                                {[
                                                    { id: 'whaleMinAmount', label: 'Whale Min ($)', step: 50000, min: 100000, max: 10000000 },
                                                    { id: 'liquidationMinAmount', label: 'Liq Min ($)', step: 100000, min: 100000, max: 10000000 },
                                                    { id: 'oiSpikePercentage', label: 'OI Spike (%)', step: 0.1, min: 0.5, max: 5 },
                                                    { id: 'atrExpansionRatio', label: 'ATR Expansion (x)', step: 0.1, min: 1.1, max: 3.0 },
                                                    { id: 'rvolMultiplier', label: 'RVOL Multiplier (x)', step: 0.5, min: 1.5, max: 10 },
                                                    { id: 'rsiOverbought', label: 'RSI Overbought', step: 1, min: 60, max: 90 },
                                                    { id: 'rsiOversold', label: 'RSI Oversold', step: 1, min: 10, max: 40 },
                                                ].map(t => {
                                                    const value = config.thresholds ? (config.thresholds as any)[t.id] : 0;
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
                                                                onChange={(e) => updateConfig({ thresholds: { [t.id]: parseFloat(e.target.value) } } as any)}
                                                                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-slate-500 p-4">Loading configuration...</div>
                                )}
                            </div>
                        </div>

                        {/* Right Column: Alert Ledger */}
                        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 flex flex-col h-[800px]">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center">
                                    <Shield className="w-4 h-4 mr-2" /> Egress Ledger
                                </h2>
                                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Latest 50</span>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                                {history.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600 text-sm">
                                        <Trash2 className="w-8 h-8 mb-2 opacity-50" />
                                        <span>No egress logs found</span>
                                    </div>
                                ) : (
                                    history.map((item, i) => {
                                        // Localize the backend's explicit UTC time
                                        const d = new Date(item.timestamp);
                                        const timeStr = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                        const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

                                        let badgeColor = "bg-slate-500/20 text-slate-400 border-slate-500/30";
                                        if (item.category === 'oi_spike') badgeColor = "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
                                        if (item.category === 'atr_expand') badgeColor = "bg-amber-500/20 text-amber-400 border-amber-500/30";
                                        if (item.severity === 'critical') badgeColor = "bg-red-500/20 text-red-400 border-red-500/30";

                                        return (
                                            <div key={i} className="bg-slate-950 border border-slate-800 rounded p-3 text-sm hover:border-slate-700 transition-colors">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex items-center space-x-2">
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-bold ${badgeColor}`}>
                                                            {item.category}
                                                        </span>
                                                        <span className="font-bold text-slate-300">{item.symbol}</span>
                                                    </div>
                                                    <span className="text-xs text-slate-500 font-mono" title={item.timestamp}>
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
                )}
            </div>
            {/* Scoped CSS for scrollbar inside the ledger */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #334155;
                    border-radius: 10px;
                }
            `}</style>
        </div>
    );
}
