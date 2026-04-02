import { useEffect, useRef } from 'react';
import axios from 'axios';
import { useTerminalStore } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';
import { type MarketType } from '../constants/binance';

export function useOpenInterest(symbol: string, type: MarketType) {
    const setOpenInterest = useTerminalStore(state => state.setOpenInterest);
    const setFundingRate = useTerminalStore(state => state.setFundingRate);
    const setPredictedFunding = useTerminalStore(state => state.setPredictedFunding);
    const backfillFundingHistory = useTerminalStore(state => state.backfillFundingHistory);
    const setLongShortRatio = useTerminalStore(state => state.setLongShortRatio);
    const globalInterval = useTerminalStore(state => state.globalInterval);
    const isVisible = usePageVisibility();
    const hasBackfilled = useRef<Record<string, boolean>>({});

    useEffect(() => {
        if (!symbol || type !== 'futures') return;

        const symbolUpper = symbol.toUpperCase();

        const fetchMetrics = async () => {
            if (!isVisible) return;
            try {
                // Fetch Open Interest
                const response = await axios.get(`https://fapi.binance.com/fapi/v1/openInterest`, {
                    params: { symbol: symbolUpper }
                });
                if (response.data && response.data.openInterest) {
                    setOpenInterest(symbolUpper, parseFloat(response.data.openInterest));
                }

                // Fetch Funding Rate + next funding time + predicted rate from mark/index premium
                const frRes = await axios.get(`https://fapi.binance.com/fapi/v1/premiumIndex`, {
                    params: { symbol: symbolUpper }
                });
                if (frRes.data) {
                    const { lastFundingRate, nextFundingTime, markPrice, indexPrice } = frRes.data;
                    if (lastFundingRate) {
                        setFundingRate(symbolUpper, parseFloat(lastFundingRate));
                    }
                    // Predicted rate: 8h premium = (markPrice - indexPrice) / indexPrice
                    // Binance caps funding at ±0.75%
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

                // Backfill funding history once per symbol on first visible fetch
                if (!hasBackfilled.current[symbolUpper]) {
                    hasBackfilled.current[symbolUpper] = true;
                    try {
                        const histRes = await axios.get(`https://fapi.binance.com/fapi/v1/fundingRate`, {
                            params: { symbol: symbolUpper, limit: 48 }
                        });
                        if (Array.isArray(histRes.data) && histRes.data.length > 0) {
                            const history = histRes.data.map((r: { fundingTime: number; fundingRate: string }) => ({
                                timestamp: r.fundingTime,
                                value: parseFloat(r.fundingRate)
                            }));
                            backfillFundingHistory(symbolUpper, history);
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
                const lsRes = await axios.get(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio`, {
                    params: { symbol: symbolUpper, period: mappedPeriod }
                });
                if (lsRes.data && lsRes.data.length > 0) {
                    setLongShortRatio(symbolUpper, parseFloat(lsRes.data[0].longShortRatio));
                }
            } catch (error) {
                console.error('Failed to fetch futures metrics:', error);
            }
        };

        if (isVisible) {
            fetchMetrics();
        }

        const interval = setInterval(fetchMetrics, 60000);

        return () => clearInterval(interval);
    }, [symbol, setOpenInterest, setFundingRate, setPredictedFunding, backfillFundingHistory, setLongShortRatio, globalInterval, isVisible]);
}
