import { useState, useMemo, useEffect } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Terminal, Activity, ArrowUpRight, ArrowDownRight, Layers, Settings, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPrice } from '../utils/formatters';
import { useBinanceTickers } from '../hooks/useBinanceWebSocket';
import { useFearGreedIndex } from '../hooks/useFearGreedIndex';
import { CandleChart } from '../components/CandleChart';
import { OrderBook } from '../components/OrderBook';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useFuturesStream } from '../hooks/useFuturesStream';
import { useOpenInterest } from '../hooks/useOpenInterest';
import { useTerminalStore, type MonitoredSymbol } from '../store/useTerminalStore';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { EventFeed } from '../components/EventFeed';
import { VolumeTape } from '../components/VolumeTape';
import { FundingRateMonitor } from '../components/FundingRateMonitor';
import { MarketContext } from '../components/MarketContext';
import { ActionAlertStrip } from '../components/ActionAlertStrip';
import { useBackendAlerts } from '../hooks/useBackendAlerts';
import { useCoinbasePremium } from '../hooks/useCoinbasePremium';
import { useSectorBreadth } from '../hooks/useSectorBreadth';

function CoinbasePremiumRow({ symbol }: { symbol: string }) {
  const premium = useTerminalStore((s) => s.coinbasePremium[symbol]);
  if (premium === undefined) return null;
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-terminal-muted opacity-70">CB Premium</span>
      <span className={`font-mono font-bold ${premium > 0.05 ? 'text-terminal-green' : premium < -0.05 ? 'text-terminal-red' : 'text-terminal-fg'}`}>
        {premium > 0 ? '+' : ''}{premium.toFixed(3)}%
      </span>
    </div>
  );
}

