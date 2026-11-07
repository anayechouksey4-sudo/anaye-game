import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { installPwa } from './pwa/register';
import { startCareerTracking } from './career';
import { rememberRelayFromUrl } from './multiplayer/FriendsTab';

// Installable app: captures the browser's install prompt now and registers the service worker
// after load (production builds only; see pwa/register.ts).
installPwa();
// Career stats and trophies: listens to the run events and the stores for the whole session.
startCareerTracking();
// A relay named in the address (a friend's room link) is remembered for the installed app's next start.
rememberRelayFromUrl();

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
