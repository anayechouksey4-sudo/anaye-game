/**
 * Smoke Lantern (drift): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const DRIFT_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.8,
  // Spinning rears shed most of their side grip: power oversteer is the drift car's character.
  spinGripLoss: 0.7,
  steerMax: 0.78,
  steerSpeedFalloff: 16,
  steerRate: 3.4,
  steerReturnRate: 6,
  brakeForceG: 1.2,
  handbrakeRearFriction: 0.3,
  handbrakeRearSideStiffness: 0.35,
  // ── Handling v2 (plan §2 starting points; inert until handlingV2 is switched on for this class) ──
  loadSensitivity: 0.18,
  peakSlipRad: 0.2,
  antiRollFrontN_m: 18000,
  antiRollRearN_m: 12000,
  diffLock: 0.8,
};
