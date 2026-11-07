/**
 * SETTINGS card for the installable app: INSTALL APP when the browser offered its prompt,
 * "INSTALLED · PLAYS OFFLINE" when running as an app, the iOS Share → Add to Home Screen line
 * where there is no prompt, an OFFLINE READY chip once the worker's precache finished, and the
 * update row ("UPDATE INSTALLED · RESTART TO USE IT" + RESTART) above it all. Mounted by the ☰
 * menu's SETTINGS tab; reads pwa/register.ts.
 */
import { promptInstall, restartForUpdate, usePwa } from './register';
import './pwa.css';

export default function InstallCard() {
  const pwa = usePwa();

  let status: string;
  let hint: string | null = null;
  if (!pwa.supported) {
    status = import.meta.env.PROD ? 'OFFLINE PLAY NOT AVAILABLE HERE' : 'DEV SERVER · NO OFFLINE CACHE';
    hint = import.meta.env.PROD ? 'This browser or frame has no service workers; the game still plays online.' : 'The production build registers the service worker.';
  } else if (pwa.standalone || pwa.installed) {
    status = 'INSTALLED · PLAYS OFFLINE';
  } else if (pwa.canInstall) {
    status = 'INSTALL FOR OFFLINE PLAY';
    hint = 'Adds GF Racer to your home screen or desktop; it opens full screen and works without a network.';
  } else if (pwa.ios) {
    status = 'ADD TO HOME SCREEN';
    hint = 'iPhone / iPad: tap Share, then Add to Home Screen. It then opens full screen and plays offline.';
  } else {
    status = 'PLAYS OFFLINE IN THIS BROWSER';
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
        {pwa.canInstall && (
          <button type="button" className="pwa-btn pwa-btn--primary" onClick={() => void promptInstall()} data-testid="pwa-install">
            INSTALL APP
          </button>
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
            {pwa.registered ? 'CACHING FOR OFFLINE…' : 'SERVICE WORKER STARTING…'}
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
