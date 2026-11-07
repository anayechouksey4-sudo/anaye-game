/**
 * SETTINGS card for the race company (the integrator mounts it in GameMenu's SETTINGS tab):
 * RIVALS 3 / 1 / OFF and GHOST ON / OFF (rivals/store.ts, persisted).
 */
import './rivals.css';
import { useRivalSettings, type RivalCount } from './store';

const COUNTS: { value: RivalCount; label: string; testId: string }[] = [
  { value: 3, label: '3 RIVALS', testId: 'menu-rivals-3' },
  { value: 1, label: '1 RIVAL', testId: 'menu-rivals-1' },
  { value: 0, label: 'OFF', testId: 'menu-rivals-0' },
];

export default function RivalsSettings() {
  const rivals = useRivalSettings((s) => s.rivals);
  const ghost = useRivalSettings((s) => s.ghost);
  const { setRivals, setGhost } = useRivalSettings.getState();
  return (
    <div className="rv-settings" data-testid="menu-rivals">
      <div className="gm-seg" role="radiogroup" aria-label="Rivals">
        {COUNTS.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={rivals === c.value} className={rivals === c.value ? 'is-on' : undefined} onClick={() => setRivals(c.value)} data-testid={c.testId}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="rv-settings__note">Rivals drive at this car's GOLD, SILVER and BRONZE pace on every timed race (one rival: gold). They are ghosts: no contact.</p>
      <button type="button" role="switch" aria-checked={ghost} className={`gm-toggle${ghost ? ' is-on' : ''}`} onClick={() => setGhost(!ghost)} data-testid="menu-ghost">
        <span className="gm-toggle__text">
          <b>GHOST</b>
          <small>Your best run on this map with this car, replayed as a shadow</small>
        </span>
        <span className="gm-toggle__switch" aria-hidden="true">
          <i />
        </span>
        <span className="gm-toggle__state">{ghost ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
}
