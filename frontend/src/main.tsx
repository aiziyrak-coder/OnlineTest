import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Production: verbose konsolni o‘chirish (savollar / tokenlar F12 da chiqmasin).
// console.error saqlanadi — monitoring va ErrorBoundary diagnostikasi uchun.
if (import.meta.env.PROD) {
  const noop = () => {};
  (window.console as any).log = noop;
  (window.console as any).info = noop;
  (window.console as any).warn = noop;
  (window.console as any).debug = noop;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
