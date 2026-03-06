import { useTerminalStore } from '../store/useTerminalStore';
import telegramConfigSchema from '../../schemas/telegram-config.schema.json';
import { logSchemaWarnings, validateBySchemaWarnOnly } from './schemaValidation';

let syncTimeout: any = null;

/**
 * Fetches the current configuration from the Python bot backend and updates the store.
 */
export const fetchConfigFromBot = async () => {
    const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || '/api/bot/config';
    try {
        console.log('[Sync] Fetching config from bot...');
        const response = await fetch(botUrl);
        if (response.ok) {
            const botConfig = await response.json();
            const warnings = validateBySchemaWarnOnly(botConfig, telegramConfigSchema as any, { partial: false });
            logSchemaWarnings('config:fetch', warnings);
            console.log('[Sync] Received config from bot:', botConfig);
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
