/**
 * SETTINGS · SKID MARKS: one ON / OFF switch, persisted by skidStore (`gamerfleet.skid.v1`).
 * `SkidToggle` is the bare row in the menu's own toggle style (`.gm-toggle`, menu.css), to drop
 * into an existing section; the default export wraps it in its own section. The integrator mounts
 * one of them in GameMenu's SETTINGS tab.
 */
import './skid.css';
import { useSkidSettings } from './skidStore';

export function SkidToggle() {
  const marks = useSkidSettings((s) => s.marks);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={marks}
      className={`gm-toggle skid-toggle${marks ? ' is-on' : ''}`}
      onClick={() => useSkidSettings.getState().setMarks(!marks)}
      data-testid="menu-skid"
    >
      <span className="gm-toggle__text">
        <b>SKID MARKS</b>
        <small>Tyre marks where the car slides; they fade after 20 s</small>
      </span>
      <span className="gm-toggle__switch" aria-hidden="true">
        <i />
      </span>
      <span className="gm-toggle__state">{marks ? 'ON' : 'OFF'}</span>
    </button>
  );
}

export default function SkidSettings() {
  return (
    <section className="gm-section skid-settings" data-testid="menu-skid-section">
      <h3 className="gm-section__title">SKID MARKS</h3>
      <SkidToggle />
    </section>
  );
}
