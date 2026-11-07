/**
 * ☰ menu → SETTINGS → CONTROLS: STEERING (TOUCH / TILT, phones with an orientation sensor only),
 * TILT RANGE presets, CALIBRATE, INVERT, and the GAMEPAD · AUTO status line. Persists through
 * state/inputSettings.ts; the sensor and permission flow live in input/inputBus.ts.
 */
import { useState } from 'react';
import { TOUCH_CONTROLS } from '../hud/hudLayout';
import { inputSettings, TILT_RANGE_PRESETS, useInputSettings } from '../state/inputSettings';
import { calibrateTilt, setSteeringMode, useInputStatus } from './inputBus';
import { tiltNeedsPermission, tiltSupported } from './tilt';
import './input.css';

export default function InputSettings() {
  const settings = useInputSettings();
  const status = useInputStatus();
  const [busy, setBusy] = useState(false);
  const showTilt = TOUCH_CONTROLS && tiltSupported();
  const denied = status.tiltPermission === 'denied';
  const tiltOn = settings.steering === 'tilt';

  let steerHint: string;
  let warn = false;
  if (denied) {
    steerHint = 'TILT NOT ALLOWED · motion access was refused, the ◀ ▶ pad steers.';
    warn = true;
  } else if (tiltOn && !status.tiltActive && tiltNeedsPermission()) {
    steerHint = 'Tap TILT to allow motion access on this device.';
    warn = true;
  } else if (status.tiltActive) {
    steerHint = 'Tilting the phone steers; the ◀ ▶ pad is hidden. Hold it the way you play, then CALIBRATE.';
  } else {
    steerHint = '◀ ▶ pad under the left thumb. TILT steers by rolling the phone; the pedals stay.';
  }

  const pick = (mode: 'touch' | 'tilt') => {
    if (busy) return;
    setBusy(true);
    void setSteeringMode(mode).finally(() => setBusy(false));
  };

  return (
    <div className="ins" data-testid="input-settings">
      {showTilt && (
        <>
          <div className="ins-row">
            <b>STEERING</b>
            <small className={warn ? 'is-warn' : undefined} data-testid="menu-steering-hint">
              {steerHint}
            </small>
          </div>
          <div className="gm-seg ins-seg ins-seg--2" role="radiogroup" aria-label="Steering" data-testid="menu-steering">
            <button type="button" role="radio" aria-checked={!tiltOn} className={!tiltOn ? 'is-on' : undefined} onClick={() => pick('touch')} data-testid="menu-steering-touch">
              TOUCH
            </button>
            <button type="button" role="radio" aria-checked={tiltOn} className={tiltOn ? 'is-on' : undefined} onClick={() => pick('tilt')} data-testid="menu-steering-tilt">
              {denied ? 'TILT ✕' : 'TILT'}
            </button>
          </div>
          <div className="ins-row">
            <b>TILT RANGE</b>
            <small>Full lock at {settings.tiltMaxDeg}° of roll (2° dead zone).</small>
          </div>
          <div className="gm-seg ins-seg" role="radiogroup" aria-label="Tilt range" data-testid="menu-tilt-range">
            {TILT_RANGE_PRESETS.map((p) => (
              <button
                key={p.deg}
                type="button"
                role="radio"
                aria-checked={settings.tiltMaxDeg === p.deg}
                className={settings.tiltMaxDeg === p.deg ? 'is-on' : undefined}
                onClick={() => inputSettings().set({ tiltMaxDeg: p.deg })}
                data-testid={`menu-tilt-range-${p.deg}`}
              >
                {p.label}
                <small>{p.deg}°</small>
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.tiltInvert}
            className={`gm-toggle${settings.tiltInvert ? ' is-on' : ''}`}
            onClick={() => inputSettings().set({ tiltInvert: !settings.tiltInvert })}
            data-testid="menu-tilt-invert"
          >
            <span className="gm-toggle__text">
              <b>INVERT TILT</b>
              <small>Swap left and right</small>
            </span>
            <span className="gm-toggle__switch" aria-hidden="true">
              <i />
            </span>
            <span className="gm-toggle__state">{settings.tiltInvert ? 'ON' : 'OFF'}</span>
          </button>
          <button type="button" className="gm-btn ins-btn" onClick={calibrateTilt} data-testid="menu-tilt-calibrate">
            CALIBRATE · HOLD THE PHONE STILL
          </button>
        </>
      )}
      <div className={`ins-status${status.padId ? ' is-on' : ''}`} data-testid="menu-gamepad">
        <span>
          <b>GAMEPAD · AUTO</b>
          <small data-testid="menu-gamepad-status">{status.padId ? status.padId : 'None connected · press a button on the pad'}</small>
        </span>
        <i>{status.padId ? 'CONNECTED' : 'NONE'}</i>
      </div>
    </div>
  );
}
