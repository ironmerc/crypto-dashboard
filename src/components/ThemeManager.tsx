import { useEffect } from 'react';
import { useTerminalStore } from '../store/useTerminalStore';

export function ThemeManager() {
    const theme = useTerminalStore((state) => state.theme);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return null;
}
