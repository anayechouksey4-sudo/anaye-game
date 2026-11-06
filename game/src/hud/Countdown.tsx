import { useEffect, useState, useSyncExternalStore } from 'react';
import { getCarEntry, resolveCarId } from '../car/catalog';
import { getCountdownSnapshot, subscribeCountdown } from '../game/countdown';
import { jumpReach } from '../state/records';
import { useSelection } from '../state/selection';
import { resolveTrackId } from '../track/registry';

/** How long GO stays up after the lights go green (wall-clock ms). */
const GO_HOLD_MS = 900;
const LAMPS = [3, 2, 1] as const;

/**
 * 3 · 2 · 1 · GO start lights (game/countdown.ts drives them in simulated time; this only draws).
 * Three red lamps fill in on 3, 2, 1; all turn green on GO, which lingers for a moment. A car that
 * can never clear this map's big jump gets a one-line heads-up under the lights.
 */
export function Countdown() {
  const { serial, active, step } = useSyncExternalStore(subscribeCountdown, getCountdownSnapshot, getCountdownSnapshot);
  // The run whose GO has been shown long enough.
  const [expired, setExpired] = useState<number | null>(null);
  const carId = resolveCarId(useSelection((s) => s.carId));
  const reach = jumpReach(resolveTrackId(useSelection((s) => s.trackId)), carId);

  useEffect(() => {
    if (step !== 0) return;
    const timer = setTimeout(() => setExpired(serial), GO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [serial, step]);

  const showGo = step === 0 && expired !== serial;
  if (!(active && step !== null) && !showGo) return null;
  const lit = step === null ? 0 : 4 - step; // 3 → 1 lamp, 2 → 2, 1 → 3
  return (
    <div className={`hud-countdown${showGo ? ' is-go' : ''}`} data-testid="countdown" data-step={step ?? ''} aria-live="assertive">
      <div className="hud-countdown__lamps" aria-hidden="true">
        {LAMPS.map((n, i) => (
          <i key={n} className={showGo ? 'is-green' : i < lit ? 'is-red' : undefined} />
        ))}
      </div>
      <div key={step} className="hud-countdown__text">
        {showGo ? 'GO!' : step}
      </div>
      {reach && !reach.reachable && (
        <div className="hud-countdown__note" data-testid="countdown-reach-note">
          BIG JUMP OUT OF REACH · NEEDS {Math.round(reach.requiredKmh)} KM/H · {getCarEntry(carId).name.toUpperCase()} MAX {Math.round(reach.maxTopKmh ?? 0)}
        </div>
      )}
    </div>
  );
}
