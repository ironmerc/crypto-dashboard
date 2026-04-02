const TELEGRAM_HTML_BREAK_REGEX = /<br\s*\/?>/gi;
const TELEGRAM_HTML_TAG_REGEX = /<[^>]*>/g;
const MOJIBAKE_AFTER_LABEL_REGEX = /(:\s*)[^\x00-\x7f]{2,}\s+/g;
const MOJIBAKE_INLINE_REGEX = /(^|\s)[^\x00-\x7f]{2,}\s+(?=[A-Za-z[])/gm;

export const stripTelegramHtml = (input: string) =>
    (input || '')
        .replace(/\r\n/g, '\n')
        .replace(TELEGRAM_HTML_BREAK_REGEX, '\n')
        .replace(TELEGRAM_HTML_TAG_REGEX, '');

export const formatTelegramMessageText = (input: string) =>
    stripTelegramHtml(input)
        .replace(/&nbsp;/g, ' ')
        .replace(MOJIBAKE_AFTER_LABEL_REGEX, '$1')
        .replace(MOJIBAKE_INLINE_REGEX, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
