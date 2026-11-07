/**
 * "TROPHY · BIG AIR": the unlock toast. Absolute inside the HUD, under the top bar (compact: at
 * var(--below-bar) + 44px, beside the minimap when it shows, never near the thumbs); 3 s each, one at
 * a time (career/toastStore.ts). Hidden with the rest of the HUD while the menu is open.
 */
import '../hud/career.css';
import { useTrophyToast } from './toastStore';
import { trophyById } from './trophies';

export function TrophyGlyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function TrophyToast() {
  const current = useTrophyToast((s) => s.current);
  if (!current) return null;
  const trophy = trophyById(current.trophyId);
  if (!trophy) return null;
  return (
    <div className="cr-toast" key={current.serial} role="status" aria-live="polite" data-testid="trophy-toast" data-trophy={trophy.id}>
      <TrophyGlyph d={trophy.glyph} className="cr-toast__glyph" />
      <span className="cr-toast__text">
        <small>TROPHY</small>
        <b>{trophy.name}</b>
      </span>
    </div>
  );
}

export default TrophyToast;
