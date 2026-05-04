import { useTerminalStore } from '../store/useTerminalStore';

// We map out the returned types from the Market Context logic
export interface RegimeInfo {
    type: string;
    strength: string;
    text: string;
    color: string;
}

export interface VolatilityInfo {
    state: string;
    risk: string;
    ratio: number;
    color: string;
}

export interface DerivativesInfo {
    text: string;
    oiChangePct: number;
    significant: boolean;
    color: string;
}

export interface ExecutionInfo {
    spreadPct: number;
    spreadQuality: string;
}

export interface LevelInteractionInfo {
    text: string;
    color: string;
}

export interface MomentumInfo {
    macdBull: boolean | null;
    macdHistogram: number | null;
    stochRsiK: number | null;
    stochRsiD: number | null;
    stochState: 'Overbought' | 'Oversold' | 'Neutral' | null;
    bbWidth: number | null;
    bbSqueeze: boolean;
    oiPriceDivergence: 'Bearish Divergence' | 'Bullish Divergence' | null;
    text: string;
    color: string;
}

export interface MarketContextStateSlice {
    livePrices: ReturnType<typeof useTerminalStore.getState>['livePrices'];
    currentEMA21: ReturnType<typeof useTerminalStore.getState>['currentEMA21'];
    currentEMA50: ReturnType<typeof useTerminalStore.getState>['currentEMA50'];
    currentVWAP: ReturnType<typeof useTerminalStore.getState>['currentVWAP'];
    currentATR: ReturnType<typeof useTerminalStore.getState>['currentATR'];
    currentAtrSma: ReturnType<typeof useTerminalStore.getState>['currentAtrSma'];
    oiHistory: ReturnType<typeof useTerminalStore.getState>['oiHistory'];
    orderBook: ReturnType<typeof useTerminalStore.getState>['orderBook'];
    sessionPoc: ReturnType<typeof useTerminalStore.getState>['sessionPoc'];
    sessionVah: ReturnType<typeof useTerminalStore.getState>['sessionVah'];
    sessionVal: ReturnType<typeof useTerminalStore.getState>['sessionVal'];
    recentTrades: ReturnType<typeof useTerminalStore.getState>['recentTrades'];
    currentRSI: ReturnType<typeof useTerminalStore.getState>['currentRSI'];
    currentMACD: ReturnType<typeof useTerminalStore.getState>['currentMACD'];
    currentBB: ReturnType<typeof useTerminalStore.getState>['currentBB'];
    currentStochRSI: ReturnType<typeof useTerminalStore.getState>['currentStochRSI'];
}

const getContextInputs = (state: MarketContextStateSlice, symbol: string) => ({
    price: state.livePrices[symbol],
    ema21: state.currentEMA21[symbol],
    ema50: state.currentEMA50[symbol],
    vwap: state.currentVWAP[symbol],
    atr: state.currentATR[symbol],
    atrSma: state.currentAtrSma[symbol],
    oiHistory: state.oiHistory[symbol],
    orderBook: state.orderBook[symbol],
    sessionPoc: state.sessionPoc[symbol],
    sessionVah: state.sessionVah[symbol],
    sessionVal: state.sessionVal[symbol],
    recentTrades: state.recentTrades[symbol],
    rsi: state.currentRSI[symbol],
    macd: state.currentMACD[symbol],
    bb: state.currentBB[symbol],
    stochRsi: state.currentStochRSI[symbol],
});

