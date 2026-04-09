export type PriceAlertDirection = 'ABOVE' | 'BELOW' | 'CROSS';

const DIRECTION_VALUES: PriceAlertDirection[] = ['ABOVE', 'BELOW', 'CROSS'];

const isPriceAlertDirection = (value: string): value is PriceAlertDirection =>
    DIRECTION_VALUES.includes(value as PriceAlertDirection);

export const normalizePriceAlertDirection = (
    direction?: string | null,
    legacySide?: string | null,
): PriceAlertDirection => {
    const normalizedDirection = String(direction || '').toUpperCase();
    if (isPriceAlertDirection(normalizedDirection)) {
        return normalizedDirection;
    }

    const normalizedSide = String(legacySide || '').toUpperCase();
    if (normalizedSide === 'BUY' || normalizedSide === 'LONG') {
        return 'ABOVE';
    }
    if (normalizedSide === 'SELL' || normalizedSide === 'SHORT') {
        return 'BELOW';
    }

    return 'CROSS';
};

export const inferPriceAlertDirection = (
    targetPrice: number,
    referencePrice?: number | null,
): PriceAlertDirection => {
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
        return 'CROSS';
    }
    if (!Number.isFinite(referencePrice) || !referencePrice || referencePrice <= 0) {
        return 'CROSS';
    }
    if (targetPrice > referencePrice) {
        return 'ABOVE';
    }
    if (targetPrice < referencePrice) {
        return 'BELOW';
    }
    return 'CROSS';
};

export const inferManualPriceAlertDirection = (
    manualAlertPrice: string,
    referencePrice?: number | null,
): PriceAlertDirection | null => {
    const parsedPrice = Number.parseFloat(manualAlertPrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        return null;
    }

    return inferPriceAlertDirection(parsedPrice, referencePrice);
};
