import { useState, useEffect } from 'react';
import axios from 'axios';

export interface FearGreedData {
    value: string;
    value_classification: string;
    timestamp: string;
}

export function useFearGreedIndex() {
    const [data, setData] = useState<FearGreedData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await axios.get('https://api.alternative.me/fng/');
                if (res.data && res.data.data && res.data.data.length > 0) {
                    setData(res.data.data[0]);
                }
            } catch (error) {
                console.error('Failed to fetch Fear & Greed Index', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
        // Daily metric, refresh every hour
        const interval = setInterval(fetchStats, 3600000);
        return () => clearInterval(interval);
    }, []);

    return { data, loading };
}
