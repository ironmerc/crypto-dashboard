import { useTerminalStore } from '../store/useTerminalStore';
import telegramConfigSchema from '../../schemas/telegram-config.schema.json';
import { logSchemaWarnings, validateBySchemaWarnOnly } from './schemaValidation';

let syncTimeout: any = null;

/**
 * Fetches the current configuration from the Python bot backend and updates the store.
 */
export const fetchConfigFromBot = async () => {
    const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/config';
    const requestVersion = useTerminalStore.getState().configSyncVersion;
    try {
        console.log('[Sync] Fetching config from bot...');
        const response = await fetch(botUrl);
        if (response.ok) {
            const botConfig = await response.json();
            
            // Normalize symbols from bot
            if (botConfig.monitoredSymbols && Array.isArray(botConfig.monitoredSymbols)) {
                botConfig.monitoredSymbols = botConfig.monitoredSymbols.map((m: any) => {
                    const rawSym = typeof m === 'string' ? m : m.symbol;
                    const type = typeof m === 'string' ? 'futures' : m.type;
                    let s = rawSym.toUpperCase().trim();
                    if (s.length >= 3 && s.length <= 5 && !s.endsWith('USDT')) s = `${s}USDT`;
                    return { symbol: s, type };
                });
            }

            const warnings = validateBySchemaWarnOnly(botConfig, telegramConfigSchema as any, { partial: false });
            logSchemaWarnings('config:fetch', warnings);
            console.log('[Sync] Received config from bot:', botConfig);
            const state = useTerminalStore.getState();
            if (state.isConfigSaving || state.configSyncVersion !== requestVersion) {
                console.log('[Sync] Skipping stale config fetch result');
                return;
            }
            // Update store with data from bot, merging with current state
            useTerminalStore.getState().updateTelegramConfig(botConfig, true);
        } else {
            console.warn('[Sync] Failed to fetch config from bot:', response.status);
        }
    } catch (error) {
        console.error('[Sync] Error fetching config from bot:', error);
    }
};

/**
 * Synchronizes the current frontend Telegram configuration to the Python bot backend.
 * Uses debouncing to prevent excessive API calls during rapid UI adjustments.
 */
export const syncConfigToBot = async () => {
    if (syncTimeout) clearTimeout(syncTimeout);

    syncTimeout = setTimeout(async () => {
        const config = useTerminalStore.getState().telegramConfig;
        const warnings = validateBySchemaWarnOnly(config, telegramConfigSchema as any, { partial: false });
        logSchemaWarnings('config:sync', warnings);
        const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/config';

        try {
            console.log('[Sync] Propagation triggered...', config);
            const response = await fetch(botUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (!response.ok) {
                console.warn('[Sync] Backend rejected configuration update');
            } else {
                console.log('[Sync] Successfully synchronized with bot engine');
            }
        } catch (error) {
            console.error('[Sync] Failed to reach bot backend:', error);
        }
    }, 1000); // 1s debounce
};
