import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { installPwa } from './pwa/register';

// Installable app: captures the browser's install prompt now and registers the service worker
// after load (production builds only; see pwa/register.ts).
installPwa();

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
