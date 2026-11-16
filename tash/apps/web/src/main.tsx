import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import './app/theme.css';

// StrictMode is intentionally off: game sessions own timers and are created once per screen.
createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD) registerSW({ immediate: true });
