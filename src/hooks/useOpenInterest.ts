import { useEffect } from 'react';
import axios from 'axios';
import { useTerminalStore } from '../store/useTerminalStore';

export function useOpenInterest(symbol: string) {
    const setOpenInterest = useTerminalStore(state => state.setOpenInterest);
    const setFundingRate = useTerminalStore(state => state.setFundingRate);
    const setLongShortRatio = useTerminalStore(state => state.setLongShortRatio);
    const globalInterval = useTerminalStore(state => state.globalInterval);

    useEffect(() => {
        if (!symbol) return;

        const symbolUpper = symbol.toUpperCase();

        const fetchMetrics = async () => {
            try {
                // Fetch Open Interest
                const response = await axios.get(`https://fapi.binance.com/fapi/v1/openInterest`, {
                    params: { symbol: symbolUpper }
                });
                if (response.data && response.data.openInterest) {
                    setOpenInterest(symbolUpper, parseFloat(response.data.openInterest));
                }

                // Fetch Funding Rate
                const frRes = await axios.get(`https://fapi.binance.com/fapi/v1/premiumIndex`, {
                    params: { symbol: symbolUpper }
                });
                if (frRes.data && frRes.data.lastFundingRate) {
                    setFundingRate(symbolUpper, parseFloat(frRes.data.lastFundingRate));
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

        // Initial fetch
        fetchMetrics();

        // Poll every 60 seconds (Binance rate limits apply to REST, so fetching 1/min is safe)
        const interval = setInterval(fetchMetrics, 60000);

        return () => clearInterval(interval);
    }, [symbol, setOpenInterest, setFundingRate, setLongShortRatio, globalInterval]);
}
