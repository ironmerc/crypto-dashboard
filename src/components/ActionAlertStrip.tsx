import { useEffect, useState, useMemo } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { Zap, AlertTriangle, FishSymbol, Flame } from 'lucide-react';
import { format } from 'date-fns';

export function ActionAlertStrip() {
    const events = useTerminalStore(state => state.events);
    const [activeAlert, setActiveAlert] = useState<any>(null);

    // Get the most recent event
    const latestEvent = useMemo(() => {
        if (events.length === 0) return null;
        return events[events.length - 1]; // Assuming appended to end
    }, [events]);

    useEffect(() => {
        if (!latestEvent) return;

        let isWorthy = false;
        let expireMs = 5000;

        // Filter conditions for high-priority alerts
        if (latestEvent.type === 'SmartAlert') {
            isWorthy = true;
            expireMs = 8000; // Keep smart alerts visible a bit longer
        } else if (latestEvent.type === 'Whale' && latestEvent.value >= 5000000) {
            isWorthy = true;
        } else if (latestEvent.type === 'Liquidation' && latestEvent.value >= 5000000) {
            isWorthy = true;
        }

        if (isWorthy) {
            setActiveAlert(latestEvent);
            const timer = setTimeout(() => {
                setActiveAlert((current: any) => {
                    // Only clear if another alert hasn't overwritten it
                    if (current?.id === latestEvent.id) return null;
                    return current;
                });
            }, expireMs);
            return () => clearTimeout(timer);
        }
    }, [latestEvent]);

    if (!activeAlert) {
        return (
            <div className="bg-[#050505] border-y border-terminal-border/30 h-8 flex items-center justify-between px-4 font-mono text-[10px] text-terminal-muted overflow-hidden">
                <div className="flex items-center gap-2 opacity-50">
                    <div className="w-1.5 h-1.5 rounded-full bg-terminal-muted animate-pulse" />
                    SYSTEM NOMINAL // STANDBY FOR HIGH-PRIORITY ACTION ALERTS //
                </div>
            </div>
        );
    }

    let Icon = AlertTriangle;
    let title = 'SYSTEM ALERT';
    let detail = '';
    let bgPulse = 'bg-terminal-red/10';
    let textGlow = 'text-terminal-red';
    let borderTint = 'border-terminal-red/50';

    if (activeAlert.type === 'SmartAlert') {
        Icon = Zap;
        title = activeAlert.title || 'SMART ALERT';
        detail = activeAlert.message || '';

        const isNeutral = activeAlert.side === 'NEUTRAL';
        const isUp = activeAlert.side === 'LONG' || activeAlert.side === 'BUY';

        if (isNeutral) {
            bgPulse = 'bg-yellow-500/20';
            textGlow = 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]';
            borderTint = 'border-yellow-500/50';
        } else if (isUp) {
            bgPulse = 'bg-terminal-green/20';
            textGlow = 'text-terminal-green drop-shadow-[0_0_8px_rgba(0,255,65,0.5)]';
            borderTint = 'border-terminal-green/50';
        } else {
            bgPulse = 'bg-terminal-red/20';
            textGlow = 'text-terminal-red drop-shadow-[0_0_8px_rgba(255,51,51,0.5)]';
            borderTint = 'border-terminal-red/50';
        }
    } else if (activeAlert.type === 'Whale') {
        Icon = FishSymbol;
        const isBuy = activeAlert.side === 'BUY';
        title = isBuy ? 'MASSIVE BUY WALL / MARKET BUY' : 'MASSIVE SELL WALL / MARKET SELL';
        detail = `$${(activeAlert.value / 1000000).toFixed(2)}M @ ${activeAlert.price.toLocaleString()}`;

        if (isBuy) {
            bgPulse = 'bg-terminal-green/20';
            textGlow = 'text-terminal-green drop-shadow-[0_0_8px_rgba(0,255,65,0.5)]';
            borderTint = 'border-terminal-green/50';
        }
    } else if (activeAlert.type === 'Liquidation') {
        Icon = Flame;
        const isLiqShort = activeAlert.side === 'BUY';
        title = isLiqShort ? 'CASCADE: SHORT SQUEEZE' : 'CASCADE: LONG FLUSH';
        detail = `$${(activeAlert.value / 1000000).toFixed(2)}M Rekt @ ${activeAlert.price.toLocaleString()}`;

        if (isLiqShort) {
            bgPulse = 'bg-terminal-green/20';
            textGlow = 'text-terminal-green drop-shadow-[0_0_8px_rgba(0,255,65,0.5)]';
            borderTint = 'border-terminal-green/50';
        }
    }

    return (
        <div className={`h-8 flex items-center justify-between px-4 font-mono text-[10px] border-y ${borderTint} overflow-hidden transition-all duration-300 relative`}>
            {/* Background pulse */}
            <div className={`absolute inset-0 ${bgPulse} animate-pulse opacity-50`} />

            <div className="flex items-center gap-3 z-10 w-full relative">
                <div className={`flex items-center gap-2 font-bold tracking-widest ${textGlow}`}>
                    <Icon size={12} className="animate-pulse" />
                    <span>{title}</span>
                </div>

                <div className="w-px h-3 bg-white/20" />

                <div className="font-bold text-white flex-1 truncate">
                    {activeAlert.symbol.replace('USDT', '')} // {detail}
                </div>

                <div className="opacity-50 text-[9px] shrink-0">
                    {format(activeAlert.timestamp, 'HH:mm:ss.SSS')}
                </div>
            </div>
        </div>
    );
}
