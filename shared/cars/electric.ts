/**
 * Heavy, low, dual-motor all-wheel-drive electric saloon: instant shove from a standstill (launch
 * boost 1.8 fading by 100 km/h, inside the all-wheel grip budget), a flat battery floor (lowest
 * centre of mass of the road cars), slippery, 1.9 t. The easiest car to get to the big jump at
 * tier 5 (tier 4 stays just below the chaos lip speed) and the hardest to stop.
 */
import { type CarClass } from './types';

export const ELECTRIC: Readonly<CarClass> = {
  id: 'electric',
  name: 'Ion Dragonfly',
  frontDriveShare: 0.5,
  massBase: 1900,
  massPerTier: 40,
  torqueBase: 1000,
  torquePerTier: 600,
  dragBase: 2.95,
  dragPerAero: 1.6,
  frontWingMax: 5,
  // Handling v2: 1.5 held 1.49 g at 33 m/s on the bench; the 1.15 g row of the plan wants a 2 t saloon's tyre.
  traction: 1.17,
  frontBodyLift: 1.8,
  rearDownforce: 2.0,
  driveWheelRadius: 0.36,
  launchBoost: 1.8,
  launchFadeKmh: 100,
  rollingResistance: 0.013,
  wheelbase: 2.95,
  cgHeight: 0.36,
  frontWeightNeutral: 0.5,
  frontWeightRange: 0.15,
  suspensionStiffnessBase: 60,
  suspensionBalanceSplit: 0.3,
  // 1.9 t lands the chaos jump from 175 km/h (flies flatter), but on the Isles' short run-up it is
  // the car furthest below its estimated top speed: 95 % wing (estimated 163.2) fell at 152.3 at the
  // lip, 60 % cleared at 160.5 → 1.03 keeps READY inside what the sim lands on both maps.
  jumpSpeedScale: 1.03,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 10,
  /**
   * Handling v2 engine: a single-speed motor (the sound's one gear). Flat torque up to about 55 % of
   * the motor's speed range, then the constant-power fall-off of a real traction motor (torque ∝ 1/rpm)
   * down to 45 % at the top-speed fit point (93 %). The dashboard's engineTorque is that top-end figure,
   * so the launch has about 2.2× the top-end force — the "instant shove" the launch boost used to fake.
   * No shifts, no cuts.
   */
  engine: {
    gears: 1,
    firstGearFrac: 1,
    torqueCurve: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 0.82, 0.65, 0.48, 0.38],
    shiftUpFrac: 1,
    shiftCutS: 0,
  },
};
