export const formatPrice = (price: number | null | undefined): string => {
    if (price === null || price === undefined) return '---';
    if (price === 0) return '0.00';

    // Bug fix: handle negative deltas (priceChange can be negative)
    const abs = Math.abs(price);
    const sign = price < 0 ? '-' : '';
    if (abs >= 1000) return sign + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs >= 1) return sign + abs.toFixed(2);
    if (abs >= 0.1) return sign + abs.toFixed(4);
    if (abs >= 0.01) return sign + abs.toFixed(5);
    if (abs >= 0.001) return sign + abs.toFixed(6);
    return sign + abs.toFixed(8);
};

export const formatValue = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '---';
    if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
};

export const formatAmount = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined) return '---';
    if (amount >= 1000000) return (amount / 1000000).toFixed(2) + 'M';
    if (amount >= 1000) return (amount / 1000).toFixed(1) + 'K';
    if (amount >= 1) return amount.toFixed(2);
    return amount.toFixed(6);
};
