import { useState, useEffect } from 'react';
import { usePageVisibility } from './usePageVisibility';

export interface FearGreedData {
    value: string;
    value_classification: string;
    timestamp: string;
}

export function useFearGreedIndex() {
    const [data, setData] = useState<FearGreedData | null>(null);
    const [loading, setLoading] = useState(true);
    const isVisible = usePageVisibility();

    useEffect(() => {
        // Bug fix #9: replaced axios with native fetch (removes heavy dependency)
        // Bug fix #10: AbortController prevents stale setState after unmount
        const controller = new AbortController();

        const fetchStats = async () => {
            // Bug fix #10: skip fetch when tab is hidden
            if (!isVisible) return;
            try {
                const res = await fetch('https://api.alternative.me/fng/', { signal: controller.signal });
                if (!res.ok) return;
                const json = await res.json();
                if (json?.data?.length > 0) {
                    setData(json.data[0]);
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') return;
                console.error('Failed to fetch Fear & Greed Index', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
        // Daily metric — refresh every hour
        const interval = setInterval(fetchStats, 3600000);
        return () => {
            controller.abort();
            clearInterval(interval);
        };
    }, [isVisible]);

    return { data, loading };
}
