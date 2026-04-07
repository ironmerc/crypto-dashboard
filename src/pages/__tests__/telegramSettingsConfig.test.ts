import { describe, expect, it } from 'vitest';
import {
    ALERT_CATEGORY_IDS,
    ALERT_THRESHOLD_IDS,
    TIMEFRAME_SUPPORTED_CATEGORIES,
} from '../telegramSettingsConfig';

describe('telegram settings config', () => {
    it('includes every active alert category in the settings surface', () => {
        expect(ALERT_CATEGORY_IDS).toEqual(expect.arrayContaining([
            'macd_cross',
            'bb_squeeze',
            'bb_breakout',
            'stoch_extreme',
            'oi_divergence',
        ]));
        expect(ALERT_CATEGORY_IDS).not.toEqual(expect.arrayContaining([
            'context_summary',
            'market_context',
            'order_flow',
        ]));
    });

    it('marks every timeframe-driven category as configurable', () => {
        expect(TIMEFRAME_SUPPORTED_CATEGORIES).toEqual(expect.arrayContaining([
            'macd_cross',
            'bb_squeeze',
            'bb_breakout',
            'stoch_extreme',
            'oi_divergence',
        ]));
        expect(TIMEFRAME_SUPPORTED_CATEGORIES).not.toEqual(expect.arrayContaining([
            'context_summary',
            'order_flow',
        ]));
    });

    it('includes threshold controls for the new alert sensitivities', () => {
        expect(ALERT_THRESHOLD_IDS).toEqual(expect.arrayContaining([
            'macdFreshnessRatio',
            'bbSqueezeWidthPct',
            'stochOverbought',
            'stochOversold',
            'oiDivergenceLookbackBars',
        ]));
    });
});
