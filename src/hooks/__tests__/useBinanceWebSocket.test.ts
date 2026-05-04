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
});
