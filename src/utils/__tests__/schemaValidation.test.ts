import { describe, expect, it } from 'vitest';
import telegramConfigSchema from '../../../schemas/telegram-config.schema.json';
import { validateBySchemaWarnOnly } from '../schemaValidation';

describe('schemaValidation', () => {
    it('warns on unknown top-level keys', () => {
        const payload = {
            globalEnabled: true,
            activeSessions: ['US'],
            monitoredSymbols: ['BTCUSDT', { symbol: 'ETHUSDT', type: 'futures' }],
            alertOnStateChange: true,
            quietHours: { enabled: false, start: '22:00', end: '06:00' },
            categories: {},
            cooldowns: {},
            thresholds: {},
            timeframes: {},
            surprise: 'x',
        };

        const warnings = validateBySchemaWarnOnly(payload, telegramConfigSchema as any, { partial: false });
        expect(warnings.some((w) => w.includes("$.surprise"))).toBe(true);
    });

    it('does not warn for missing required keys when validating partial payload', () => {
        const partial = {
            quietHours: { enabled: true },
        };

        const warnings = validateBySchemaWarnOnly(partial, telegramConfigSchema as any, { partial: true });
        expect(warnings.some((w) => w.includes('missing required'))).toBe(false);
    });

    it('accepts the expanded threshold shape for all alert settings', () => {
        const payload = {
            globalEnabled: true,
            activeSessions: ['US'],
            monitoredSymbols: ['BTCUSDT'],
            alertOnStateChange: true,
            quietHours: { enabled: false, start: '22:00', end: '06:00' },
            categories: {
                macd_cross: true,
                bb_squeeze: true,
                bb_breakout: true,
                stoch_extreme: true,
                oi_divergence: true,
            },
            cooldowns: {
                macd_cross: 300,
                bb_squeeze: 600,
                bb_breakout: 600,
                stoch_extreme: 300,
                oi_divergence: 600,
            },
            thresholds: {
                global: {
                    whaleMinAmount: 500000,
                    liquidationMinAmount: 1000000,
                    oiSpikePercentage: 1.5,
                    fundingExtremeRate: 0.05,
                    atrExpansionRatio: 1.3,
                    whaleMomentumDelta: 5000000,
                    rvolMultiplier: 3.0,
                    rsiOverbought: 70,
                    rsiOversold: 30,
                    emaSeparationPct: 0.15,
                    macdFreshnessRatio: 0.1,
                    bbSqueezeWidthPct: 2.0,
                    stochOverbought: 85,
                    stochOversold: 15,
                    oiDivergenceLookbackBars: 6,
                },
            },
            timeframes: {
                macd_cross: ['1h', '4h'],
                bb_squeeze: ['1h', '4h'],
                bb_breakout: ['1h', '4h'],
                stoch_extreme: ['1h', '4h'],
                oi_divergence: ['1h', '4h'],
            },
        };

        const warnings = validateBySchemaWarnOnly(payload, telegramConfigSchema as any, { partial: false });
        expect(warnings).toEqual([]);
    });
});
