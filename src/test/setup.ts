import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock symbols or global configurations if needed
vi.mock('react-use-websocket', () => ({
    default: vi.fn(() => ({
        sendMessage: vi.fn(),
        lastJsonMessage: null,
        readyState: 1,
    })),
}));

// Mock ResizeObserver which is often needed for charts/UI
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));

// Mock localStorage for Zustand persist
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value.toString(); },
        clear: () => { store = {}; },
        removeItem: (key: string) => { delete store[key]; },
        length: Object.keys(store).length,
        key: (index: number) => Object.keys(store)[index] || null,
    };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
