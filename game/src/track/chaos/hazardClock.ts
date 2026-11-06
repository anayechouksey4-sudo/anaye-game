/**
 * Simulated-time clock shared by every moving hazard, so pendulum swings and shutter cycles are a
 * pure function of physics steps (deterministic under `__RACER__.advance`) and restart together.
 *
 * Advanced AFTER each step, so inside a before-step callback `hazardClock.time + PHYSICS_DT` is
 * the time the upcoming step ends at — the moment kinematic targets must describe.
 */
import { useEffect } from 'react';
import { useAfterPhysicsStep } from '@react-three/rapier';
import { PHYSICS_DT } from '../../config';
import { onGameEvent } from '../../game/events';

export const hazardClock = {
  /** Seconds of simulated time since load / the last restart. */
  time: 0,
  steps: 0,
};

export function resetHazardClock(): void {
  hazardClock.time = 0;
  hazardClock.steps = 0;
}

/** Mount once inside <Physics>. Listeners added later than this one still see the reset clock on 'restart'. */
export function HazardClockDriver() {
  useEffect(() => {
    resetHazardClock();
    const off = onGameEvent('restart', resetHazardClock);
    return () => {
      off();
      // The next map starts its hazards from t = 0.
      resetHazardClock();
    };
  }, []);
  useAfterPhysicsStep(() => {
    hazardClock.steps += 1;
    hazardClock.time = hazardClock.steps * PHYSICS_DT;
  });
  return null;
}
