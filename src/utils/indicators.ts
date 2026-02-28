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
