import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import TelegramSettings from './pages/TelegramSettings';
import DashboardSettings from './pages/DashboardSettings';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { fetchConfigFromBot } from './utils/syncConfig';
import { usePageVisibility } from './hooks/usePageVisibility';

export default function App() {
    const isVisible = usePageVisibility();

    // Fetch config from bot on mount + every 30s so all devices stay in sync
    useEffect(() => {
        const fetch = () => {
            if (isVisible) fetchConfigFromBot();
        };

        fetch();
        const interval = setInterval(fetch, 30000);
        return () => clearInterval(interval);
    }, [isVisible]);

    return (
        <GlobalErrorBoundary>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/settings" element={<DashboardSettings />} />
                    <Route path="/integrations/telegram" element={<TelegramSettings />} />
                </Routes>
            </BrowserRouter>
        </GlobalErrorBoundary>
    );
}
