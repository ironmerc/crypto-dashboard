import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTerminalStore } from '../store/useTerminalStore';
import { Settings, ShieldAlert, ArrowLeft, Send, Activity, Clock, Bell, Trash2, Shield, Radio } from 'lucide-react';

interface BotStatus {
    status: 'online' | 'offline' | 'unreachable';
    bot_username?: string;
    target_chat_id?: string;
    last_message_timestamp?: string;
    server_time_utc?: string;
}

interface AlertHistoryItem {
    timestamp: string;
    symbol: string;
    category: string;
    severity: string;
    message: string;
}

interface TelegramConfig {
    globalEnabled: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
    categories: Record<string, boolean>;
    cooldowns: Record<string, number>;
}

export default function TelegramSettings() {
    const updateConfig = useTerminalStore((state) => state.updateTelegramConfig);

    const [config, setConfig] = useState<TelegramConfig | null>(() => useTerminalStore.getState().telegramConfig);
    const [status, setStatus] = useState<BotStatus>({ status: 'unreachable' });
    const [history, setHistory] = useState<AlertHistoryItem[]>([]);

    const [testMessage, setTestMessage] = useState('This is a manual test from the ops console.');
    const [testSeverity, setTestSeverity] = useState('INFO');

    useEffect(() => {
        const unsub = useTerminalStore.subscribe((state) => {
            setConfig(state.telegramConfig);
        });
        return () => unsub();
    }, []);

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

    const sendTestAlert = async () => {
        try {
            const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/alert';
            await fetch(botUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `<b>🚨 [TEST] ${testSeverity}</b>\n\n${testMessage}`,
                    type: `TEST_${testSeverity}`,
                    severity: testSeverity.toLowerCase(),
                    symbol: 'SYSTEM',
                    cooldown: 0,
                    category: 'test_ping'
                })
            });
            // Give it a second to process, then re-fetch history
            setTimeout(() => {
                const evt = new Event('refreshHistory');
                window.dispatchEvent(evt); // Or just call fetchHistory directly if we refactored
            }, 1000);
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

                        {/* Manual Test Controls */}
                        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
                            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                <Radio className="w-4 h-4 mr-2" /> Diagnostics Drop
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Severity</label>
                                    <select
                                        value={testSeverity}
                                        onChange={e => setTestSeverity(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500">
                                        <option value="INFO">INFO (Trace)</option>
                                        <option value="WARNING">WARNING (Degraded)</option>
                                        <option value="CRITICAL">CRITICAL (System Fault)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Payload Message</label>
                                    <textarea
                                        value={testMessage}
                                        onChange={e => setTestMessage(e.target.value)}
                                        rows={3}
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                                    />
                                </div>
                                <button
                                    onClick={sendTestAlert}
                                    className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded text-sm transition-colors"
                                >
                                    <Send className="w-4 h-4" />
                                    <span>Fire Diagnostic Payload</span>
                                </button>
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
                            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                                <Bell className="w-4 h-4 mr-2" /> Subscription Channels
                            </h2>
                            {config ? (
                                <div className="space-y-2">
                                    {[
                                        { id: 'oi_spike', label: 'Open Interest Spikes/Flushes', defaultCd: 600 },
                                        { id: 'wall', label: 'Orderbook Wall Approaching', defaultCd: 900 },
                                        { id: 'atr_expand', label: 'ATR Volatility Expansion', defaultCd: 300 },
                                        { id: 'whale', label: 'Whale Trap/Absorption', defaultCd: 60 },
                                    ].map(cat => (
                                        <div key={cat.id} className="flex items-center justify-between p-3 border border-slate-800/50 hover:bg-slate-800/20 rounded transition-colors group">
                                            <div className="flex-1 min-w-0 pr-4">
                                                <div className="flex items-center space-x-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={config.categories?.[cat.id] ?? true}
                                                        onChange={(e) => updateConfig({ categories: { [cat.id]: e.target.checked } })}
                                                        className="w-4 h-4 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 bg-slate-900"
                                                    />
                                                    <span className="text-sm font-medium text-slate-300 truncate">{cat.label}</span>
                                                </div>
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
                                    ))}
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
                                    if (item.category === 'wall') badgeColor = "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30";
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
