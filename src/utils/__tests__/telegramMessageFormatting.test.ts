import { describe, expect, it } from 'vitest';
import { formatTelegramMessageText } from '../telegramMessageFormatting';

describe('formatTelegramMessageText', () => {
    it('strips Telegram HTML while preserving readable line breaks', () => {
        const rawMessage = '<b>Side:</b> SHORT\n<b>Amount:</b> $1.2M\n\n<i>Session:</i> London';

        expect(formatTelegramMessageText(rawMessage)).toBe(
            'Side: SHORT\nAmount: $1.2M\n\nSession: London'
        );
    });

    it('removes mojibake tokens that leak into alert bodies', () => {
        const rawMessage = `<b>Status:</b> \u00f0\u0178\u201d\u00b4 Overbought\n<i>Short-term momentum is stretched.</i>`;

        expect(formatTelegramMessageText(rawMessage)).toBe(
            'Status: Overbought\nShort-term momentum is stretched.'
        );
    });
});
