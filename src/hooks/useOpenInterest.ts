import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';
import { BINANCE_ENDPOINTS, type MarketType } from '../constants/binance';

const { REST: FREST, PATHS: FP } = BINANCE_ENDPOINTS.FUTURES;

export function useOpenInterest(symbol: string, type: MarketType) {
    const setOpenInterest = useTerminalStore(state => state.setOpenInterest);
    const setFundingRate = useTerminalStore(state => state.setFundingRate);
    const setPredictedFunding = useTerminalStore(state => state.setPredictedFunding);
    const backfillFundingHistory = useTerminalStore(state => state.backfillFundingHistory);
    const setLongShortRatio = useTerminalStore(state => state.setLongShortRatio);
    const globalInterval = useTerminalStore(state => state.globalInterval);
    // Bug fix #2: include isVisible in the dep array so the closure is fresh on tab restore
    const isVisible = usePageVisibility();
    const hasBackfilled = useRef<Record<string, boolean>>({});

    useEffect(() => {
        if (!symbol || type !== 'futures') return;

        const symbolUpper = symbol.toUpperCase();
        // Bug fix #1: AbortController prevents stale symbol responses writing to wrong symbol
        const controller = new AbortController();
        const { signal } = controller;

        const fetchMetrics = async () => {
            if (!isVisible) return;
            try {
                // Fetch Open Interest
                const oiRes = await fetch(
                    `${FREST}${FP.OPEN_INTEREST}?symbol=${symbolUpper}`,
                    { signal }
                );
                if (oiRes.ok) {
                    const oiData = await oiRes.json();
                    // Guard: symbol may have changed while fetch was in-flight
                    if (oiData?.openInterest && oiData.symbol === symbolUpper) {
                        setOpenInterest(symbolUpper, parseFloat(oiData.openInterest));
                    }
                }

                // Fetch Funding Rate + next funding time + predicted rate
                const frRes = await fetch(
                    `${FREST}${FP.PREMIUM_INDEX}?symbol=${symbolUpper}`,
                    { signal }
                );
                if (frRes.ok) {
                    const frData = await frRes.json();
                    if (frData) {
                        const { lastFundingRate, nextFundingTime, markPrice, indexPrice } = frData;
                        if (lastFundingRate) {
                            setFundingRate(symbolUpper, parseFloat(lastFundingRate));
                        }
                        if (markPrice && indexPrice) {
                            const mark = parseFloat(markPrice);
                            const index = parseFloat(indexPrice);
                            if (index > 0) {
                                const premium = (mark - index) / index;
                                const predicted = Math.max(-0.0075, Math.min(0.0075, premium));
                                setPredictedFunding(symbolUpper, predicted, nextFundingTime ? parseInt(nextFundingTime) : 0);
                            }
                        } else if (nextFundingTime) {
                            setPredictedFunding(symbolUpper, 0, parseInt(nextFundingTime));
                        }
                    }
                }

                // Backfill funding history once per symbol
                if (!hasBackfilled.current[symbolUpper]) {
                    hasBackfilled.current[symbolUpper] = true;
                    try {
                        const histRes = await fetch(
                            `${FREST}${FP.FUNDING_RATE}?symbol=${symbolUpper}&limit=48`,
                            { signal }
                        );
                        if (histRes.ok) {
                            const histData = await histRes.json();
                            if (Array.isArray(histData) && histData.length > 0) {
                                const history = histData.map((r: { fundingTime: number; fundingRate: string }) => ({
                                    timestamp: r.fundingTime,
                                    value: parseFloat(r.fundingRate),
                                }));
                                backfillFundingHistory(symbolUpper, history);
                            }
                        }
                    } catch {
                        // backfill is best-effort
                    }
                }

                // Map globalInterval to valid Binance period
                let mappedPeriod = '5m';
                if (['15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'].includes(globalInterval)) {
                    mappedPeriod = globalInterval;
                } else if (['1w', '1M'].includes(globalInterval)) {
                    mappedPeriod = '1d';
                }

                // Fetch L/S Ratio
                const lsRes = await fetch(
                    `${FREST}${FP.LONG_SHORT_RATIO}?symbol=${symbolUpper}&period=${mappedPeriod}`,
                    { signal }
                );
                if (lsRes.ok) {
                    const lsData = await lsRes.json();
                    if (Array.isArray(lsData) && lsData.length > 0) {
                        setLongShortRatio(symbolUpper, parseFloat(lsData[0].longShortRatio));
                    }
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') return;
                console.error('Failed to fetch futures metrics:', error);
            }
        };

        if (isVisible) {
            fetchMetrics();
        }

        const interval = setInterval(fetchMetrics, 60000);

        return () => {
            controller.abort();
            clearInterval(interval);
        };
    // Bug fix #2: isVisible now in dep array so closure refreshes on tab restore
    }, [symbol, type, isVisible, setOpenInterest, setFundingRate, setPredictedFunding, backfillFundingHistory, setLongShortRatio, globalInterval]);
}
