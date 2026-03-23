import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTerminalStore } from '../store/useTerminalStore';
import { sendTelegramAlert, getCurrentSession } from '../hooks/useSmartAlerts';
import { ShieldAlert, ArrowLeft, Activity, Clock, Bell, Sliders, Zap, Globe, Info } from 'lucide-react';
import { fetchConfigFromBot } from '../utils/syncConfig';

const ALL_TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];
const ALL_SESSIONS = ["London", "US", "Asia"];

// Categories that depend on specific candle intervals (MTF)
const TIMEFRAME_SUPPORTED_CATEGORIES = [
    'atr_expand',
    'context_summary',
    'ema_cross',
    'level_testing',
    'oi_spike',
    'order_flow',
    'rsi_extreme',
    'rvol_spike'
];

const HELP_CONTENT: Record<string, string> = {
    // Categories
    'atr_expand': 'Uses ATR Ratio to detect when price ranges are expanding rapidly (high risk) or contracting (breakout potential).',
    'context_summary': 'A state analyzer that alerts only when the combined Regime, Flow, and Volatility states shift.',
    'ema_cross': 'Identifies Trend vs. Range conditions based on EMA 21/50 crossovers and price positioning.',
    'extreme_funding': 'Alerts on unbalanced leverage. Extremely high/low rates increase the risk of cascading squeeze events.',
    'level_testing': 'Detects when price interacts with high-volume nodes like POC or technical anchors like VWAP.',
    'liquidation': 'Alerts on forced order closures. High clusters of liquidations often mark local price exhaustion.',
    'market_context': 'Periodic (4h) and Daily (24h) summaries of overall market health and cumulative flows.',
    'oi_spike': 'Monitors sudden leverage changes. Spikes suggest new aggressive positioning; Flushes suggest liquidations or mass profit-taking.',
    'order_flow': 'Combines Price and OI delta to identify Active Long Building vs Short Covering dynamics.',
    'rsi_extreme': 'Signals overbought (>70) or oversold (<30) conditions where momentum may be exhausted.',
    'rvol_spike': 'Alerts when volume is significantly higher than the 20-period average, indicating high conviction.',
    'whale': 'Tracks large individual orders and net flows. Can signal localized support/resistance or institutional aggression.',

    // Thresholds
    'atrExpansionRatio': 'The ratio of current candle range vs average range. 1.3x indicates significant volatility expansion.',
    'emaSeparationPct': 'The percentage gap between EMA 21 and 50 required to classify a trend as "Strong."',
    'fundingExtremeRate': 'The percentage rate at which funding is considered unbalanced (e.g., 0.05% per 8h).',
    'liquidationMinAmount': 'The minimum dollar volume of a forced order to trigger a Liquidation notification.',
    'oiSpikePercentage': 'The percentage change in Open Interest over a 5-minute rolling window required for an alert.',
    'rsiOverbought': 'The RSI level above which the market is considered over-extended and vulnerable to a pullback.',
    'rsiOversold': 'The RSI level below which the market is considered oversold and potential for a relief bounce.',
    'whaleMinAmount': 'The minimum dollar volume required to trigger a individual Whale Trade notification.',
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
                className="p-1 hover:text-terminal-blue text-terminal-muted/50 transition-colors"
            >
                <Info className="w-3 h-3" />
            </button>
            {show && (
                <div className="absolute z-[100] bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-terminal-surface border border-terminal-border rounded shadow-2xl animate-in fade-in zoom-in duration-200">
                    <p className="text-[10px] text-terminal-fg/80 font-mono leading-relaxed pointer-events-none">
                        {content}
                    </p>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-terminal-border"></div>
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

    const [status, setStatus] = useState<BotStatus>({ status: 'unreachable' });
    const [history, setHistory] = useState<{ timestamp: string; symbol: string; category: string; severity: string; message: string; }[]>([]);
    const [selectedTest, setSelectedTest] = useState('oi_spike');
    const [editingSymbol, setEditingSymbol] = useState('global');
    const [activeTab, setActiveTab] = useState<'general' | 'alerts' | 'diagnostics'>('general');

    // Safety check: if currently editing a symbol that was removed elsewhere, reset to 'global'
    useEffect(() => {
        if (editingSymbol !== 'global') {
            const stillExists = config.monitoredSymbols?.some(m => 
                (typeof m === 'string' ? m : m.symbol) === editingSymbol
            );
            if (!stillExists) {
                setEditingSymbol('global');
            }
        }
    }, [config.monitoredSymbols, editingSymbol]);

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

    const fireMockAlert = async (type: string, inputCategory: string) => {
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
                title = `[BTCUSDT] 🌋 Volume Surge (RVOL)`;
                message = "<b>RVOL Spike:</b> 4.2x Average\n<b>Dominant Pressure:</b> 🟢 Buying\n<b>5m Volume:</b> $24.5M\n\n<i>Extremely high activity detected.</i>";
                category = "rvol_spike";
                break;
            case 'ema_cross':
                title = `[BTCUSDT] 🟢 Trend Stretch (Regime Shift)`;
                message = "<b>Bias:</b> Range → Uptrend (Strong)\n<b>RSI:</b> 62.5\n<b>EMA Sep:</b> 0.45%\n\n<i>Price is stretching away from the mean, indicating a strong trend.</i>";
                category = "ema_cross";
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
            case 'rsi_extreme':
                title = `[BTCUSDT] 🎢 RSI Extreme Detected`;
                message = "<b>Status:</b> 🔴 OVERBOUGHT\n<b>Current RSI:</b> 74.2\n<b>Threshold:</b> 70\n<b>Timeframe:</b> 1h\n\n<i>Price is extended. Potential for mean reversion.</i>";
                category = "rsi_extreme";
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
        <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-terminal-bg text-terminal-fg font-mono antialiased">
            <div className="layout-container flex h-full grow flex-col">
                <header className="flex items-center justify-between whitespace-nowrap border-b border-terminal-border px-6 md:px-10 py-4 bg-terminal-surface/30 backdrop-blur-md sticky top-0 z-50">
                    <div className="flex items-center gap-4">
                        <div className="text-terminal-blue animate-pulse w-8 h-8 flex items-center justify-center bg-terminal-blue/10 rounded-lg border border-terminal-blue/20 shadow-[0_0_10px_rgba(0,242,255,0.2)]">
                            <ShieldAlert className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg md:text-xl font-bold leading-tight tracking-tight hidden sm:block">Godmode Futures v2.0</h2>
                    </div>
                    <div className="flex flex-1 justify-end gap-4 md:gap-8">
                        <div className="flex items-center gap-3">
                            <Link to="/" className="flex items-center justify-center rounded-lg h-9 md:h-10 px-4 md:px-5 bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/30 transition-all text-xs md:text-sm font-bold shadow-[0_0_15px_rgba(0,242,255,0.1)] hover:shadow-[0_0_20px_rgba(0,242,255,0.2)]">
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Back to Dashboard
                            </Link>
                        </div>
                    </div>
                </header>

                <main className="flex flex-col flex-1 max-w-[960px] mx-auto w-full px-4 md:px-6 py-8">
                    {/* Navigation Tabs */}
                    <div className="flex mb-8">
                        <div className="flex h-12 flex-1 items-center justify-center rounded-xl bg-terminal-surface/40 border border-terminal-border/60 p-1 backdrop-blur-sm shadow-sm">
                            <label className="flex cursor-pointer h-full grow items-center justify-center rounded-lg px-2 has-[:checked]:bg-terminal-blue/20 has-[:checked]:text-terminal-blue has-[:checked]:border has-[:checked]:border-terminal-blue/50 text-terminal-muted hover:text-terminal-fg text-xs md:text-sm font-medium transition-all">
                                <span>General</span>
                                <input className="hidden" name="nav-tabs" type="radio" value="general" checked={activeTab === 'general'} onChange={() => setActiveTab('general')} />
                            </label>
                            <label className="flex cursor-pointer h-full grow items-center justify-center rounded-lg px-2 has-[:checked]:bg-terminal-blue/20 has-[:checked]:text-terminal-blue has-[:checked]:border has-[:checked]:border-terminal-blue/50 text-terminal-muted hover:text-terminal-fg text-xs md:text-sm font-medium transition-all">
                                <span>Alerts</span>
                                <input className="hidden" name="nav-tabs" type="radio" value="alerts" checked={activeTab === 'alerts'} onChange={() => setActiveTab('alerts')} />
                            </label>
                            <label className="flex cursor-pointer h-full grow items-center justify-center rounded-lg px-2 has-[:checked]:bg-terminal-blue/20 has-[:checked]:text-terminal-blue has-[:checked]:border has-[:checked]:border-terminal-blue/50 text-terminal-muted hover:text-terminal-fg text-xs md:text-sm font-medium transition-all">
                                <Activity className="w-4 h-4 mr-1 md:mr-2" />
                                <span>Diagnostics</span>
                                <input className="hidden" name="nav-tabs" type="radio" value="diagnostics" checked={activeTab === 'diagnostics'} onChange={() => setActiveTab('diagnostics')} />
                            </label>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 mb-8 px-2">
                        <Zap className="w-6 h-6 md:w-8 md:h-8 text-terminal-blue drop-shadow-[0_0_8px_rgba(0,242,255,0.4)]" />
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-terminal-fg">Telegram Operations</h1>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-8 w-full custom-scrollbar">
                        {!config || !config.thresholds ? (
                            <div className="max-w-4xl mx-auto flex flex-col items-center justify-center h-64 bg-terminal-surface/50 rounded-xl border border-dashed border-terminal-border">
                                <ShieldAlert className="w-12 h-12 text-terminal-red mb-4 opacity-50" />
                                <h2 className="text-lg font-bold text-terminal-fg mb-2">Configuration State Error</h2>
                                <p className="text-terminal-muted text-sm max-w-md text-center font-mono">Telegram configuration or thresholds are missing from the store.</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-6 px-4 py-2 bg-terminal-blue hover:bg-terminal-blue text-terminal-fg rounded-md text-sm font-bold transition-colors shadow-lg"
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
                                            {/* Connection Status Panel */}
                                            <section className="rounded-xl border border-terminal-border bg-terminal-surface/40 p-6 backdrop-blur-md relative overflow-hidden group">
                                                <div className="absolute top-0 left-0 w-1 h-full bg-terminal-blue shadow-[0_0_10px_var(--color-accent)]"></div>
                                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pl-4">
                                                    <div className="flex flex-col gap-3">
                                                        <h3 className="text-sm font-semibold flex items-center gap-2 text-terminal-fg">
                                                            <Activity className="w-4 h-4 text-terminal-muted" /> Connection Status
                                                        </h3>
                                                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 font-mono text-sm">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-terminal-muted">Backend Link:</span>
                                                                {status.status === 'online' ? (
                                                                    <span className="flex items-center gap-2 text-emerald-400">
                                                                        <span className="relative flex h-2.5 w-2.5">
                                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                                                                        </span>
                                                                        ONLINE
                                                                    </span>
                                                                ) : (
                                                                    <span className="flex items-center gap-2 text-red-500">
                                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                                                        OFFLINE
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-terminal-muted">Target Identity:</span>
                                                                <span className="text-terminal-blue bg-terminal-blue/10 px-2 py-0.5 rounded border border-terminal-blue/20">
                                                                    @{status.bot_username || '---'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>

                                            {/* Strategy Egress Section */}
                                            <section>
                                                <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] mb-4 flex items-center mt-2">
                                                    <Activity className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Strategy Egress Controls
                                                </h3>
                                                <div className="grid gap-4">
                                                    <div className="rounded-xl border border-terminal-border bg-terminal-surface/40 p-5 flex items-center justify-between backdrop-blur-sm transition-all hover:bg-terminal-surface/60">
                                                        <div>
                                                            <p className="font-medium text-terminal-fg text-sm">Master Broadcast Toggle</p>
                                                            <p className="text-[10px] text-terminal-muted mt-1 max-w-[200px]">Enable/disable all signal broadcasts.</p>
                                                        </div>
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={config.globalEnabled || false}
                                                                onChange={(e) => updateConfig({ globalEnabled: e.target.checked })}
                                                            />
                                                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terminal-blue shadow-[0_0_10px_var(--color-accent)_inset]"></div>
                                                        </label>
                                                    </div>

                                                    <div className="rounded-xl border border-terminal-border bg-terminal-surface/40 p-5 flex items-center justify-between backdrop-blur-sm transition-all hover:bg-terminal-surface/60">
                                                        <div>
                                                            <p className="font-medium text-terminal-fg text-sm">System State Shift Alerts</p>
                                                            <p className="text-[10px] text-terminal-muted mt-1 max-w-[200px]">Alert when global market regime or volatility regime changes.</p>
                                                        </div>
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={config.alertOnStateChange || false}
                                                                onChange={(e) => updateConfig({ alertOnStateChange: e.target.checked })}
                                                            />
                                                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terminal-blue shadow-[0_0_10px_var(--color-accent)_inset]"></div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </section>

                                            <section>
                                                <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] mb-4 flex items-center mt-2">
                                                    <Globe className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Active Sessions
                                                </h3>
                                                <div className="bg-terminal-surface/40 border border-terminal-border rounded-xl p-6 backdrop-blur-sm relative overflow-hidden">
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
                                                                    <div className="w-10 h-5 bg-terminal-border rounded-full peer peer-checked:bg-terminal-blue/50 transition-colors"></div>
                                                                    <div className="absolute top-1 left-1 w-3 h-3 bg-slate-500 rounded-full peer-checked:translate-x-5 peer-checked:bg-terminal-blue transition-all"></div>
                                                                </div>
                                                                <span className="text-xs font-bold text-terminal-muted group-hover:text-slate-200 transition-colors">{session}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                    <p className="text-[10px] text-terminal-muted/50 mt-4 leading-relaxed italic">
                                                        * Alerts will only be egressed to Telegram during these active trading windows.
                                                    </p>
                                                </div>
                                            </section>
                                        </div>

                                        {/* Right Side: Assets & Time */}
                                        <div className="space-y-8">

                                            <section>
                                                <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] mb-4 flex items-center mt-8">
                                                    <Clock className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Quiet Hours
                                                </h3>
                                                <div className="bg-terminal-surface/40 border border-terminal-border/60 rounded-xl p-6 backdrop-blur-sm transition-all hover:bg-terminal-surface/60">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <div>
                                                            <h4 className="text-terminal-fg font-bold text-sm">Silent Mode</h4>
                                                            <p className="text-[10px] text-terminal-muted mt-1">Suppress alerts during specific windows.</p>
                                                        </div>
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={config.quietHours?.enabled || false}
                                                                onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, enabled: e.target.checked } })}
                                                            />
                                                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terminal-blue shadow-[0_0_10px_var(--color-accent)_inset]"></div>
                                                        </label>
                                                    </div>
                                                    {config.quietHours?.enabled && (
                                                        <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                                                            <div>
                                                                <label className="block text-[10px] font-bold text-terminal-muted/70 mb-2 uppercase tracking-wider">Start</label>
                                                                <input
                                                                    type="time"
                                                                    value={config.quietHours?.start || "22:00"}
                                                                    onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, start: e.target.value } })}
                                                                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs md:text-sm text-terminal-blue outline-none focus:border-terminal-blue focus:ring-1 focus:ring-terminal-blue/50 transition-all font-mono"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] font-bold text-terminal-muted/70 mb-2 uppercase tracking-wider">End</label>
                                                                <input
                                                                    type="time"
                                                                    value={config.quietHours?.end || "06:00"}
                                                                    onChange={(e) => updateConfig({ quietHours: { ...config.quietHours, end: e.target.value } })}
                                                                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs md:text-sm text-terminal-blue outline-none focus:border-terminal-blue focus:ring-1 focus:ring-terminal-blue/50 transition-all font-mono"
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
                                            <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] mb-4 flex items-center mt-2">
                                                <Bell className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Alert Subscriptions
                                            </h3>

                                            <div className="bg-terminal-surface/40 border border-terminal-border rounded-xl p-6 backdrop-blur-sm h-full hover:border-terminal-border/80 transition-all">
                                                <div className="space-y-6">
                                                    {/* Subscription groups implementation... */}
                                                    {['atr_expand', 'context_summary', 'ema_cross', 'extreme_funding', 'level_testing', 'liquidation', 'market_context', 'oi_spike', 'order_flow', 'rsi_extreme', 'rvol_spike', 'whale'].map(id => (
                                                        <div key={id} className="p-4 bg-terminal-bg/50 border border-terminal-border/60 hover:border-terminal-blue/30 rounded-xl space-y-4 transition-all hover:shadow-[0_0_15px_var(--color-accent)_10]">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center space-x-3">
                                                                    <div className={`w-2 h-2 rounded-full ${(config.categories?.[id] ?? true) ? 'bg-terminal-blue shadow-[0_0_8px_var(--color-accent)_80]' : 'bg-slate-700'}`}></div>
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
                                                                    <div className="w-10 h-5.5 bg-terminal-surface border border-terminal-border rounded-full peer peer-checked:bg-terminal-blue/20 peer-checked:border-terminal-blue/50 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-terminal-muted after:rounded-full after:h-4.5 after:w-4.5 after:shadow-sm after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-terminal-blue shadow-[0_0_10px_var(--color-accent)_inset_0]"></div>
                                                                </label>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-terminal-border/30">
                                                                {TIMEFRAME_SUPPORTED_CATEGORIES.includes(id) && (
                                                                    <div className="flex-1 min-w-[200px]">
                                                                        <label className="block text-[9px] font-bold text-terminal-muted/70 uppercase tracking-widest mb-2 px-1">Active Timeframes</label>
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
                                                                                            ? "bg-terminal-blue/20 border-terminal-blue/50 text-terminal-fg ring-1 ring-terminal-blue/20 shadow-[0_0_10px_var(--color-accent)_20]"
                                                                                            : "bg-terminal-surface border-terminal-border text-terminal-muted/70 hover:border-terminal-blue/30 hover:text-terminal-fg"
                                                                                            }`}
                                                                                    >
                                                                                        {tf}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div className="w-20">
                                                                    <label className="block text-[9px] font-bold text-terminal-muted/70 uppercase tracking-widest mb-2 px-1 text-center">Cooldown</label>
                                                                    <select
                                                                        value={config.cooldowns?.[id] || 300}
                                                                        onChange={(e) => updateConfig({ cooldowns: { ...config.cooldowns, [id]: parseInt(e.target.value) } })}
                                                                        className="w-full bg-terminal-surface/80 border border-terminal-border rounded px-1.5 py-1.5 text-[10px] text-terminal-blue font-bold outline-none focus:border-terminal-blue hover:border-terminal-blue/50 transition-colors cursor-pointer"
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
                                            <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] mb-4 flex items-center mt-2">
                                                <Sliders className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Sensitivity Parameters
                                            </h3>

                                            <div className="bg-terminal-surface/40 border border-terminal-border rounded-xl p-6 backdrop-blur-sm hover:border-terminal-border/80 transition-all">
                                                <div className="space-y-6">
                                                    <div className="mb-6 p-4 bg-terminal-bg/30 border border-terminal-blue/20 rounded-lg shadow-[0_0_15px_var(--color-accent)_10]">
                                                        <label className="block text-[10px] font-bold text-terminal-blue mb-2 uppercase tracking-wider flex items-center">
                                                            <Activity className="w-3 h-3 mr-1.5" /> Edit Target
                                                        </label>
                                                        <select
                                                            value={editingSymbol}
                                                            onChange={(e) => setEditingSymbol(e.target.value)}
                                                            className="w-full bg-terminal-surface border border-terminal-blue/50 rounded-lg px-3 py-2 text-xs md:text-sm text-terminal-fg focus:border-terminal-blue focus:ring-1 focus:ring-terminal-blue/50 outline-none transition-all cursor-pointer font-bold"
                                                        >
                                                            <option value="global">Global Defaults</option>
                                                            {config.monitoredSymbols?.map(m => {
                                                                const s = typeof m === 'string' ? m : m.symbol;
                                                                const type = typeof m === 'string' ? 'futures' : m.type;
                                                                return <option key={`${s}-${type}`} value={s}>{s} ({type.toUpperCase()}) Overrides</option>;
                                                            })}
                                                        </select>
                                                    </div>

                                                    <div className="space-y-8">
                                                        {/* ATR Range Surge */}
                                                        <div>
                                                            <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                            />
                                                            <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                <span>1.0x</span>
                                                                <span className="text-terminal-blue font-bold">{config.thresholds?.[editingSymbol]?.atrExpansionRatio || config.thresholds?.global?.atrExpansionRatio || 1.3}x</span>
                                                                <span>5.0x</span>
                                                            </div>
                                                        </div>

                                                        {/* Extreme Funding */}
                                                        <div>
                                                            <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                            />
                                                            <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                <span>0.01%</span>
                                                                <span className="text-terminal-blue font-bold">{config.thresholds?.[editingSymbol]?.fundingExtremeRate || config.thresholds?.global?.fundingExtremeRate || 0.05}%</span>
                                                                <span>0.5%</span>
                                                            </div>
                                                        </div>

                                                        {/* Liq. Event Floor */}
                                                        <div>
                                                            <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                            />
                                                            <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                <span>10k</span>
                                                                <span className="text-terminal-blue font-bold">${((config.thresholds?.[editingSymbol]?.liquidationMinAmount || config.thresholds?.global?.liquidationMinAmount || 1000000) / 1000000).toFixed(1)}M</span>
                                                                <span>10M</span>
                                                            </div>
                                                        </div>

                                                        {/* OI Surge */}
                                                        <div>
                                                            <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                            />
                                                            <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                <span>0.1%</span>
                                                                <span className="text-terminal-blue font-bold">{config.thresholds?.[editingSymbol]?.oiSpikePercentage || config.thresholds?.global?.oiSpikePercentage || 1.5}%</span>
                                                                <span>10%</span>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4 border-t border-terminal-border/50">
                                                            {/* RSI Overbought */}
                                                            <div>
                                                                <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                    className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                                />
                                                                <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                    <span>50</span>
                                                                    <span className="text-emerald-400 font-bold">{config.thresholds?.[editingSymbol]?.rsiOverbought || config.thresholds?.global?.rsiOverbought || 70}</span>
                                                                    <span>90</span>
                                                                </div>
                                                            </div>

                                                            {/* RSI Oversold */}
                                                            <div>
                                                                <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                    className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-red-500"
                                                                />
                                                                <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                    <span>10</span>
                                                                    <span className="text-red-400 font-bold">{config.thresholds?.[editingSymbol]?.rsiOversold || config.thresholds?.global?.rsiOversold || 30}</span>
                                                                    <span>50</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4 border-t border-terminal-border/50">
                                                            {/* Trend Stretch */}
                                                            <div>
                                                                <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                    className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                                />
                                                                <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                    <span>0.05%</span>
                                                                    <span className="text-terminal-blue font-bold">{config.thresholds?.[editingSymbol]?.emaSeparationPct || config.thresholds?.global?.emaSeparationPct || 0.15}%</span>
                                                                    <span>1.0%</span>
                                                                </div>
                                                            </div>

                                                            {/* Volume Surge */}
                                                            <div>
                                                                <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
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
                                                                    className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                                />
                                                                <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                    <span>1.0x</span>
                                                                    <span className="text-terminal-blue font-bold">{config.thresholds?.[editingSymbol]?.rvolMultiplier || config.thresholds?.global?.rvolMultiplier || 3.0}x</span>
                                                                    <span>10.0x</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="pt-4 border-t border-terminal-border/50">
                                                            {/* Whale Net Aggression Floor */}
                                                            <div>
                                                                <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
                                                                    Whale Net Aggression Floor ($) <InfoTooltip id="whaleMomentumDelta" />
                                                                </label>
                                                                <input
                                                                    type="range"
                                                                    min="100000"
                                                                    max="500000000"
                                                                    step="100000"
                                                                    value={config.thresholds?.[editingSymbol]?.whaleMomentumDelta || config.thresholds?.global?.whaleMomentumDelta || 5000000}
                                                                    onChange={(e) => {
                                                                        const val = parseInt(e.target.value);
                                                                        const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                        updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, whaleMomentumDelta: val } } });
                                                                    }}
                                                                    className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                                />
                                                                <input
                                                                    type="number"
                                                                    min="100000"
                                                                    max="1000000000"
                                                                    step="100000"
                                                                    value={config.thresholds?.[editingSymbol]?.whaleMomentumDelta || config.thresholds?.global?.whaleMomentumDelta || 5000000}
                                                                    onChange={(e) => {
                                                                        const val = parseInt(e.target.value);
                                                                        if (Number.isNaN(val)) return;
                                                                        const bounded = Math.max(100000, Math.min(1000000000, val));
                                                                        const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                        updateConfig({ thresholds: { ...config.thresholds, [editingSymbol]: { ...current, whaleMomentumDelta: bounded } } });
                                                                    }}
                                                                    className="w-full mt-2 px-3 py-2 rounded border border-terminal-border bg-terminal-surface text-terminal-fg font-mono text-xs"
                                                                />
                                                                <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                    <span>100k</span>
                                                                    <span className="text-terminal-blue font-bold">${(config.thresholds?.[editingSymbol]?.whaleMomentumDelta || config.thresholds?.global?.whaleMomentumDelta || 5000000).toLocaleString()}</span>
                                                                    <span>500M</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="pt-4 border-t border-terminal-border/50">
                                                            {/* Whale Trade Floor */}
                                                            <div>
                                                                <label className="flex items-center text-[10px] font-bold text-terminal-muted/70 mb-3 uppercase tracking-wider">
                                                                    Whale Trade Floor ($) <InfoTooltip id="whaleMinAmount" />
                                                                </label>
                                                                <input
                                                                    type="range"
                                                                    min="10000"
                                                                    max="100000000"
                                                                    step="50000"
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
                                                                    className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-blue"
                                                                />
                                                                <input
                                                                    type="number"
                                                                    min="10000"
                                                                    max="1000000000"
                                                                    step="50000"
                                                                    value={config.thresholds?.[editingSymbol]?.whaleMinAmount || config.thresholds?.global?.whaleMinAmount || 500000}
                                                                    onChange={(e) => {
                                                                        const val = parseInt(e.target.value);
                                                                        if (Number.isNaN(val)) return;
                                                                        const bounded = Math.max(10000, Math.min(1000000000, val));
                                                                        const current = config.thresholds?.[editingSymbol] || config.thresholds?.global;
                                                                        updateConfig({
                                                                            thresholds: {
                                                                                ...config.thresholds,
                                                                                [editingSymbol]: { ...current, whaleMinAmount: bounded }
                                                                            }
                                                                        });
                                                                    }}
                                                                    className="w-full mt-2 px-3 py-2 rounded border border-terminal-border bg-terminal-surface text-terminal-fg font-mono text-xs"
                                                                />
                                                                <div className="flex justify-between mt-2 font-mono text-[10px] text-terminal-muted">
                                                                    <span>10k</span>
                                                                    <span className="text-terminal-blue font-bold">${((config.thresholds?.[editingSymbol]?.whaleMinAmount || config.thresholds?.global?.whaleMinAmount || 500000) / 1000000).toFixed(1)}M</span>
                                                                    <span>100M</span>
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
                                            <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] mb-4 flex items-center mt-2">
                                                <ShieldAlert className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Validation Suite
                                            </h3>
                                            <div className="bg-terminal-surface/40 border border-terminal-border rounded-xl p-6 backdrop-blur-sm hover:border-terminal-border/80 transition-all flex flex-col h-full shadow-[0_0_15px_rgba(0,0,0,0.2)]">
                                                <p className="text-[11px] text-terminal-muted mb-6">Execute diagnostic egress to verify bot connectivity and payload rendering.</p>
                                                <div className="space-y-4 flex-1">
                                                    <select
                                                        value={selectedTest}
                                                        onChange={(e) => setSelectedTest(e.target.value)}
                                                        className="w-full bg-terminal-bg/50 border border-terminal-border rounded-lg px-3 py-3 text-xs md:text-sm text-terminal-fg/80 focus:border-terminal-blue focus:ring-1 focus:ring-terminal-blue/50 outline-none cursor-pointer transition-all shadow-inner"
                                                    >
                                                        <option value="atr_expand">ATR Expansion (Volatility)</option>
                                                        <option value="context_summary">Context Summary Shift</option>
                                                        <option value="ema_cross">Trend Stretch (Regime Shift)</option>
                                                        <option value="level_testing">Level Interaction (POC/VWAP)</option>
                                                        <option value="liquidation">Liquidations (Forced Orders)</option>
                                                        <option value="market_context_summary">Market Wrap/Daily Summary</option>
                                                        <option value="oi_spike">OI Spike/Flush (Leverage)</option>
                                                        <option value="order_flow">Order Flow Shift (Aggression)</option>
                                                        <option value="ping">System Connectivity Ping</option>
                                                        <option value="rsi_extreme">RSI Extreme (Overbought/Oversold)</option>
                                                        <option value="rvol">Volume Surge (RVOL Spike)</option>
                                                        <option value="whale">Whale Activity (Individual Blocks)</option>
                                                    </select>
                                                </div>
                                                <button
                                                    onClick={() => fireMockAlert(selectedTest, selectedTest)}
                                                    disabled={!config.globalEnabled}
                                                    className="w-full mt-auto bg-terminal-blue/20 hover:bg-terminal-blue/30 disabled:opacity-50 disabled:hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/50 text-xs md:text-sm font-bold py-3.5 rounded-lg shadow-[0_0_15px_var(--color-accent)_10] hover:shadow-[0_0_20px_var(--color-accent)_20] active:scale-[0.98] transition-all flex items-center justify-center space-x-2 disabled:cursor-not-allowed group"
                                                >
                                                    <Zap className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                                    <span>Fire Mock Alert</span>
                                                </button>
                                            </div>
                                        </section>

                                        {/* Egress Ledger */}
                                        <section className="lg:col-span-2 space-y-4 flex flex-col min-h-0">
                                            <div className="flex justify-between items-center mt-2 mb-0">
                                                <h3 className="text-[10px] font-bold text-terminal-muted/70 uppercase tracking-[0.2em] flex items-center">
                                                    <Activity className="w-3.5 h-3.5 mr-2 text-terminal-blue" /> Egress Ledger
                                                </h3>
                                                <span className="text-[10px] text-terminal-muted/70 bg-terminal-surface/40 px-2.5 py-1 rounded-md border border-terminal-border/80 shadow-sm">Latest 50</span>
                                            </div>

                                            <div className="bg-terminal-surface/40 border border-terminal-border rounded-xl p-4 backdrop-blur-sm flex-1 overflow-y-auto custom-scrollbar hover:border-terminal-border/80 transition-all shadow-[0_0_15px_rgba(0,0,0,0.2)]">
                                                {(!history || history.length === 0) ? (
                                                    <div className="h-full flex flex-col items-center justify-center text-terminal-muted/50 opacity-50">
                                                        <Activity className="w-8 h-8 mb-3" />
                                                        <p className="text-[11px] font-mono tracking-wider uppercase">No recent activity detected</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3 pr-2">
                                                        {history.map((item, i) => (
                                                            <div key={i} className="bg-terminal-bg/60 border border-terminal-border/80 rounded-lg p-3.5 text-[11px] animate-in fade-in slide-in-from-right-2 duration-300 hover:border-terminal-blue/30 hover:shadow-[0_0_10px_var(--color-accent)_10] transition-all group">
                                                                <div className="flex justify-between items-start mb-2.5">
                                                                    <div className="flex items-center space-x-2.5">
                                                                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border tracking-wider shadow-sm ${item.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-terminal-blue/10 text-terminal-blue border-terminal-blue/30'
                                                                            }`}>
                                                                            {item.category}
                                                                        </span>
                                                                        <span className="font-bold text-terminal-fg tracking-tight">{item.symbol}</span>
                                                                    </div>
                                                                    <span className="text-terminal-muted/60 font-mono text-[10px] group-hover:text-terminal-muted transition-colors">
                                                                        {new Date(item.timestamp).toLocaleTimeString()}
                                                                    </span>
                                                                </div>
                                                                <p className="text-terminal-muted leading-relaxed font-mono line-clamp-2 md:line-clamp-none pl-1 border-l-2 border-terminal-border/50 group-hover:border-terminal-blue/30 transition-colors">{item.message}</p>
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
                </main>
            </div>
        </div>
    );
}
