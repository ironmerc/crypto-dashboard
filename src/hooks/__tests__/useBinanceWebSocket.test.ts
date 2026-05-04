import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useWebSocket from 'react-use-websocket';
import { useBinanceTickers } from '../useBinanceWebSocket';

const mockedUseWebSocket = vi.mocked(useWebSocket);

describe('useBinanceTickers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: false,
        });
    });

    it('keeps ticker data flowing even when the page visibility API reports hidden', () => {
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: true,
        });

        let capturedOnMessage: ((event: MessageEvent) => void) | null = null;
        mockedUseWebSocket.mockImplementation((url, options) => {
            if (typeof url === 'string' && url.includes('fstream.binance.com')) {
                capturedOnMessage = (options as { onMessage?: (event: MessageEvent) => void }).onMessage ?? null;
            }

            return {
                sendMessage: vi.fn(),
                lastJsonMessage: null,
                readyState: 1,
                getWebSocket: vi.fn(),
                sendJsonMessage: vi.fn(),
            } as never;
        });

        const { result } = renderHook(() =>
            useBinanceTickers([{ symbol: 'BTCUSDT', type: 'futures' }])
        );

        expect(capturedOnMessage).toBeTruthy();

        act(() => {
            capturedOnMessage?.({
                data: JSON.stringify({
                    stream: 'btcusdt@ticker',
                    data: {
                        e: '24hrTicker',
                        s: 'BTCUSDT',
                        c: '100000.12',
                        p: '123.45',
                        P: '1.23',
                        v: '1000',
                    },
                }),
            } as MessageEvent);
        });

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current.BTCUSDT).toMatchObject({
            symbol: 'BTCUSDT',
            changePercent24h: '1.23',
        });
    });

    it('falls back to REST ticker data when websocket updates do not arrive', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                symbol: 'BTCUSDT',
                lastPrice: '99123.45',
                priceChange: '123.45',
                priceChangePercent: '1.11',
                volume: '2500',
            }),
        }));

        mockedUseWebSocket.mockReturnValue({
            sendMessage: vi.fn(),
            lastJsonMessage: null,
            readyState: 1,
            getWebSocket: vi.fn(),
            sendJsonMessage: vi.fn(),
        } as never);

        const { result } = renderHook(() =>
            useBinanceTickers([{ symbol: 'BTCUSDT', type: 'futures' }])
        );

        await act(async () => {
            await Promise.resolve();
            vi.advanceTimersByTime(300);
        });

        expect(fetch).toHaveBeenCalledWith(
            'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT',
            expect.any(Object)
        );
        expect(result.current.BTCUSDT).toMatchObject({
            symbol: 'BTCUSDT',
            changePercent24h: '1.11',
        });
    });
});
