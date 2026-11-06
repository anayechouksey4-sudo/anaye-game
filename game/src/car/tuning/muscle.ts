/**
 * Bruiser V8 (muscle): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const MUSCLE_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.95,
  spinGripLoss: 0.6,
  steerMax: 0.52,
  steerSpeedFalloff: 12,
  steerRate: 2.3,
  steerReturnRate: 4,
  brakeForceG: 1.05,
  burnoutRearGrip: 0.3,
  handbrakeForceN: 11000,
  airPitchStiffness: 80,
  airPitchDamping: 70,
  airPitchDampingBase: 400,
  airRollDamping: 650,
};
