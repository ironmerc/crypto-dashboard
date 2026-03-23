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
});

