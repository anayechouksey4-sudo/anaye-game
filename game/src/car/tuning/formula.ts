/**
 * Razorwing (formula): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const FORMULA_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.75,
  sideStiffnessBase: 0.5,
  steerMax: 0.5,
  steerSpeedFalloff: 10,
  steerMin: 0.06,
  steerRate: 3.8,
  steerReturnRate: 7,
  brakeForceG: 2,
  airPitchStiffness: 32,
  airPitchDamping: 30,
  airPitchDampingBase: 150,
  airRollDamping: 250,
};
