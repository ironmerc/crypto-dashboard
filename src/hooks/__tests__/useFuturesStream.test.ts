import { renderHook } from '@testing-library/react';
import { useFuturesStream } from '../useFuturesStream';
import { useTerminalStore } from '../../store/useTerminalStore';
import useWebSocket from 'react-use-websocket';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// We mocked react-use-websocket in setup.ts
const mockedUseWebSocket = vi.mocked(useWebSocket);

describe('useFuturesStream', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('subscribes to correct streams on mount', () => {
        const sendMessage = vi.fn();
        mockedUseWebSocket.mockReturnValue({
            sendMessage,
            lastJsonMessage: null,
            readyState: 1,
            getWebSocket: vi.fn(),
            sendJsonMessage: vi.fn(),
        } as any);

        renderHook(() => useFuturesStream(
            { symbol: 'BTCUSDT', type: 'futures' },
            [{ symbol: 'BTCUSDT', type: 'futures' }, { symbol: 'ETHUSDT', type: 'futures' }]
        ));

        // Since we have two useWebSocket calls in the hook, sendMessage will be mapped to both.
        // The futures effect should trigger a SUBSCRIBE call.
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('openInterest@500ms'));
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('aggTrade'));
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('forceOrder'));
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('markPrice'));
        
        // Check for depth subscription for active symbol
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('depth20@100ms'));
    });

    it('handles openInterestUpdate messages', () => {
        const setOpenInterest = vi.spyOn(useTerminalStore.getState(), 'setOpenInterest');
        let capturedOnMessage: any = null;

        mockedUseWebSocket.mockImplementation((url, options) => {
            if (typeof url === 'string' && url.includes('fstream.binance.com')) {
                capturedOnMessage = (options as any).onMessage;
            }
            return {
                sendMessage: vi.fn(),
                lastJsonMessage: null,
                readyState: 1,
                getWebSocket: vi.fn(),
                sendJsonMessage: vi.fn(),
            } as any;
        });

        renderHook(() => useFuturesStream(
            { symbol: 'BTCUSDT', type: 'futures' },
            [{ symbol: 'BTCUSDT', type: 'futures' }]
        ));

        expect(capturedOnMessage).toBeDefined();

        // Trigger message handling via onMessage
        capturedOnMessage({
            data: JSON.stringify({
                e: 'openInterestUpdate',
                s: 'BTCUSDT',
                o: '123456.78'
            })
        });

        expect(setOpenInterest).toHaveBeenCalledWith('BTCUSDT', 123456.78);
    });

    it('writes aggTrade updates into the live websocket price store', () => {
        const setLivePrice = vi.spyOn(useTerminalStore.getState(), 'setLivePrice');
        let capturedOnMessage: any = null;

        mockedUseWebSocket.mockImplementation((url, options) => {
            if (typeof url === 'string' && url.includes('fstream.binance.com')) {
                capturedOnMessage = (options as any).onMessage;
            }
            return {
                sendMessage: vi.fn(),
                lastJsonMessage: null,
                readyState: 1,
                getWebSocket: vi.fn(),
                sendJsonMessage: vi.fn(),
            } as any;
        });

        renderHook(() => useFuturesStream(
            { symbol: 'BTCUSDT', type: 'futures' },
            [{ symbol: 'BTCUSDT', type: 'futures' }]
        ));

        capturedOnMessage({
            data: JSON.stringify({
                e: 'aggTrade',
                s: 'BTCUSDT',
                p: '78937.10',
                q: '0.05',
                m: false,
                T: 1234567890,
            })
        });

        expect(setLivePrice).toHaveBeenCalledWith('BTCUSDT', 78937.1, 'trade', 1234567890);
    });
});