function SectorBreadthRow() {
  const breadth = useTerminalStore((s) => s.sectorBreadth);
  if (!breadth || breadth.total === 0) return null;
  const vwapPct = Math.round((breadth.aboveVWAP / breadth.total) * 100);
  const emaPct = Math.round((breadth.aboveEMA21 / breadth.total) * 100);
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-terminal-muted opacity-70">Breadth</span>
      <div className="text-right font-mono">
        <span className={vwapPct >= 60 ? 'text-terminal-green' : vwapPct <= 40 ? 'text-terminal-red' : 'text-terminal-fg'}>VWAP {vwapPct}%</span>
        <span className="text-terminal-muted mx-1">·</span>
        <span className={emaPct >= 60 ? 'text-terminal-green' : emaPct <= 40 ? 'text-terminal-red' : 'text-terminal-fg'}>EMA {emaPct}%</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const monitoredSymbolsRaw = useTerminalStore((state) => state.telegramConfig.monitoredSymbols);
  const monitoredSymbols = useMemo(() => monitoredSymbolsRaw.map(m => {
    const rawSym = typeof m === 'string' ? m : m.symbol;
    const type = typeof m === 'string' ? 'futures' as const : m.type;
    let s = rawSym.toUpperCase().trim();
    if (s.length >= 3 && s.length <= 5 && !s.endsWith('USDT')) {
      s = `${s}USDT`;
    }
    return { symbol: s, type };
  }), [monitoredSymbolsRaw]);
  const [activeSymbolObj, setActiveSymbolObj] = useState<MonitoredSymbol>(monitoredSymbols[0] || { symbol: 'BTCUSDT', type: 'futures' });

  const { symbol: localActiveSymbol, type: activeType } = activeSymbolObj;

  // Ensure active symbol is always valid after removals
  useEffect(() => {
    const isValid = monitoredSymbols.some(s => s.symbol === localActiveSymbol && s.type === activeType);
    if (monitoredSymbols.length > 0 && !isValid) {
      setActiveSymbolObj(monitoredSymbols[0]);
    }
  }, [monitoredSymbols, localActiveSymbol, activeType]);


  // Current Tickers for WatchList
  const tickers = useBinanceTickers(monitoredSymbols);

  // Market Data Hooks
  const { data: fgData, loading: fgLoading } = useFearGreedIndex();

  const symbolNames = useMemo(() => monitoredSymbols.map(m => m.symbol), [monitoredSymbols]);

  // Market Data Streams
  useFuturesStream(activeSymbolObj, monitoredSymbols);
  useOpenInterest(localActiveSymbol, activeType);
  useBackendAlerts();
  useCoinbasePremium(symbolNames);
  useSectorBreadth(symbolNames);

  const openInterest = useTerminalStore((state) => state.openInterest[localActiveSymbol]);
  const oiHistory = useTerminalStore((state) => state.oiHistory[localActiveSymbol]);
  const currentPrice = useTerminalStore((state) => state.prices[localActiveSymbol]);
  const fundingRate = useTerminalStore((state) => state.fundingRate[localActiveSymbol]);
  const fundingHistory = useTerminalStore((state) => state.fundingHistory[localActiveSymbol]);
  const longShortRatio = useTerminalStore((state) => state.longShortRatio[localActiveSymbol]);
  const globalInterval = useTerminalStore((state) => state.globalInterval);
  const telegramConfig = useTerminalStore((state) => state.telegramConfig);

  const activeTicker = tickers[localActiveSymbol]; // Used for 24h change

  const getIntervalMs = (interval: string) => {
    switch (interval) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '30m': return 30 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '12h': return 12 * 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      case '1w': return 7 * 24 * 60 * 60 * 1000;
      case '1M': return 30 * 24 * 60 * 60 * 1000;
      default: return 5 * 60 * 1000;
    }
  };

  const calcDelta = (history: { timestamp: number, value: number }[] | undefined, currentValue: number | undefined, intervalMs: number, now: number) => {
    if (!history || history.length === 0 || currentValue === undefined) return null;
    const windowHistory = history.filter(h => now - h.timestamp <= intervalMs);
    if (windowHistory.length === 0) return 0;
    const oldestValue = windowHistory[0].value;
    if (oldestValue === 0) return 0;
    return ((currentValue - oldestValue) / Math.abs(oldestValue)) * 100;
  };

  const [renderTime, setRenderTime] = useState(() => Date.now());
  const isVisible = usePageVisibility();

  useEffect(() => {
    const timer = setInterval(() => {
      if (isVisible) setRenderTime(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, [isVisible]);

  const intervalMs = getIntervalMs(globalInterval);
  const { oiDelta, fundingDelta } = useMemo(() => {
    return {
      oiDelta: calcDelta(oiHistory, openInterest, intervalMs, renderTime),
      fundingDelta: calcDelta(fundingHistory, fundingRate, intervalMs, renderTime)
    };
  }, [oiHistory, openInterest, fundingHistory, fundingRate, intervalMs, renderTime]);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`dashboard-scale min-h-screen w-full bg-terminal-bg text-terminal-fg p-2 md:p-4 selection:bg-terminal-fg selection:text-black flex flex-col gap-4 ${isMobile ? 'overflow-x-hidden overflow-y-auto' : 'h-screen overflow-hidden'}`}>

      {/* HEADER */}
      <header className="flex flex-col lg:flex-row lg:items-center gap-3 border-b border-terminal-border/50 pb-3 shrink-0 bg-terminal-surface/30 backdrop-blur-md sticky top-0 z-50 px-2 md:px-4 pt-2 -mx-2 md:-mx-4">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6 text-terminal-fg animate-pulse shrink-0" />
          <h1 className="text-xl font-bold uppercase tracking-widest glow-text truncate">
            Crypto Terminal <span className="text-terminal-muted text-sm ml-2 hidden sm:inline">v2.1</span>
          </h1>
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded border border-terminal-blue/40 bg-terminal-blue/5 text-terminal-blue text-[10px] uppercase tracking-widest font-bold shrink-0">
            <Zap size={10} />
            MULTI-MARKET ENABLED
          </div>
        </div>
        <div className="lg:ml-auto flex flex-wrap items-center gap-2 md:gap-4 text-xs text-terminal-muted font-mono">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-terminal-surface/40 backdrop-blur-sm border border-terminal-border/60 shrink-0 shadow-sm hover:border-terminal-border transition-colors cursor-default">
            <span className={`w-2 h-2 rounded-full ${(telegramConfig && telegramConfig.globalEnabled) ? 'bg-terminal-green shadow-[0_0_8px_#00ff41]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`}></span>
            <span className="font-bold tracking-wider text-[10px]">{(telegramConfig && telegramConfig.globalEnabled) ? 'TG: ON' : 'TG: OFF'}</span>
          </div>

          <Link to="/settings" className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-terminal-surface/40 backdrop-blur-sm text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 transition-all border border-terminal-border/60 hover:border-terminal-green/50 text-[10px] uppercase font-bold tracking-wider shadow-sm">
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </Link>

          <Link to="/integrations/telegram" className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-terminal-surface/40 backdrop-blur-sm text-terminal-muted hover:text-terminal-fg hover:bg-terminal-border/40 transition-all border border-terminal-border/60 hover:border-terminal-fg/50 text-[10px] uppercase font-bold tracking-wider shadow-sm">
            <Settings className="w-3.5 h-3.5" />
            <span>Bot Settings</span>
          </Link>

          <div className="flex flex-wrap bg-terminal-surface/40 backdrop-blur-sm border border-terminal-border/60 rounded-md shadow-sm p-0.5 max-w-full overflow-x-auto scrollbar-none">
            {['1m', '5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w', '1M'].map(t => (
              <button
                key={t}
                onClick={() => useTerminalStore.getState().setGlobalInterval(t)}
                className={`px-2 py-1 rounded transition-colors text-[10px] shrink-0 ${globalInterval === t ? 'bg-[#fbbf24] text-black font-bold shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'text-terminal-text/50 hover:text-white hover:bg-white/10'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-terminal-fg shadow-[0_0_8px_#00ff41]"></span>
            <span className="hidden sm:inline">DATALINK ENCRYPTED</span>
          </span>
          <span className="border border-terminal-border/60 px-2.5 py-1.5 rounded-md bg-terminal-surface/40 backdrop-blur-sm shrink-0 shadow-sm font-mono font-bold text-terminal-muted">
            {new Date().toISOString().split('T')[0]}
          </span>
        </div>
      </header>

      <ActionAlertStrip />

      <main className={`flex flex-col gap-4 flex-grow w-full ${isMobile ? '' : 'min-h-0 overflow-hidden'}`}>
        {isMobile ? (
          <div className="flex flex-col gap-4 pr-1 mb-20 md:mb-0">
            <section className="panel flex flex-col gap-4 min-h-[400px]">
              <div className="flex flex-col gap-3">
                <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest flex items-center gap-2 border-b border-terminal-border/30 pb-2">
                  <Activity className="w-3 h-3" /> Market Pulse
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-terminal-muted opacity-70">Fear & Greed</span>
                    <span className={`font-bold ${parseInt(fgData?.value || '0') > 50 ? 'text-terminal-green' : 'text-terminal-red'}`}>{fgData?.value}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-terminal-muted opacity-70">OI Delta</span>
                    <span className={oiDelta && oiDelta > 0 ? 'text-terminal-green' : 'text-terminal-red'}>{oiDelta?.toFixed(2)}%</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest flex items-center gap-2 border-b border-terminal-border/30 pb-2">
                  <Layers className="w-3 h-3" /> Watchlist
                </h2>
                <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-none">
                  {monitoredSymbols.map((s) => (
                    <button
                      key={`${s.symbol}-${s.type}`}
                      onClick={() => setActiveSymbolObj(s)}
                      className={`px-3 py-2 rounded border text-xs whitespace-nowrap ${localActiveSymbol === s.symbol && activeType === s.type ? 'border-terminal-fg bg-[#00ff4111] text-terminal-fg' : 'border-terminal-border text-terminal-muted'}`}
                    >
                      {s.symbol?.replace('USDT', '')} <span className="opacity-50 text-[10px]">{s.type.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="panel min-h-[500px] relative flex flex-col">
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-lg font-bold uppercase tracking-tight">{localActiveSymbol?.replace('USDT', `/USDT-${activeType === 'futures' ? 'PERP' : 'SPOT'}`)}</h2>
                {currentPrice && <div className={`text-xl font-mono ${activeTicker && parseFloat(activeTicker.changePercent24h) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>{formatPrice(currentPrice)}</div>}
              </div>
              <div className="flex-grow h-[400px] w-full">
                <ErrorBoundary><CandleChart key={`${localActiveSymbol}-${activeType}`} symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
              </div>
            </section>

            <section className="panel min-h-[400px]">
              <ErrorBoundary><FundingRateMonitor key={`funding-mob-${localActiveSymbol}-${activeType}`} symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="panel min-h-[300px]">
                <ErrorBoundary><VolumeTape symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
              </section>
              <section className="panel min-h-[300px]">
                <ErrorBoundary><EventFeed symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
              </section>
            </div>

            <section className="panel min-h-[300px]">
              <ErrorBoundary><MarketContext symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
            </section>
            <section className="panel min-h-[400px]">
              <ErrorBoundary><OrderBook symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
            </section>
          </div>
        ) : (
          <PanelGroup orientation="horizontal">
            <Panel defaultSize={20} minSize={15} collapsible={true} className="flex flex-col gap-4">
              <PanelGroup orientation="vertical">
                <Panel defaultSize={35} minSize={20} className="panel flex flex-col gap-3 mb-4 overflow-y-auto scrollbar-thin">
                  <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest flex items-center gap-2 border-b border-terminal-border/30 pb-2">
                    <Activity className="w-3 h-3" /> Market Pulse
                  </h2>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-terminal-muted opacity-70">Fear & Greed</span>
                    {fgLoading ? <span className="animate-pulse">...</span> : <span className={`font-bold ${parseInt(fgData?.value || '0') > 50 ? 'text-terminal-green' : 'text-terminal-red'}`}>{fgData?.value}</span>}
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-terminal-muted opacity-70">Open Interest</span>
                    <div className="text-right">
                      <div className="font-mono text-terminal-fg">
                        {openInterest ? `$${(openInterest * (currentPrice || 0) / 1000000).toFixed(1)} M` : '--'}
                      </div>
                      {oiDelta !== null && (
                        <div className={`text-[9px] ${oiDelta > 0 ? 'text-terminal-green' : oiDelta < 0 ? 'text-terminal-red' : 'text-terminal-muted'}`}>
                          {oiDelta > 0 ? '+' : ''}{oiDelta.toFixed(2)}% ({globalInterval})
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-terminal-muted opacity-70">Funding Rate</span>
                    <div className="text-right">
                      <div className={`font-mono ${fundingRate && fundingRate > 0 ? 'text-terminal-green' : fundingRate && fundingRate < 0 ? 'text-terminal-red' : 'text-terminal-fg'}`}>
                        {fundingRate ? `${(fundingRate * 100).toFixed(4)}%` : '--'}
                      </div>
                      {fundingDelta !== null && (
                        <div className={`text-[9px] ${fundingDelta > 0 ? 'text-terminal-green' : fundingDelta < 0 ? 'text-terminal-red' : 'text-terminal-muted'}`}>
                          {fundingDelta > 0 ? '+' : ''}{fundingDelta.toFixed(2)}% ({globalInterval})
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-terminal-muted opacity-70">L/S Ratio ({globalInterval})</span>
                    <span className={`font-mono ${longShortRatio && longShortRatio > 1 ? 'text-terminal-green' : longShortRatio && longShortRatio < 1 ? 'text-terminal-red' : 'text-terminal-fg'}`}>
                      {longShortRatio ? longShortRatio.toFixed(2) : '--'}
                    </span>
                  </div>

                  <CoinbasePremiumRow symbol={localActiveSymbol} />
                  <SectorBreadthRow />
                </Panel>

                <PanelResizeHandle className="h-2 flex items-center justify-center cursor-row-resize bg-terminal-bg relative group my-1 z-10">
                  <div className="w-16 h-1 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
                </PanelResizeHandle>

                <Panel defaultSize={45} minSize={20} className="panel flex flex-col overflow-hidden mb-4">
                  <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest mb-3 flex items-center border-b border-terminal-border/30 pb-2 shrink-0">
                    <Layers className="w-3 h-3 mr-2" /> Market Watchlist
                  </h2>
                  <div className="flex-grow overflow-y-auto pr-1 space-y-1 scrollbar-thin">
                    {monitoredSymbols.map((s) => {
                      const isSelected = localActiveSymbol === s.symbol && activeType === s.type;
                      const t = tickers[s.symbol];
                      if (!t) return <div key={`${s.symbol}-${s.type}`} className="text-terminal-muted text-[10px] animate-pulse px-2 py-1.5">{s.symbol} {s.type} loading...</div>;
                      const isUp = parseFloat(t.changePercent24h) >= 0;

                      return (
                        <button
                          key={`${s.symbol}-${s.type}`}
                          onClick={() => setActiveSymbolObj(s)}
                          className={`w-full text-left px-2 py-1.5 rounded flex justify-between items-center transition-colors border text-xs ${isSelected
                            ? 'border-terminal-fg bg-terminal-green/10 glow-text'
                            : 'border-transparent hover:bg-terminal-border/30 text-terminal-muted opacity-70 hover:opacity-100'
                            }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-bold">{s.symbol?.replace('USDT', '')}</span>
                            <span className="text-[8px] opacity-60 uppercase">{s.type}</span>
                          </div>
                          <div className="text-right">
                            <div className={isSelected ? 'text-terminal-fg' : 'text-white'}>{t.price}</div>
                            <div className={`text-[9px] flex items-center justify-end ${isUp ? 'text-terminal-green' : 'text-terminal-red'}`}>
                              {isUp ? <ArrowUpRight className="w-2 h-2" /> : <ArrowDownRight className="w-2 h-2" />}
                              {Math.abs(parseFloat(t.changePercent24h)).toFixed(2)}%
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Panel>

                <PanelResizeHandle className="h-2 flex items-center justify-center cursor-row-resize bg-terminal-bg relative group my-1 z-10">
                  <div className="w-16 h-1 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
                </PanelResizeHandle>

                <Panel defaultSize={20} minSize={10} className="panel flex-grow overflow-y-auto scrollbar-thin min-h-[200px] lg:min-h-0">
                  <ErrorBoundary><VolumeTape key={`tape-${localActiveSymbol}-${activeType}`} symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle className="w-2 flex flex-col items-center justify-center cursor-col-resize bg-terminal-bg relative group mx-1 z-10">
              <div className="w-1 h-16 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
            </PanelResizeHandle>

            <Panel defaultSize={55} minSize={30} className="flex flex-col gap-4">
              <PanelGroup orientation="vertical">
                <Panel defaultSize={65} minSize={30} className="panel flex-grow relative overflow-hidden flex flex-col min-h-[400px] lg:min-h-0 mb-4">
                  <div className="absolute top-4 left-4 z-10 pointer-events-none flex items-end gap-3">
                    <h2 className="text-2xl font-bold uppercase tracking-widest flex items-center gap-3 bg-terminal-surface/40 backdrop-blur-md px-3 py-1 rounded-lg border border-terminal-border/40 shadow-sm">
                      {localActiveSymbol?.replace('USDT', `/USDT-${activeType === 'futures' ? 'PERP' : 'SPOT'}`)}
                    </h2>
                    {currentPrice && (
                      <div className={`text-2xl font-mono leading-none bg-terminal-surface/40 backdrop-blur-md px-3 py-1 rounded-lg border border-terminal-border/40 shadow-sm ${activeTicker && parseFloat(activeTicker.changePercent24h) >= 0 ? 'text-terminal-green glow-text' : 'text-terminal-red glow-red'}`}>
                        {formatPrice(currentPrice)}
                      </div>
                    )}
                  </div>
                  <div className="flex-grow w-full h-full mt-8">
                    <ErrorBoundary><CandleChart key={`${localActiveSymbol}-${activeType}`} symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
                  </div>
                </Panel>

                <PanelResizeHandle className="h-2 flex items-center justify-center cursor-row-resize bg-terminal-bg relative group my-1 z-10">
                  <div className="w-16 h-1 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
                </PanelResizeHandle>

                <Panel defaultSize={35} minSize={20} className="panel relative overflow-y-auto scrollbar-thin p-0 border-0 flex-shrink-0 min-h-[350px] lg:min-h-0">
                  <ErrorBoundary><FundingRateMonitor key={`funding-${localActiveSymbol}-${activeType}`} symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle className="w-2 flex flex-col items-center justify-center cursor-col-resize bg-terminal-bg relative group mx-1 z-10">
              <div className="w-1 h-16 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
            </PanelResizeHandle>

            <Panel defaultSize={25} minSize={15} collapsible={true} className="flex flex-col gap-4">
              <PanelGroup orientation="vertical">
                <Panel defaultSize={35} minSize={20} className="flex-grow flex flex-col min-h-[300px] lg:min-h-0 mb-4 overflow-y-auto scrollbar-thin">
                  <ErrorBoundary><MarketContext symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
                </Panel>

                <PanelResizeHandle className="h-2 flex items-center justify-center cursor-row-resize bg-terminal-bg relative group my-1 z-10">
                  <div className="w-16 h-1 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
                </PanelResizeHandle>

                <Panel defaultSize={30} minSize={15} className="flex-grow overflow-y-auto scrollbar-thin mb-4">
                  <ErrorBoundary><EventFeed symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
                </Panel>

                <PanelResizeHandle className="h-2 flex items-center justify-center cursor-row-resize bg-terminal-bg relative group my-1 z-10">
                  <div className="w-16 h-1 rounded-full bg-terminal-border group-hover:bg-terminal-fg/50 transition-colors" />
                </PanelResizeHandle>

                <Panel defaultSize={35} minSize={20} className="panel flex-grow flex flex-col overflow-y-auto scrollbar-thin">
                  <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest mb-2 border-b border-terminal-border/30 pb-2 flex justify-between">
                    <span>Order Book Depth (L2)</span>
                    <span className="text-terminal-fg/50 font-mono text-[9px]">{globalInterval} SYNC</span>
                  </h2>
                  <div className="flex-grow overflow-hidden">
                    <ErrorBoundary><OrderBook key={`${localActiveSymbol}-${activeType}`} symbol={localActiveSymbol} type={activeType} /></ErrorBoundary>
                  </div>
                </Panel>
              </PanelGroup>
            </Panel>
          </PanelGroup>
        )}
      </main>
    </div>
  );
}
