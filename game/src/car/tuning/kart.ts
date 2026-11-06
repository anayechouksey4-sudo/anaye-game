/**
 * Pixel Gnat (kart): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const KART_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: longitudinal μ = lateral μ (the single fixed ratio decides the launch); the 1.5 g pedal
  // stopped in 23 m from 100 km/h, the 30 m row wants about 1.15 g plus drag.
  longitudinalGripRatio: 1.0,
  steerMax: 0.5,
  steerSpeedFalloff: 12,
  steerRate: 4,
  steerReturnRate: 7,
  brakeForceG: 1.15,
  dampingCompressionRatio: 0.7,
  dampingRelaxationRatio: 0.9,
  airPitchStiffness: 20,
  airPitchDamping: 20,
  airPitchDampingBase: 90,
  airRollDamping: 150,
  // ── Handling v2 (plan §1 row: 0–100 3.8 s, top speed kept, 1.4 g skidpad, 100–0 in 30 m) ──
  handlingV2: true,
  loadSensitivity: 0.1,
  peakSlipRad: 0.12,
  antiRollFrontN_m: 40000,
  antiRollRearN_m: 40000,
  diffLock: 0.2,
};
