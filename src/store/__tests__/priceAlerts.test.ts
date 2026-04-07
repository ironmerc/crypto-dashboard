import { describe, expect, it } from 'vitest';
import {
    inferPriceAlertDirection,
    normalizePriceAlertDirection,
} from '../priceAlerts';

describe('price alert direction helpers', () => {
    it('maps legacy buy-style alerts to ABOVE', () => {
        expect(normalizePriceAlertDirection(undefined, 'BUY')).toBe('ABOVE');
        expect(normalizePriceAlertDirection(undefined, 'LONG')).toBe('ABOVE');
    });

    it('maps legacy sell-style alerts to BELOW', () => {
        expect(normalizePriceAlertDirection(undefined, 'SELL')).toBe('BELOW');
        expect(normalizePriceAlertDirection(undefined, 'SHORT')).toBe('BELOW');
    });

    it('infers direction from the current reference price', () => {
        expect(inferPriceAlertDirection(105, 100)).toBe('ABOVE');
        expect(inferPriceAlertDirection(95, 100)).toBe('BELOW');
        expect(inferPriceAlertDirection(100, 100)).toBe('CROSS');
        expect(inferPriceAlertDirection(100, 0)).toBe('CROSS');
    });
});
