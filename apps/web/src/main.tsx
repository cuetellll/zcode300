import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

// TEMP DEBUG: capture console.error (React max-depth warnings) for on-screen diagnosis
(window as unknown as { __mgLogs: string[] }).__mgLogs = [];
const __origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  try {
    const text = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}
${a.stack ?? ''}` : JSON.stringify(a)))
      .join(' | ');
    (window as unknown as { __mgLogs: string[] }).__mgLogs.push(text.slice(0, 3000));
    if ((window as unknown as { __mgLogs: string[] }).__mgLogs.length > 40) (window as unknown as { __mgLogs: string[] }).__mgLogs.shift();
  } catch {
    /* ignore */
  }
  __origError(...args);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
