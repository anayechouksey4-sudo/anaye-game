/**
 * Long-nosed front-engined drift coupe: low grip (traction 1.28) under a torquey turbo lump with a
 * launch boost, so the rears light up at every tier and keep sliding; a big steering lock and the
 * handbrake (game tuning) hold the slide. Built for the DRIFT button.
 */
import { type CarClass } from './types';

export const DRIFT: Readonly<CarClass> = {
  id: 'drift',
  name: 'Smoke Lantern',
  frontDriveShare: 0,
  massBase: 1250,
  massPerTier: 55,
  torqueBase: 900,
  torquePerTier: 650,
  dragBase: 3.1,
  dragPerAero: 1.5,
  frontWingMax: 5,
  traction: 1.28,
  frontBodyLift: 2.6,
  rearDownforce: 1.6,
  driveWheelRadius: 0.34,
  launchBoost: 1.25,
  launchFadeKmh: 60,
  rollingResistance: 0.015,
  wheelbase: 2.65,
  cgHeight: 0.46,
  frontWeightNeutral: 0.53,
  frontWeightRange: 0.18,
  suspensionStiffnessBase: 48,
  suspensionBalanceSplit: 0.36,
  // Chaos jump, tier 5 (sim): 42 % wing (estimated top 187.1) still cleared at 183.0 at the lip → 1.02.
  // Balance −40 is the exception the estimate can't see: with a third of the weight on the rears the
  // drift car spins its tyres all the way up the run-up and reaches the lip at ~165 km/h (short).
  jumpSpeedScale: 1.02,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 12,
};
