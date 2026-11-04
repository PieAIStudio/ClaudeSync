import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pieai/swimmer-ui-kit/styles.css';
import './renderer.css';
import { App } from './App';
import { anonymousError } from '../shared/telemetry';

const seen = new WeakSet<object>();
function report(error: unknown) {
  if (error && typeof error === 'object') { if (seen.has(error)) return; seen.add(error); }
  void window.claudeSync?.reportError?.(anonymousError(error).stack ?? '').catch(() => {});
}
window.addEventListener('error', (event) => report(event.error));
window.addEventListener('unhandledrejection', (event) => report(event.reason));

createRoot(document.getElementById('root')!, { onUncaughtError: report, onCaughtError: report, onRecoverableError: report }).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
