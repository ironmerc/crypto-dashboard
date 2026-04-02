export function calculateEMA(data: number[], period: number) {
    const k = 2 / (period + 1);
    const emaData = [];
    let ema = data[0];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            emaData.push(null);
            ema = data.slice(0, i + 1).reduce((sum, v) => sum + v, 0) / (i + 1);
        } else {
            ema = (data[i] - ema) * k + ema;
            emaData.push(ema);
        }
    }
    return emaData;
}

export function calculateRSI(data: number[], period: number = 14) {
    const rsiData: (number | null)[] = [null];
    let gains = 0, losses = 0;

    if (data.length <= period) {
        return data.map(() => null);
    }

    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
        rsiData.push(null);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    // Replace the last push to correctly map index `period`
    rsiData[period] = rsi;

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        rsiData.push(rsi);
    }
    return rsiData;
}

export function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14) {
    if (highs.length === 0) return [];
    const atrData: (number | null)[] = [null];
    let trSum = 0;

    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );

        if (i < period) {
            trSum += tr;
            atrData.push(null);
        } else if (i === period) {
            trSum += tr;
            atrData.push(trSum / period);
        } else {
            const prevAtr = atrData[i - 1] as number;
            atrData.push((prevAtr * (period - 1) + tr) / period);
        }
    }
    return atrData;
}

export function calculateVWAP(typicalPrices: number[], volumes: number[]) {
    const vwapData = [];
    let cumVolume = 0;
    let cumVolPrice = 0;

    for (let i = 0; i < typicalPrices.length; i++) {
        cumVolume += volumes[i];
        cumVolPrice += typicalPrices[i] * volumes[i];
        if (cumVolume === 0) {
            vwapData.push(typicalPrices[i]);
        } else {
            vwapData.push(cumVolPrice / cumVolume);
        }
    }
    return vwapData;
}

export function calculateSMA(data: number[], period: number) {
    const smaData: (number | null)[] = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
        if (i < period - 1) {
            smaData.push(null);
        } else {
            if (i >= period) {
                sum -= data[i - period];
            }
            smaData.push(sum / period);
        }
    }
    return smaData;
}

export interface MACDResult {
    macd: (number | null)[];
    signal: (number | null)[];
    histogram: (number | null)[];
}

export function calculateMACD(
    closes: number[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
): MACDResult {
    const emaFast = calculateEMA(closes, fastPeriod);
    const emaSlow = calculateEMA(closes, slowPeriod);

    const macdLine: (number | null)[] = emaFast.map((v, i) => {
        if (v === null || emaSlow[i] === null) return null;
        return (v as number) - (emaSlow[i] as number);
    });

    const macdValues = macdLine.filter(v => v !== null) as number[];
    const signalRaw = calculateEMA(macdValues, signalPeriod);
    const signalPadded: (number | null)[] = [
        ...Array(macdLine.length - signalRaw.length).fill(null),
        ...signalRaw
    ];

    const histogram: (number | null)[] = macdLine.map((v, i) => {
        if (v === null || signalPadded[i] === null) return null;
        return (v as number) - (signalPadded[i] as number);
    });

    return { macd: macdLine, signal: signalPadded, histogram };
}

export interface BollingerBandsResult {
    upper: (number | null)[];
    middle: (number | null)[];
    lower: (number | null)[];
    width: (number | null)[];
}

export function calculateBollingerBands(
    closes: number[],
    period = 20,
    multiplier = 2
): BollingerBandsResult {
    const middle = calculateSMA(closes, period);
    const upper: (number | null)[] = [];
    const lower: (number | null)[] = [];
    const width: (number | null)[] = [];

    for (let i = 0; i < closes.length; i++) {
        if (middle[i] === null) {
            upper.push(null);
            lower.push(null);
            width.push(null);
            continue;
        }
        const mean = middle[i] as number;
        const slice = closes.slice(i - period + 1, i + 1);
        const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (slice.length - 1);
        const stdDev = Math.sqrt(variance);
        const u = mean + multiplier * stdDev;
        const l = mean - multiplier * stdDev;
        upper.push(u);
        lower.push(l);
        width.push(mean !== 0 ? (u - l) / mean * 100 : null);
    }

    return { upper, middle, lower, width };
}

export interface StochRSIResult {
    k: (number | null)[];
    d: (number | null)[];
}

export function calculateStochRSI(
    closes: number[],
    rsiPeriod = 14,
    stochPeriod = 14,
    kSmooth = 3,
    dSmooth = 3
): StochRSIResult {
    const rsi = calculateRSI(closes, rsiPeriod) as (number | null)[];

    const rawStoch: (number | null)[] = rsi.map((v, i) => {
        if (v === null) return null;
        const start = Math.max(0, i - stochPeriod + 1);
        const window = rsi.slice(start, i + 1).filter(x => x !== null) as number[];
        if (window.length < stochPeriod) return null;
        const min = Math.min(...window);
        const max = Math.max(...window);
        return max === min ? 50 : ((v - min) / (max - min)) * 100;
    });

    const rawNonNull = rawStoch.filter(v => v !== null) as number[];
    const kSmoothed = calculateSMA(rawNonNull, kSmooth);
    const kPadded: (number | null)[] = [
        ...Array(closes.length - kSmoothed.length).fill(null),
        ...kSmoothed
    ];

    const kNonNull = kSmoothed.filter(v => v !== null) as number[];
    const dSmoothed = calculateSMA(kNonNull, dSmooth);
    const dPadded: (number | null)[] = [
        ...Array(closes.length - dSmoothed.length).fill(null),
        ...dSmoothed
    ];

    return { k: kPadded, d: dPadded };
}

