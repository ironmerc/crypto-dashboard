import { useEffect } from 'react';

import { calculateMarketContext } from '../lib/marketContextEngine';
import { sendTelegramAlert } from './useSmartAlerts';
import { usePageVisibility } from './usePageVisibility';

export function useMarketContextAlerts(symbol: string) {
    const isVisible = usePageVisibility();

    useEffect(() => {
        if (!symbol) return;

        // Broadcast the Market Context summary every 4 hours
        // 4 hours * 60 minutes * 60 seconds * 1000 milliseconds
        const interval = setInterval(() => {
            if (!isVisible) return;
            const context = calculateMarketContext(symbol);
            if (!context || !context.price) return;





            const title = `📊 [${symbol}] Market Context Summary`;
            const msg = `
*Regime:* ${context.regime.text}
*Volatility:* ${context.volatility.state} (${context.volatility.risk} Risk)
*Positioning:* ${context.derivatives.text}
*Execution:* Spread ${context.execution?.spreadQuality || 'Unknown'}
*Immediate Level:* ${context.levelInteraction.text}
            `.trim();

            sendTelegramAlert(title, msg, `MARKET_CONTEXT_${symbol}`, 4 * 60 * 60, 'market_context');

        }, 4 * 60 * 60 * 1000);

        return () => clearInterval(interval);
    }, [symbol]);
}
