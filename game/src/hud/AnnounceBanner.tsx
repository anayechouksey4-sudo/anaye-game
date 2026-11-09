/**
 * The owner's announcement banner (announce.ts holds the state). `variant="hud"` is mounted once in
 * HUD.tsx; `variant="menu"` repeats it at the top of the FRIENDS tab, which covers the HUD while a room
 * lobby is open. Both close together with ✕ (44 px).
 *
 * Phones: under the top bar, clear of ☰ / ⟲ (portrait), or in the top-left corner beside the centred top
 * bar and above the steer pad (landscape), so speed, timer and the P n/N chip are never covered
 * (announce.css). The text is rendered as text: `<b>` in an announcement shows as the characters `<b>`.
 */
import { dismissAnnounce, useAnnounce } from './announce';
import './announce.css';

export function AnnounceBanner({ variant = 'hud' }: { variant?: 'hud' | 'menu' }) {
  const current = useAnnounce((s) => s.current);
  if (!current) return null;
  return (
    <div className={`ann ann--${variant}`} role="status" aria-live="polite" data-testid={`announce-${variant}`} data-announce-id={current.id}>
      <div className="ann__body">
        <small className="ann__label">ANNOUNCEMENT</small>
        <p className="ann__text" dir="auto" data-testid={`announce-${variant}-text`}>
          {current.text}
        </p>
      </div>
      <button type="button" className="ann__close" onClick={dismissAnnounce} aria-label="Close the announcement" data-testid={`announce-${variant}-close`}>
        ✕
      </button>
    </div>
  );
}
