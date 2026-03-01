import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TelegramSettings from './pages/TelegramSettings';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/integrations/telegram" element={<TelegramSettings />} />
            </Routes>
        </BrowserRouter>
    );
}
