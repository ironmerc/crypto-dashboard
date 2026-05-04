import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';
import { usePageVisibility } from './usePageVisibility';
import { formatTelegramMessageText } from '../utils/telegramMessageFormatting';

interface BotHistoryEntry {
    timestamp: string;
    symbol: string;
    category: string;
    severity: string;
    message: string;
    tf?: string;
}

const normalizeCategory = (category: string) =>
    (category || 'backend_alert').replace(/_/g, ' ').toUpperCase();

export const parseBotHistoryMessage = (rawMessage: string, category: string, tf?: string) => {
    const plainLines = formatTelegramMessageText(rawMessage || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const rawTitle = plainLines[0] || normalizeCategory(category);
    const title = rawTitle.replace(/^[^\w\[]+\s*/, '').trim();

    const body = plainLines
        .slice(1)
        .filter((line) => !line.toLowerCase().startsWith('session:'))
        .join('\n')
        .trim();

    const titledWithTf = tf && !title.includes(`(${tf})`) ? `${title} (${tf})` : title;

    return {
        title: titledWithTf,
        body: body || title,
    };
};

export function useBackendAlerts() {
    const addEvent = useTerminalStore((state) => state.addEvent);
    const monitoredSymbols = useTerminalStore((state) => state.telegramConfig.monitoredSymbols);
    const isVisible = usePageVisibility();
    const seenKeysRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        let cancelled = false;

        const pollHistory = async () => {
            if (!isVisible) return;

            try {
                const res = await fetch('/api/bot/history');
                if (!res.ok) return;

                const history = await res.json() as BotHistoryEntry[];
                if (!Array.isArray(history)) return;

                // Bot history returns newest-first; process oldest-first to preserve event chronology.
                const ordered = [...history].reverse();
                for (const row of ordered) {
                    if (cancelled) return;

                    const found = monitoredSymbols.find(m => 
                        (typeof m === 'string' ? m : m.symbol) === row.symbol?.trim()
                    );
                    const symbol = (typeof found === 'string' ? found : found?.symbol) || 
                        (typeof monitoredSymbols[0] === 'string' ? monitoredSymbols[0] : monitoredSymbols[0]?.symbol) || 
                        'BTCUSDT';

                    const { title, body } = parseBotHistoryMessage(row.message, row.category, row.tf);
                    const parsedTs = Date.parse(row.timestamp);
                    const timestamp = Number.isFinite(parsedTs) ? parsedTs : Date.now();
                    const key = `${timestamp}|${symbol}|${title}|${body}`;

                    if (seenKeysRef.current.has(key)) continue;

                    const existsInStore = useTerminalStore.getState().events.some((event) =>
                        event.symbol === symbol &&
                        event.timestamp === timestamp &&
                        event.title === title &&
                        event.message === body
                    );
                    if (existsInStore) {
                        seenKeysRef.current.add(key);
                        continue;
                    }

                    seenKeysRef.current.add(key);
                    addEvent({
                        type: 'SmartAlert',
                        symbol,
                        price: useTerminalStore.getState().livePrices[symbol] || 0,
                        amount: 0,
                        value: 0,
                        side: 'NEUTRAL',
                        timestamp,
                        title,
                        message: body,
                    });
                }

                if (seenKeysRef.current.size > 1200) {
                    const retained = Array.from(seenKeysRef.current).slice(-600);
                    seenKeysRef.current = new Set(retained);
                }
            } catch {
                // Backend may be temporarily unavailable; dashboard should continue rendering.
            }
        };

        pollHistory();
        const interval = setInterval(pollHistory, 5000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [addEvent, isVisible, monitoredSymbols.map(m => typeof m === 'string' ? m : `${m.symbol}:${m.type}`).join(',')]);
}
