import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Production da console loglarni o'chirish (F12 da ko'rinmasin)
if (import.meta.env.PROD) {
  const noop = () => {};
  (window.console as any).log = noop;
  (window.console as any).info = noop;
  (window.console as any).warn = noop;
  (window.console as any).debug = noop;
  // error: faqat kritik xatolarni saqlash (ErrorBoundary uchun)
  (window.console as any).error = noop;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
