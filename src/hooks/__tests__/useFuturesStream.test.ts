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

        renderHook(() => useFuturesStream('BTCUSDT', ['BTCUSDT', 'ETHUSDT']));

        // Check if SUBSCRIBE was called with @openInterest@500ms
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('openInterest@500ms'));
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('aggTrade'));
        expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('forceOrder'));
    });

    it('handles openInterestUpdate messages', () => {
        const setOpenInterest = vi.spyOn(useTerminalStore.getState(), 'setOpenInterest');

        mockedUseWebSocket.mockReturnValue({
            sendMessage: vi.fn(),
            lastJsonMessage: {
                e: 'openInterestUpdate',
                s: 'BTCUSDT',
                o: '123456.78'
            },
            readyState: 1,
            getWebSocket: vi.fn(),
            sendJsonMessage: vi.fn(),
        } as any);

        renderHook(() => useFuturesStream('BTCUSDT', ['BTCUSDT']));

        expect(setOpenInterest).toHaveBeenCalledWith('BTCUSDT', 123456.78);
    });
});
