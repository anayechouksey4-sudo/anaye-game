/**
 * Pixel Gnat (kart): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const KART_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.72,
  steerMax: 0.5,
  steerSpeedFalloff: 12,
  steerRate: 4,
  steerReturnRate: 7,
  brakeForceG: 1.5,
  dampingCompressionRatio: 0.7,
  dampingRelaxationRatio: 0.9,
  airPitchStiffness: 20,
  airPitchDamping: 20,
  airPitchDampingBase: 90,
  airRollDamping: 150,
  // ── Handling v2 (plan §2 starting points; inert until handlingV2 is switched on for this class) ──
  loadSensitivity: 0.1,
  peakSlipRad: 0.12,
  antiRollFrontN_m: 40000,
  antiRollRearN_m: 40000,
  diffLock: 0.2,
};
