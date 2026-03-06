import { describe, expect, it } from 'vitest';
import { parseBotHistoryMessage } from '../useBackendAlerts';

describe('useBackendAlerts parser', () => {
    it('strips HTML and removes session line from body', () => {
        const parsed = parseBotHistoryMessage(
            '<b>🚨 [BTCUSDT] Flow Shift (15m)</b>\n\n<b>Dynamics:</b> Active Long Building\n\n<i>Session: US</i>',
            'order_flow',
            '15m'
        );

        expect(parsed.title).toBe('[BTCUSDT] Flow Shift (15m)');
        expect(parsed.body).toBe('Dynamics: Active Long Building');
    });

    it('falls back gracefully when message is empty', () => {
        const parsed = parseBotHistoryMessage('', 'context_summary');

        expect(parsed.title).toBe('CONTEXT SUMMARY');
        expect(parsed.body).toBe('CONTEXT SUMMARY');
    });
});
