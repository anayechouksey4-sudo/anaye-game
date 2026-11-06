/**
 * Long-nosed front-engined drift coupe: low grip (traction 1.28) under a torquey turbo lump, so the
 * rears light up at every tier and keep sliding; a big steering lock and the handbrake (game tuning)
 * hold the slide. Built for the DRIFT button. Handling v2 (game tuning `handlingV2` on): the 6 gears
 * of its turbo-six sound and a boosted curve — boost from 30 % of the redline, a plateau to 60 %,
 * 83 % of it at the top-gear fit point (93 %) — so 1st and 2nd carry three to four times the grip of
 * the rears at any tier (the legacy launch boost is 1st gear now).
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
  launchBoost: 1,
  launchFadeKmh: 0,
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
  engine: {
    gears: 6,
    firstGearFrac: 0.32,
    torqueCurve: [0.4, 0.6, 0.8, 0.95, 1.0, 1.0, 1.0, 0.98, 0.93, 0.86, 0.8],
    shiftUpFrac: 0.95,
    shiftCutS: 0.08,
  },
};
