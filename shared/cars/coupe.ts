/**
 * Red rear-engined road coupe: 60 % of its weight on the back axle, so it hooks up off the line
 * where the hypercar lights its tyres, its nose goes light early at speed (body lift 2.2 against a
 * 5.5 wing: below 40 % wing the front is net-lifting) and its rear slides more than the hypercar's
 * for the same steering (2.4× the rear slip near the limit). Same mass band as the hypercar with a
 * little less torque and drag.
 */
import { type CarClass } from './types';

export const COUPE: Readonly<CarClass> = {
  id: 'coupe',
  name: 'Ember Swallowtail',
  frontDriveShare: 0,
  massBase: 1160,
  massPerTier: 50,
  torqueBase: 760,
  torquePerTier: 620,
  dragBase: 2.8,
  dragPerAero: 1.5,
  frontWingMax: 5.5,
  // Handling v2: 1.5 held 1.36 g at 33 m/s on the bench; the 1.15 g row of the plan wants a road tyre.
  traction: 1.27,
  frontBodyLift: 2.2,
  rearDownforce: 2.3,
  driveWheelRadius: 0.35,
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: 0.015,
  wheelbase: 2.5,
  cgHeight: 0.47,
  frontWeightNeutral: 0.4,
  frontWeightRange: 0.15,
  suspensionStiffnessBase: 55,
  suspensionBalanceSplit: 0.3,
  // Chaos jump, tier 5 (sim): 40 % wing fell at 182.0 at the lip, 36 % cleared at 183.4 → scale 1.02;
  // 20 % / balance 0 (lift-off 11.2 km/h above top speed) ran off before the lip, 24 % cleared → reserve 12.
  jumpSpeedScale: 1.02,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 12,
  /**
   * Handling v2 engine: the 6-speed gearing of its flat-six sound (0.3 first-gear span), a curve with a
   * broad plateau from 50 % to 70 % of the redline that falls to 86 % of it at the top-gear fit point
   * (93 %), 90 ms shift cuts. Top gear at 93 % of the redline is exactly the estimated top speed.
   */
  engine: {
    gears: 6,
    firstGearFrac: 0.3,
    torqueCurve: [0.5, 0.68, 0.82, 0.92, 0.98, 1.0, 1.0, 0.98, 0.94, 0.88, 0.8],
    shiftUpFrac: 0.96,
    shiftCutS: 0.09,
  },
};