// Extracted from MarketContext.tsx so it can be used headlessly by alerts
export function calculateMarketContextFromState(state: MarketContextStateSlice, symbol: string) {
    const {
        price,
        ema21,
        ema50,
        vwap,
        atr,
        atrSma,
        oiHistory,
        orderBook,
        sessionPoc,
        sessionVah,
        sessionVal,
        recentTrades,
        rsi,
        macd,
        bb,
        stochRsi,
    } = getContextInputs(state, symbol);

    // 1. Regime
    let regime: RegimeInfo = { type: 'Unknown', strength: 'Neutral', text: 'Gathering Data...', color: 'text-terminal-muted' };
    if (price && ema21 && ema50) {
        const pUp = price > ema21 && ema21 > ema50;
        const pDown = price < ema21 && ema21 < ema50;
        const separationPct = Math.abs((ema21 - ema50) / ema50) * 100;
        const isStrong = separationPct > 0.15;

        if (pUp) regime = { type: 'Uptrend', strength: isStrong ? 'Strong' : 'Weak', text: `Trending Up (${isStrong ? 'Strong' : 'Weak'})`, color: 'text-terminal-green' };
        else if (pDown) regime = { type: 'Downtrend', strength: isStrong ? 'Strong' : 'Weak', text: `Trending Down (${isStrong ? 'Strong' : 'Weak'})`, color: 'text-terminal-red' };
        else regime = { type: 'Range', strength: 'Neutral', text: 'Range Bound / Chop', color: 'text-terminal-muted' };
    }

    // 2. Volatility
    let volatility: VolatilityInfo = { state: 'Normal', risk: 'Low', ratio: 1, color: 'text-terminal-fg' };
    if (atr && atrSma) {
        const ratio = atr / atrSma;
        if (ratio < 0.75) volatility = { state: 'Compacting/Squeeze', risk: 'High', ratio, color: 'text-yellow-500' };
        else if (ratio > 1.25) volatility = { state: 'Expansion', risk: 'Medium', ratio, color: 'text-terminal-green' };
        else volatility = { state: 'Normal', risk: 'Low', ratio, color: 'text-terminal-fg' };
    }

    // 3. Derivatives 
    let derivatives: DerivativesInfo = { text: 'Gathering flow data...', color: 'text-terminal-muted', oiChangePct: 0, significant: false };
    if (oiHistory && oiHistory.length >= 2 && price) {
        const now = Date.now();
        const recent = oiHistory.filter(h => now - h.timestamp <= 15 * 60 * 1000);
        if (recent.length >= 2) {
            const oldest = recent[0];
            const newest = recent[recent.length - 1];
            const oiChangePct = ((newest.value - oldest.value) / oldest.value) * 100;
            const priceDir = ema21 && price > ema21 ? 1 : -1;

            const significant = Math.abs(oiChangePct) > 0.5;
            if (significant) {
                if (oiChangePct > 0 && priceDir > 0) derivatives = { text: 'Active Long Building', color: 'text-terminal-green', oiChangePct, significant };
                else if (oiChangePct > 0 && priceDir < 0) derivatives = { text: 'Active Short Building', color: 'text-terminal-red', oiChangePct, significant };
                else if (oiChangePct < 0 && priceDir > 0) derivatives = { text: 'Short Covering Rally', color: 'text-yellow-500', oiChangePct, significant };
                else if (oiChangePct < 0 && priceDir < 0) derivatives = { text: 'Long Liquidations', color: 'text-red-500', oiChangePct, significant };
            } else {
                derivatives = { text: 'No Major Flow Change', oiChangePct, significant, color: 'text-terminal-fg' };
            }
        } else {
            derivatives = { text: 'Flow stable', color: 'text-terminal-muted', oiChangePct: 0, significant: false };
        }
    }

    // 4. Execution
    let execution: ExecutionInfo | null = null;
    if (orderBook && orderBook.bids[0] && orderBook.asks[0] && price) {
        const spreadRaw = orderBook.asks[0].price - orderBook.bids[0].price;
        const spreadPct = (spreadRaw / price) * 100;
        let spreadQuality = 'Good';
        if (spreadPct > 0.05) spreadQuality = 'Poor (Wide)';
        else if (spreadPct < 0.01) spreadQuality = 'Tight';

        execution = { spreadPct, spreadQuality };
    }

    // 5. Level Interaction
    let levelInteraction: LevelInteractionInfo = { text: 'Scanning Levels...', color: 'text-terminal-muted' };
    if (price) {
        let microTrend = 'flat';
        if (recentTrades && recentTrades.length > 0) {
            const oldest = recentTrades[recentTrades.length - 1].price;
            if (price > oldest * 1.0001) microTrend = 'up';
            else if (price < oldest * 0.9999) microTrend = 'down';
        } else {
            microTrend = ema21 && price > ema21 ? 'up' : 'down';
        }

        const checkLevel = (level: number, name: string) => {
            if (!level) return null;
            const distToLevel = (price - level) / level * 100;
            const absDist = Math.abs(distToLevel);

            if (absDist <= 0.05) {
                if (name === 'POC') return { text: `Consolidating at POC`, color: 'text-yellow-500' };
                return { text: `Testing ${name}`, color: 'text-yellow-500' };
            }

            if (absDist <= 0.2) {
                if (level > price && microTrend === 'up') return { text: `Approaching ${name}`, color: 'text-terminal-fg' };
                if (level < price && microTrend === 'down') return { text: `Approaching ${name}`, color: 'text-terminal-fg' };
                if (level > price && microTrend === 'down') return { text: `Rejecting ${name}`, color: 'text-terminal-red' };
                if (level < price && microTrend === 'up') return { text: `Rejecting ${name}`, color: 'text-terminal-green' };
            }
            return null;
        }

        const levels = [];
        if (sessionPoc) levels.push({ price: sessionPoc, name: 'POC', isSup: price > sessionPoc });
        if (vwap) levels.push({ price: vwap, name: 'VWAP', isSup: price > vwap });

        let nearestDist = Infinity;
        let activeStatus = null;

        for (const lvl of levels) {
            const absDist = Math.abs(price - lvl.price) / lvl.price * 100;
            const status = checkLevel(lvl.price, lvl.name);
            if (status && absDist < nearestDist) {
                nearestDist = absDist;
                activeStatus = status;
            }
        }

        if (!activeStatus) {
            for (const lvl of levels) {
                const dist = (price - lvl.price) / lvl.price * 100;
                if (dist > 0 && dist < 0.1 && !lvl.isSup && microTrend === 'up') activeStatus = { text: `Breaking ${lvl.name}`, color: 'text-terminal-green' };
                if (dist < 0 && dist > -0.1 && lvl.isSup && microTrend === 'down') activeStatus = { text: `Breaking ${lvl.name}`, color: 'text-terminal-red' };
            }
        }
        levelInteraction = activeStatus || { text: 'In Vacuum (No Immediate Levels)', color: 'text-terminal-muted' };
    }

    // 6. Momentum (MACD + StochRSI + BB Squeeze + OI/Price Divergence)
    let momentum: MomentumInfo = {
        macdBull: null, macdHistogram: null,
        stochRsiK: null, stochRsiD: null, stochState: null,
        bbWidth: null, bbSqueeze: false,
        oiPriceDivergence: null,
        text: 'Gathering momentum data...', color: 'text-terminal-muted'
    };

    if (macd || bb || stochRsi) {
        const macdBull = macd ? macd.macd > macd.signal : null;
        const macdHistogram = macd ? macd.histogram : null;
        const stochRsiK = stochRsi ? stochRsi.k : null;
        const stochRsiD = stochRsi ? stochRsi.d : null;
        const bbWidth = bb ? bb.width : null;
        const bbSqueeze = bbWidth !== null && bbWidth < 2;

        let stochState: MomentumInfo['stochState'] = null;
        if (stochRsiK !== null) {
            if (stochRsiK > 80) stochState = 'Overbought';
            else if (stochRsiK < 20) stochState = 'Oversold';
            else stochState = 'Neutral';
        }

        // OI/Price divergence: price up but OI falling = bearish; price down but OI falling = bullish (short covering)
        let oiPriceDivergence: MomentumInfo['oiPriceDivergence'] = null;
        if (oiHistory && oiHistory.length >= 2 && price && ema21) {
            const recentOi = oiHistory.slice(-6);
            const oiTrendUp = recentOi[recentOi.length - 1].value > recentOi[0].value;
            const priceTrendUp = price > ema21;
            if (priceTrendUp && !oiTrendUp) oiPriceDivergence = 'Bearish Divergence';
            else if (!priceTrendUp && !oiTrendUp) oiPriceDivergence = 'Bullish Divergence';
        }

        // Summarize momentum text
        const signals: string[] = [];
        if (macdBull !== null) signals.push(macdBull ? 'MACD Bull' : 'MACD Bear');
        if (stochState === 'Overbought') signals.push('StochRSI OB');
        else if (stochState === 'Oversold') signals.push('StochRSI OS');
        if (bbSqueeze) signals.push('BB Squeeze');
        if (oiPriceDivergence) signals.push(oiPriceDivergence);

        const bullSignals = [macdBull === true, stochState === 'Oversold'].filter(Boolean).length;
        const bearSignals = [macdBull === false, stochState === 'Overbought'].filter(Boolean).length;

        momentum = {
            macdBull, macdHistogram, stochRsiK, stochRsiD, stochState,
            bbWidth, bbSqueeze, oiPriceDivergence,
            text: signals.length > 0 ? signals.join(' | ') : 'Neutral',
            color: bearSignals > bullSignals ? 'text-terminal-red' : bullSignals > bearSignals ? 'text-terminal-green' : 'text-terminal-fg'
        };
    }

    return {
        price,
        rsi,
        regime,
        volatility,
        derivatives,
        execution,
        levelInteraction,
        momentum,
        sessionPoc,
        sessionVah,
        sessionVal
    };
}

export function calculateMarketContext(symbol: string) {
    return calculateMarketContextFromState(useTerminalStore.getState(), symbol);
}
