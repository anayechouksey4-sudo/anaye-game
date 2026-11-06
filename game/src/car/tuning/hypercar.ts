/**
 * Neon Hypercar (hypercar): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const HYPERCAR_TUNING: Partial<CarTuning> = {
  // ── Handling v2 (plan §1 row: 0–100 2.9 s, top speed kept, 1.25 g skidpad, 100–0 in 33 m) ──
  handlingV2: true,
  // Longitudinal μ ≈ lateral μ (the gears, not a low ratio, decide where the rears spin); 1.3 g brakes
  // were 27 m from 100 km/h, the realistic 33 m wants about 1.0 g of pedal plus drag.
  longitudinalGripRatio: 1.1,
  brakeForceG: 1.0,
  loadSensitivity: 0.1,
  peakSlipRad: 0.16,
  antiRollFrontN_m: 18000,
  antiRollRearN_m: 14000,
  diffLock: 0.35,
};
