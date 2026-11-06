/**
 * Ion Dragonfly (electric): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const ELECTRIC_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: all-wheel drive never needs a low longitudinal ratio; the 1.3 g pedal stopped in 28 m
  // from 100 km/h, the 35 m row wants about 1.0 g plus drag on a 2 t car.
  longitudinalGripRatio: 1.0,
  steerMax: 0.54,
  steerSpeedFalloff: 13,
  steerRate: 2.6,
  brakeForceG: 1.0,
  airPitchStiffness: 90,
  airPitchDamping: 80,
  airPitchDampingBase: 450,
  airRollDamping: 700,
  // ── Handling v2 (plan §1 row: 0–100 3.0 s, top speed kept, 1.15 g skidpad, 100–0 in 35 m) ──
  handlingV2: true,
  // The heaviest car: its tyres run furthest up the load curve (plan: 0.22 for the heavy classes).
  loadSensitivity: 0.22,
  peakSlipRad: 0.15,
  antiRollFrontN_m: 30000,
  antiRollRearN_m: 26000,
  diffLock: 0.2,
};
