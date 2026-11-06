/**
 * Glitch Rally (rally): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const RALLY_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.82,
  sideStiffnessBase: 0.45,
  steerMax: 0.62,
  steerSpeedFalloff: 17,
  steerRate: 3.6,
  steerReturnRate: 5.5,
  brakeForceG: 1.35,
  handbrakeForceN: 7000,
  handbrakeRearFriction: 0.3,
  handbrakeRearSideStiffness: 0.45,
  airPitchStiffness: 45,
  airPitchDamping: 45,
  airPitchDampingBase: 240,
  airRollDamping: 380,
  // ── Handling v2 (plan §2 starting points; inert until handlingV2 is switched on for this class) ──
  loadSensitivity: 0.18,
  peakSlipRad: 0.17,
  antiRollFrontN_m: 20000,
  antiRollRearN_m: 16000,
  diffLock: 0.2,
};
