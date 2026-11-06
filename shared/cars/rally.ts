/**
 * Light short-wheelbase all-wheel-drive hatch: nimble, short-geared (lower top speed). Handling v2
 * (game tuning `handlingV2` on): the 6 short gears of its turbo-four sound and a boosted curve — a
 * little lag below 20 % of the redline, a flat plateau from 30 % to 60 %, 83 % of it left at the
 * top-gear fit point (93 %). Rally tyres on asphalt: 1.14 μ (1.7 before v2, which put it at 1.6 g on
 * the skidpad against the plan's 1.05 g row; its wing and rear downforce add about a third of its
 * weight at 120 km/h, so the steady 1.1 g there comes from a tyre well under that); with four driven wheels the launch is grip-limited to
 * about 130 km/h at tier 5, which is what sets its 3.6 s to 100 km/h.
 */
import { type CarClass } from './types';

export const RALLY: Readonly<CarClass> = {
  id: 'rally',
  name: 'Glitch Rally',
  frontDriveShare: 0.45,
  massBase: 860,
  massPerTier: 40,
  torqueBase: 520,
  torquePerTier: 530,
  dragBase: 2.9,
  dragPerAero: 1.4,
  frontWingMax: 5,
  traction: 1.14,
  frontBodyLift: 1.6,
  rearDownforce: 1.8,
  driveWheelRadius: 0.32,
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: 0.016,
  wheelbase: 2.45,
  cgHeight: 0.5,
  frontWeightNeutral: 0.56,
  frontWeightRange: 0.18,
  suspensionStiffnessBase: 60,
  suspensionBalanceSplit: 0.36,
  jumpSpeedScale: 1.027,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 10,
  engine: {
    gears: 6,
    firstGearFrac: 0.3,
    torqueCurve: [0.4, 0.6, 0.85, 1.0, 1.0, 1.0, 1.0, 0.98, 0.92, 0.85, 0.78],
    shiftUpFrac: 0.95,
    shiftCutS: 0.08,
  },
};
