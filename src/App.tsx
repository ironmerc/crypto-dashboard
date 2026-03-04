import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TelegramSettings from './pages/TelegramSettings';
import DashboardSettings from './pages/DashboardSettings';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';

export default function App() {
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
