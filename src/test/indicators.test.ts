import { describe, it, expect } from 'vitest';
import {
    calculateMACD,
    calculateBollingerBands,
    calculateStochRSI,
    calculateOBV,
} from '../utils/indicators';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generates a simple linear ramp: [start, start+step, start+2*step, …] */
function ramp(length: number, start = 100, step = 1): number[] {
    return Array.from({ length }, (_, i) => start + i * step);
}

/** Generates a flat series (constant price). */
function flat(length: number, value = 100): number[] {
    return Array(length).fill(value);
}

/** Returns the last non-null value in an array. */
function last<T>(arr: (T | null)[]): T {
    const vals = arr.filter((v): v is T => v !== null);
    return vals[vals.length - 1];
}

// ─── MACD ───────────────────────────────────────────────────────────────────

describe('calculateMACD', () => {
    it('returns arrays the same length as input', () => {
        const closes = ramp(60);
        const { macd, signal, histogram } = calculateMACD(closes);
        expect(macd).toHaveLength(60);
        expect(signal).toHaveLength(60);
        expect(histogram).toHaveLength(60);
    });

    it('returns nulls for the first 25 bars (need ≥26 for slow EMA)', () => {
        const closes = ramp(60);
        const { macd } = calculateMACD(closes);
        for (let i = 0; i < 25; i++) expect(macd[i]).toBeNull();
    });

    it('histogram equals macd minus signal at every non-null index', () => {
        const closes = ramp(80);
        const { macd, signal, histogram } = calculateMACD(closes);
        for (let i = 0; i < closes.length; i++) {
            if (macd[i] !== null && signal[i] !== null && histogram[i] !== null) {
                expect(histogram[i]).toBeCloseTo(macd[i]! - signal[i]!, 10);
            }
        }
    });

    it('macd is positive on an upward-trending series', () => {
        // Fast EMA rises faster than slow EMA on a ramp
        const closes = ramp(100, 100, 2);
        const { macd } = calculateMACD(closes);
        expect(last(macd)).toBeGreaterThan(0);
    });

    it('macd is negative on a downward-trending series', () => {
        const closes = ramp(100, 300, -2);
        const { macd } = calculateMACD(closes);
        expect(last(macd)).toBeLessThan(0);
    });

    it('macd is ~0 on a flat series (EMAs converge)', () => {
        const closes = flat(200);
        const { macd } = calculateMACD(closes);
        expect(Math.abs(last(macd))).toBeLessThan(1e-8);
    });

    it('respects custom fast/slow/signal periods', () => {
        const closes = ramp(60);
        const { macd, signal } = calculateMACD(closes, 5, 10, 3);
        // With period 10, first 9 bars should be null
        for (let i = 0; i < 9; i++) expect(macd[i]).toBeNull();
        expect(macd[9]).not.toBeNull();
        expect(signal).toHaveLength(60);
    });
});

// ─── Bollinger Bands ─────────────────────────────────────────────────────────

describe('calculateBollingerBands', () => {
    it('returns arrays the same length as input', () => {
        const closes = ramp(50);
        const { upper, middle, lower, width } = calculateBollingerBands(closes);
        expect(upper).toHaveLength(50);
        expect(middle).toHaveLength(50);
        expect(lower).toHaveLength(50);
        expect(width).toHaveLength(50);
    });

    it('returns nulls for the first period-1 bars', () => {
        const closes = ramp(50);
        const { upper } = calculateBollingerBands(closes, 20);
        for (let i = 0; i < 19; i++) expect(upper[i]).toBeNull();
        expect(upper[19]).not.toBeNull();
    });

    it('upper > middle > lower at every non-null index', () => {
        const closes = ramp(50, 100, 0.5);
        const { upper, middle, lower } = calculateBollingerBands(closes);
        for (let i = 0; i < closes.length; i++) {
            if (upper[i] !== null) {
                expect(upper[i]!).toBeGreaterThan(middle[i]!);
                expect(middle[i]!).toBeGreaterThan(lower[i]!);
            }
        }
    });

    it('middle equals SMA of the last period closes', () => {
        const closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
                        110, 112, 111, 113, 115, 114, 116, 118, 117, 119, 121];
        const { middle } = calculateBollingerBands(closes, 20);
        const sma20 = closes.slice(1).reduce((a, b) => a + b, 0) / 20;
        expect(middle[20]).toBeCloseTo(sma20, 8);
    });

    it('width is ~0 on a flat series (no variance)', () => {
        const closes = flat(30);
        const { width } = calculateBollingerBands(closes);
        const nonNull = width.filter((v): v is number => v !== null);
        nonNull.forEach(w => expect(w).toBeCloseTo(0, 10));
    });

    it('upper band = middle + 2σ (sample std dev)', () => {
        const closes = ramp(25, 100, 1);
        const { upper, middle } = calculateBollingerBands(closes, 20);
        const slice = closes.slice(5, 25);
        const mean = slice.reduce((a, b) => a + b, 0) / 20;
        const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / 19; // sample
        const std = Math.sqrt(variance);
        expect(upper[24]).toBeCloseTo(middle[24]! + 2 * std, 8);
    });

    it('width is positive on a volatile series', () => {
        // Alternating prices create high variance
        const closes = Array.from({ length: 30 }, (_, i) => i % 2 === 0 ? 100 : 110);
        const { width } = calculateBollingerBands(closes);
        expect(last(width)).toBeGreaterThan(0);
    });
});

