import { useState } from 'react';
import { Terminal, Activity, ArrowUpRight, ArrowDownRight, Layers } from 'lucide-react';
import { useBinanceTickers } from './hooks/useBinanceWebSocket';
import { useFearGreedIndex } from './hooks/useFearGreedIndex';
import { CandleChart } from './components/CandleChart';
import { OrderBook } from './components/OrderBook';
import { ErrorBoundary } from './components/ErrorBoundary';

// Futures Imports
import { useFuturesStream } from './hooks/useFuturesStream';
import { useOpenInterest } from './hooks/useOpenInterest';
import { useSmartAlerts } from './hooks/useSmartAlerts';
import { useTerminalStore } from './store/useTerminalStore';
import { EventFeed } from './components/EventFeed';
import { VolumeTape } from './components/VolumeTape';
import { LiquidityIntelligence } from './components/LiquidityIntelligence';
import { MarketContext } from './components/MarketContext';
import { ActionAlertStrip } from './components/ActionAlertStrip';

export default function App() {
  const [activeSymbol, setActiveSymbol] = useState('BTCUSDT');
  const watchSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT'];

  // Current Spot Tickers for WatchList
  const tickers = useBinanceTickers(watchSymbols);

  // Market Data Hooks
  const { data: fgData, loading: fgLoading } = useFearGreedIndex();

  // Futures Hooks (Intel Engine)
  useFuturesStream(activeSymbol, watchSymbols);
  useOpenInterest(activeSymbol);
  useSmartAlerts(activeSymbol);
  const openInterest = useTerminalStore(state => state.openInterest[activeSymbol]);
  const oiHistory = useTerminalStore(state => state.oiHistory[activeSymbol]);
  const futuresPrice = useTerminalStore(state => state.prices[activeSymbol]);
  const fundingRate = useTerminalStore(state => state.fundingRate[activeSymbol]);
  const fundingHistory = useTerminalStore(state => state.fundingHistory[activeSymbol]);
  const longShortRatio = useTerminalStore(state => state.longShortRatio[activeSymbol]);
  const globalInterval = useTerminalStore(state => state.globalInterval);

  const activeTicker = tickers[activeSymbol]; // Used for 24h change

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

  // Calculate Delta based on global timeframe
  const calcDelta = (history: { timestamp: number, value: number }[] | undefined, currentValue: number | undefined, intervalMs: number) => {
    if (!history || history.length === 0 || currentValue === undefined) return null;
    const now = Date.now();
    const windowHistory = history.filter(h => now - h.timestamp <= intervalMs);
    if (windowHistory.length === 0) return 0;

    // The first item in the filtered array is the oldest valid record
    const oldestValue = windowHistory[0].value;
    if (oldestValue === 0) return 0;
    return ((currentValue - oldestValue) / Math.abs(oldestValue)) * 100;
  };

  const intervalMs = getIntervalMs(globalInterval);
  const oiDelta = calcDelta(oiHistory, openInterest, intervalMs);
  const fundingDelta = calcDelta(fundingHistory, fundingRate, intervalMs);

  return (
    <div className="h-screen w-full bg-[#050505] text-terminal-text p-4 selection:bg-terminal-fg selection:text-black flex flex-col gap-4 overflow-hidden">

      {/* HEADER */}
      <header className="flex items-center gap-3 border-b border-terminal-border/50 pb-3 shrink-0">
        <Terminal className="w-6 h-6 text-terminal-fg animate-pulse" />
        <h1 className="text-xl font-bold uppercase tracking-widest glow-text">
          Godmode Futures <span className="text-terminal-muted text-sm ml-2">v2.0</span>
        </h1>
        <div className="ml-auto flex items-center gap-4 text-xs text-terminal-muted hidden md:flex font-mono">
          {/* Global Timeframe Selector */}
          <div className="flex bg-[#0a0a0a] border border-terminal-border/30 rounded overflow-hidden shadow-lg p-0.5">
            {['1m', '5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w', '1M'].map(t => (
              <button
                key={t}
                onClick={() => useTerminalStore.getState().setGlobalInterval(t)}
                className={`px-2 py-1 rounded transition-colors text-[10px] ${globalInterval === t ? 'bg-[#fbbf24] text-black font-bold shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'text-terminal-text/50 hover:text-white hover:bg-white/10'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-terminal-fg shadow-[0_0_8px_#00ff41]"></span>
            DATALINK ENCRYPTED
          </span>
          <span className="border border-terminal-border/30 px-2 py-1 rounded bg-[#0a0a0a]">
            {new Date().toISOString().split('T')[0]}
          </span>
        </div>
      </header>

      {/* ACTION ALERT STRIP */}
      <ActionAlertStrip />

      {/* MAIN GRID */}
      <main className="grid grid-cols-12 grid-rows-6 gap-4 flex-grow min-h-0">

        {/* --- LEFT SIDEBAR (Col 1-2) --- */}
        <section className="col-span-2 row-span-6 flex flex-col gap-4">
          <div className="panel flex flex-col gap-3 shrink-0">
            <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest flex items-center gap-2 border-b border-terminal-border/30 pb-2">
              <Activity className="w-3 h-3" /> Market Pulse
            </h2>

            <div className="flex justify-between items-center text-xs">
              <span className="text-terminal-muted opacity-70">Fear & Greed</span>
              {fgLoading ? (
                <span className="animate-pulse">...</span>
              ) : (
                <span className={`font-bold ${parseInt(fgData?.value || '0') > 50 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                  {fgData?.value}
                </span>
              )}
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-terminal-muted opacity-70">Open Interest</span>
              <div className="text-right">
                <div className="font-mono text-terminal-fg">
                  {openInterest ? `$${(openInterest * (futuresPrice || 0) / 1000000).toFixed(1)}M` : '--'}
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
          </div>

          <div className="panel flex flex-col overflow-hidden shrink-0" style={{ flexBasis: '40%' }}>
            <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest mb-3 flex items-center gap-2 border-b border-terminal-border/30 pb-2 shrink-0">
              <Layers className="w-3 h-3" /> Watchlist
            </h2>
            <div className="flex-grow overflow-y-auto pr-1 space-y-1 scrollbar-thin">
              {watchSymbols.map((sym) => {
                const isSelected = activeSymbol === sym;
                const t = tickers[sym];
                if (!t) return <div key={sym} className="text-terminal-muted text-[10px] animate-pulse">{sym} loading...</div>;

                const isUp = parseFloat(t.changePercent24h) >= 0;

                return (
                  <button
                    key={sym}
                    onClick={() => setActiveSymbol(sym)}
                    className={`w-full text-left px-2 py-1.5 rounded flex justify-between items-center transition-colors border text-xs ${isSelected
                      ? 'border-terminal-fg bg-[#00ff4111] glow-text'
                      : 'border-transparent hover:bg-terminal-border/30 text-terminal-muted opacity-70 hover:opacity-100'
                      }`}
                  >
                    <span className="font-bold">{sym.replace('USDT', '')}</span>
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
          </div>

          <div className="panel flex-grow overflow-hidden">
            <VolumeTape key={`tape-${activeSymbol}`} symbol={activeSymbol} />
          </div>
        </section>

        {/* --- CENTER AREA: Chart & Heatmap (Col 3-9) --- */}
        <section className="col-span-7 row-span-6 flex flex-col gap-4">

          {/* Main Chart */}
          <div className="panel flex-grow relative overflow-hidden flex flex-col" style={{ flexBasis: '55%' }}>
            <div className="absolute top-4 left-4 z-10 pointer-events-none flex items-end gap-3">
              <h2 className="text-2xl font-bold uppercase tracking-widest flex items-center gap-3 bg-black/50 px-2 rounded">
                {activeSymbol.replace('USDT', '/USDT-PERP')}
              </h2>
              {futuresPrice && (
                <div className={`text-2xl font-mono leading-none bg-black/50 px-2 rounded ${activeTicker && parseFloat(activeTicker.changePercent24h) >= 0 ? 'text-terminal-green glow-text' : 'text-terminal-red glow-red'}`}>
                  {futuresPrice.toFixed(2)}
                </div>
              )}
            </div>

            <div className="flex-grow w-full h-full mt-8">
              <ErrorBoundary>
                <CandleChart key={activeSymbol} symbol={activeSymbol} />
              </ErrorBoundary>
            </div>
          </div>

          {/* Liquidity Intelligence (Bottom) */}
          <div className="panel relative overflow-hidden p-0 border-0 flex-shrink-0" style={{ flexBasis: '350px', minHeight: '350px' }}>
            <LiquidityIntelligence key={`intel-${activeSymbol}`} symbol={activeSymbol} />
          </div>

        </section>

        {/* --- RIGHT SIDEBAR: OrderBook & EventFeed & Context (Col 10-12) --- */}
        <section className="col-span-3 row-span-6 flex flex-col gap-4">

          {/* Market Context (Top) */}
          <div className="flex-grow overflow-hidden flex flex-col" style={{ flexBasis: '40%', minHeight: '300px' }}>
            <MarketContext symbol={activeSymbol} />
          </div>

          {/* Smart Event Feed (Middle) */}
          <div className="flex-grow overflow-hidden" style={{ flexBasis: '30%' }}>
            <EventFeed symbol={activeSymbol} />
          </div>

          {/* Order Book Depth (Bottom) */}
          <div className="panel flex-grow flex flex-col overflow-hidden" style={{ flexBasis: '30%' }}>
            <h2 className="text-[10px] uppercase text-terminal-muted font-bold tracking-widest mb-2 border-b border-terminal-border/30 pb-2 flex justify-between">
              <span>Order Book Depth (L2)</span>
              <span className="text-terminal-fg/50 font-mono text-[9px]">{globalInterval} SYNC</span>
            </h2>
            <div className="flex-grow overflow-hidden">
              <OrderBook key={activeSymbol} symbol={activeSymbol} />
            </div>
          </div>

        </section>

      </main>
    </div>
  );
}
