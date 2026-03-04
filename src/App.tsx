import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import TelegramSettings from './pages/TelegramSettings';
import DashboardSettings from './pages/DashboardSettings';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { fetchConfigFromBot } from './utils/syncConfig';

export default function App() {
    // Fetch config from bot on mount + every 30s so all devices stay in sync
    useEffect(() => {
        fetchConfigFromBot();
        const interval = setInterval(fetchConfigFromBot, 30000);
        return () => clearInterval(interval);
    }, []);

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
