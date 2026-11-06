/**
 * Heavy front-engined coupe: huge low-end torque (wheelspin and smoke at any tier), brick-like drag and
 * nose lift. Handling v2 (game tuning `handlingV2` on): a 5-speed with the long gears of its engine
 * sound and a big-V8 curve — torque peaks at 20–30 % of the redline and sags to 74 % of it at the
 * top-gear fit point (93 %), so the push is all at the bottom and the engine runs out of breath up
 * top. Square, soft drag-style rears: more forward bite than side bite (longitudinalGripRatio 1.2 in
 * the game tuning) on a 1.18 μ tyre, which is what makes the plan's 0.95 g skidpad and 4.2 s to
 * 100 km/h (tier 5) meet in one car: the launch is grip-limited to about 140 km/h at tier 5.
 */
import { type CarClass } from './types';

export const MUSCLE: Readonly<CarClass> = {
  id: 'muscle',
  name: 'Bruiser V8',
  frontDriveShare: 0,
  massBase: 1400,
  massPerTier: 70,
  torqueBase: 1100,
  torquePerTier: 850,
  dragBase: 4.3,
  dragPerAero: 1.4,
  frontWingMax: 6,
  // 1.35 before Handling v2 (1.10–1.19 g on the skidpad against the plan's 0.95 g row).
  traction: 1.28,
  frontBodyLift: 3.2,
  rearDownforce: 1.8,
  driveWheelRadius: 0.36,
  // The legacy launch boost (1.8 to 90 km/h) is 1st gear now: unused while `engine` is set.
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: 0.015,
  wheelbase: 2.85,
  cgHeight: 0.52,
  frontWeightNeutral: 0.54,
  frontWeightRange: 0.15,
  suspensionStiffnessBase: 42,
  suspensionBalanceSplit: 0.3,
  jumpSpeedScale: 1.014,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 12,
  engine: {
    gears: 5,
    firstGearFrac: 0.36,
    torqueCurve: [0.6, 0.9, 1.0, 1.0, 0.98, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7],
    shiftUpFrac: 0.95,
    shiftCutS: 0.1,
  },
};
