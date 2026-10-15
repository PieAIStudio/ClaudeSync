import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pieai/swimmer-ui-kit/styles.css';
import './renderer.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
