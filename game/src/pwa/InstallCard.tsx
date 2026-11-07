/**
 * SETTINGS card for the installable app: INSTALL APP when the browser offered its prompt,
 * "INSTALLED · PLAYS OFFLINE" when running as an app, the iOS Share → Add to Home Screen line
 * where there is no prompt, an OFFLINE READY chip once the worker's precache finished, and the
 * update row ("UPDATE INSTALLED · RESTART TO USE IT" + RESTART) above it all. Mounted by the ☰
 * menu's SETTINGS tab; reads pwa/register.ts.
 */
import { useEffect, useState } from 'react';
import { isFramed, PUBLIC_GAME_URL, promptInstall, restartForUpdate, usePwa } from './register';
import './pwa.css';

export default function InstallCard() {
  const pwa = usePwa();
  const framed = isFramed();
  // A worker that has not registered after 12 s is not coming (a frame or a browser without it).
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!pwa.supported || pwa.registered) return;
    const t = setTimeout(() => setStale(true), 12000);
    return () => clearTimeout(t);
  }, [pwa.supported, pwa.registered]);

  let status: string;
  let hint: string | null = null;
  if (framed) {
    status = 'INSTALL FROM THE GAME\u2019S OWN PAGE';
    hint = 'This copy runs inside another app\u2019s frame, which cannot install or cache the game. Open the game\u2019s page in Chrome or Safari and install from there.';
  } else if (!pwa.supported) {
    status = import.meta.env.PROD ? 'OFFLINE PLAY NOT AVAILABLE HERE' : 'DEV SERVER · NO OFFLINE CACHE';
    hint = import.meta.env.PROD ? 'This browser or frame has no service workers; the game still plays online.' : 'The production build registers the service worker.';
  } else if (pwa.standalone || pwa.installed) {
    status = 'INSTALLED · ONLINE WITH FRIENDS, OFFLINE ANYWHERE';
  } else if (pwa.canInstall) {
    status = 'INSTALL THE APP';
    hint = 'Adds GF Racer to your home screen or desktop: full screen, online rooms with your friends, and it still plays without a network.';
  } else if (pwa.ios) {
    status = 'ADD TO HOME SCREEN';
    hint = 'iPhone / iPad: tap Share, then Add to Home Screen. It then opens full screen, plays online with friends and offline anywhere.';
  } else {
    status = 'PLAYS HERE, ONLINE AND OFFLINE';
    hint = 'To install: browser menu → Install app (or Add to Home screen).';
  }

  return (
    <div className="pwa" data-testid="install-card">
      {pwa.updateReady && (
        <div className="pwa-row pwa-row--update" data-testid="pwa-update">
          <span className="pwa-text">
            <b>UPDATE INSTALLED · RESTART TO USE IT</b>
            <small>Your run is not interrupted; restart when you are ready.</small>
          </span>
          <button type="button" className="pwa-btn pwa-btn--primary" onClick={restartForUpdate} data-testid="pwa-restart">
            RESTART
          </button>
        </div>
      )}
      <div className="pwa-row">
        <span className="pwa-text">
          <b data-testid="pwa-status">{status}</b>
          {hint && <small data-testid="pwa-hint">{hint}</small>}
        </span>
        {framed ? (
          <a className="pwa-btn pwa-btn--primary" href={PUBLIC_GAME_URL} target="_blank" rel="noopener noreferrer" data-testid="pwa-open-page">
            OPEN THE GAME PAGE
          </a>
        ) : (
          pwa.canInstall && (
            <button type="button" className="pwa-btn pwa-btn--primary" onClick={() => void promptInstall()} data-testid="pwa-install">
              INSTALL APP
            </button>
          )
        )}
      </div>
      <div className="pwa-chips" data-testid="pwa-chips">
        {pwa.offlineReady && (
          <span className="pwa-chip is-on" data-testid="pwa-offline-ready">
            OFFLINE READY
          </span>
        )}
        {pwa.supported && !pwa.offlineReady && (
          <span className="pwa-chip" data-testid="pwa-caching">
            {framed || (stale && !pwa.registered) ? 'NO OFFLINE CACHE HERE' : pwa.registered ? 'CACHING FOR OFFLINE…' : 'SERVICE WORKER STARTING…'}
          </span>
        )}
        {pwa.offline && (
          <span className="pwa-chip pwa-chip--warn" data-testid="pwa-offline">
            OFFLINE
          </span>
        )}
        {pwa.version && (
          <span className="pwa-version" data-testid="pwa-version">
            v{pwa.version}
          </span>
        )}
      </div>
    </div>
  );
}