// ─── StochRSI ────────────────────────────────────────────────────────────────

describe('calculateStochRSI', () => {
    it('returns arrays the same length as input', () => {
        const closes = ramp(80);
        const { k, d } = calculateStochRSI(closes);
        expect(k).toHaveLength(80);
        expect(d).toHaveLength(80);
    });

    it('all leading values are null', () => {
        const closes = ramp(80);
        const { k } = calculateStochRSI(closes);
        expect(k[0]).toBeNull();
    });

    it('non-null K values are in [0, 100]', () => {
        const closes = ramp(80, 100, 1);
        const { k } = calculateStochRSI(closes);
        k.forEach(v => {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        });
    });

    it('non-null D values are in [0, 100]', () => {
        const closes = ramp(80, 100, 1);
        const { d } = calculateStochRSI(closes);
        d.forEach(v => {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        });
    });

    it('k approaches 100 on a strongly rising series', () => {
        // Zigzag upward (2 up / 1 down) to build RSI variation, then surge.
        // Pure constant ramps lock RSI at 100 making StochRSI undefined (returns 50).
        const closes: number[] = [100];
        for (let i = 1; i < 70; i++) {
            const prev = closes[closes.length - 1];
            closes.push(i % 3 === 0 ? prev - 1 : prev + 2);
        }
        for (let i = 0; i < 12; i++) closes.push(closes[closes.length - 1] + 3);
        const { k } = calculateStochRSI(closes);
        expect(last(k)).toBeGreaterThan(80);
    });

    it('k approaches 0 on a strongly falling series', () => {
        // Zigzag downward (2 down / 1 up) to build RSI variation, then plunge.
        const closes: number[] = [300];
        for (let i = 1; i < 70; i++) {
            const prev = closes[closes.length - 1];
            closes.push(i % 3 === 0 ? prev + 1 : prev - 2);
        }
        for (let i = 0; i < 12; i++) closes.push(closes[closes.length - 1] - 3);
        const { k } = calculateStochRSI(closes);
        expect(last(k)).toBeLessThan(20);
    });

    it('d lags k (d array has more leading nulls than k)', () => {
        const closes = ramp(100);
        const { k, d } = calculateStochRSI(closes);
        const firstK = k.findIndex(v => v !== null);
        const firstD = d.findIndex(v => v !== null);
        expect(firstD).toBeGreaterThanOrEqual(firstK);
    });
});

// ─── OBV ─────────────────────────────────────────────────────────────────────

describe('calculateOBV', () => {
    it('returns array same length as input starting at 0', () => {
        const closes = [100, 101, 100];
        const volumes = [500, 300, 200];
        const obv = calculateOBV(closes, volumes);
        expect(obv).toHaveLength(3);
        expect(obv[0]).toBe(0);
    });

    it('adds volume when price rises', () => {
        const closes = [100, 101, 102];
        const volumes = [100, 200, 300];
        const obv = calculateOBV(closes, volumes);
        expect(obv[1]).toBe(200);
        expect(obv[2]).toBe(500);
    });

    it('subtracts volume when price falls', () => {
        const closes = [102, 101, 100];
        const volumes = [100, 200, 300];
        const obv = calculateOBV(closes, volumes);
        expect(obv[1]).toBe(-200);
        expect(obv[2]).toBe(-500);
    });

    it('carries OBV unchanged when price is flat', () => {
        const closes = [100, 100, 100];
        const volumes = [100, 999, 999];
        const obv = calculateOBV(closes, volumes);
        expect(obv[0]).toBe(0);
        expect(obv[1]).toBe(0);
        expect(obv[2]).toBe(0);
    });

    it('handles mixed up/down/flat correctly', () => {
        const closes  = [100, 102, 101, 101, 103];
        const volumes = [100, 200, 150, 50,  300];
        const obv = calculateOBV(closes, volumes);
        // 0, +200, -150, 0, +300
        expect(obv).toEqual([0, 200, 50, 50, 350]);
    });

    it('OBV trends up on a persistently rising series', () => {
        const closes = ramp(20, 100, 1);
        const volumes = flat(20, 100);
        const obv = calculateOBV(closes, volumes);
        expect(obv[obv.length - 1]).toBeGreaterThan(0);
    });
});
