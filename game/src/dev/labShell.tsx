/**
 * Dev-only shell for the lab pages (game/lab-*.html): the HUD's tokens and menu styles, a scrolling
 * panel like the ☰ menu body, and the `__PROFILE__` debug handle. Never part of the production
 * build (vite only builds index.html).
 */
import '../styles.css';
import '../hud/hud.css';
import '../hud/menu.css';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installProfileDebug } from '../ride/profileDebug';

export function LabShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => installProfileDebug(), []);
  return (
    <div className="hud" style={{ pointerEvents: 'auto', userSelect: 'auto' }} data-testid="lab">
      <div className="gm" style={{ position: 'fixed', inset: 0 }}>
        <div className="gm__panel" style={{ gridTemplateAreas: "'head' 'body'", gridTemplateRows: 'auto minmax(0, 1fr)', gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <header className="gm__head">
            <div className="gm__title">
              <b>{title}</b>
              <small>dev lab · what the ☰ menu tab will show</small>
            </div>
          </header>
          <div className="gm__body" style={{ touchAction: 'pan-y' }} data-testid="lab-body">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function mountLab(node: ReactNode): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  // The game's styles.css forbids page touch gestures; the lab panel scrolls like the menu body.
  document.documentElement.style.touchAction = 'auto';
  document.body.style.touchAction = 'auto';
  createRoot(root).render(<StrictMode>{node}</StrictMode>);
}
