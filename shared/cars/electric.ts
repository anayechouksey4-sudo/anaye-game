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
  traction: 1.5,
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
};
