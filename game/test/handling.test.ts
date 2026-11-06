/**
 * Handling v2 — the pure parts (node only, no Rapier):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/handling.test.ts
 * Load sensitivity, the friction ellipse, the torque curve shared with the protocol's estimates,
 * Ackermann, the ABS cap, the differential lock, and the invariants stage B must keep per class.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAR_CLASSES,
  CAR_CLASS_IDS,
  GRAVITY,
  LAUNCH_RPM_FRAC,
  TOP_GEAR_RPM_FRAC,
  balanceToSuspensionStiffness,
  driveForceAtSpeedN,
  driveForceN,
  engineDriveForceN,
  engineRpmFrac,
  estimateFrontLiftOffKmh,
  estimateTopSpeedKmh,
  gearForSpeed,
  gearRatioToTop,
  mapSquadControlsToPhysics,
  redlineSpeedMs,
  torqueCurveAt,
  torqueShape,
  type CarClass,
  type EngineModel,
} from '@shared/protocol';
import { PHYSICS_DT } from '../src/config';
import {
  FRICTION_LOAD_RATIO_MAX,
  LOAD_SCALE_MAX,
  LOAD_SCALE_MIN,
  absBrakeCap,
  ackermannAngles,
  antiRollTransferN,
  brakeFrontShare,
  diffLockTransfer,
  driveSlipRatio,
  frictionEllipseScale,
  frictionSlipForLoad,
  lateralBudgetScale,
  loadSensitivityScale,
  tractionControlFactor,
} from '../src/car/handling';
import { ALL_VEHICLE_SPECS, chassisInertiaFor, getVehicleSpec } from '../src/car/vehicleSpec';
import { ROLL_STABILITY_MAX, rollStabilityNumber, stableRollInertia } from '../src/track/world/physics/rollStability';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

/** A 7-speed sample engine (the hypercar's audio gearing) with a peak at 75 % of the redline. */
const SAMPLE: EngineModel = { gears: 7, firstGearFrac: 0.27, torqueCurve: [0.55, 0.7, 0.82, 0.92, 0.98, 1, 1, 0.98, 0.95, 0.9, 0.84], shiftUpFrac: 0.96, shiftCutS: 0.05 };

test('load sensitivity: 1 at the static load, less grip per newton above it, clamped both ways', () => {
  close(loadSensitivityScale(3000, 3000, 0.18), 1);
  close(loadSensitivityScale(6000, 3000, 0.18), Math.pow(2, -0.18));
  assert.ok(loadSensitivityScale(6000, 3000, 0.18) < 1 && loadSensitivityScale(1500, 3000, 0.18) > 1);
  // Twice the load never gives twice the force (that is the point): force ratio < 2.
  assert.ok((2 * loadSensitivityScale(6000, 3000, 0.18)) < 2);
  assert.equal(loadSensitivityScale(0, 3000, 0.18), LOAD_SCALE_MAX);
  assert.equal(loadSensitivityScale(1e6, 3000, 0.18), LOAD_SCALE_MIN);
  assert.equal(loadSensitivityScale(5000, 3000, 0), 1);
  assert.equal(loadSensitivityScale(5000, 0, 0.18), 1);
});

test('friction ellipse: free below the reference slips, 1/demand beyond, symmetric in its axes', () => {
  assert.equal(frictionEllipseScale(0, 0, 6, 4), 1);
  assert.equal(frictionEllipseScale(3, 2, 6, 4), 1);
  close(frictionEllipseScale(6, 4, 6, 4), 1 / Math.SQRT2);
  close(frictionEllipseScale(12, 0, 6, 4), 0.5);
  close(frictionEllipseScale(0, 8, 6, 4), 0.5);
  assert.ok(frictionEllipseScale(9, 6, 6, 4) < frictionEllipseScale(6, 4, 6, 4));
  close(lateralBudgetScale(0, 4, 0.5), 1);
  close(lateralBudgetScale(2, 4, 0.5), 0.75);
  close(lateralBudgetScale(40, 4, 0.5), 0.5);
});

test('torque curve: linear between samples, held at the ends, unity at the top-gear fit point', () => {
  close(torqueCurveAt(SAMPLE.torqueCurve, 0), 0.55);
  close(torqueCurveAt(SAMPLE.torqueCurve, 1), 0.84);
  close(torqueCurveAt(SAMPLE.torqueCurve, 0.05), 0.625);
  close(torqueCurveAt(SAMPLE.torqueCurve, 1.5), 0.84);
  close(torqueCurveAt([2], 0.3), 2);
  close(torqueShape(SAMPLE, TOP_GEAR_RPM_FRAC), 1);
  assert.ok(torqueShape(SAMPLE, 0.5) > torqueShape(SAMPLE, 0) && torqueShape(SAMPLE, 0.55) > 1);
});

test('gearing: geometric spacing from firstGearFrac, top gear exactly at the fitted top speed', () => {
  const top = 50;
  close(redlineSpeedMs(SAMPLE, 7, top), top / TOP_GEAR_RPM_FRAC);
  close(redlineSpeedMs(SAMPLE, 1, top), (top / TOP_GEAR_RPM_FRAC) * 0.27);
  const step = redlineSpeedMs(SAMPLE, 2, top) / redlineSpeedMs(SAMPLE, 1, top);
  for (let g = 2; g < 7; g++) close(redlineSpeedMs(SAMPLE, g + 1, top) / redlineSpeedMs(SAMPLE, g, top), step, 1e-9);
  close(gearRatioToTop(SAMPLE, 7), 1);
  close(gearRatioToTop(SAMPLE, 1), 1 / 0.27);
  assert.equal(gearForSpeed(SAMPLE, 0, top), 1);
  assert.equal(gearForSpeed(SAMPLE, top, top), 7);
  let prev = 1;
  for (let v = 0; v <= top; v += 0.25) {
    const g = gearForSpeed(SAMPLE, v, top);
    assert.ok(g >= prev, `gear went down at ${v} m/s`);
    prev = g;
  }
  close(engineRpmFrac(SAMPLE, 1, 0, top), LAUNCH_RPM_FRAC);
  close(engineRpmFrac(SAMPLE, 7, top, top), TOP_GEAR_RPM_FRAC);
  const single: EngineModel = { ...SAMPLE, gears: 1 };
  close(redlineSpeedMs(single, 1, top), top / TOP_GEAR_RPM_FRAC);
  assert.equal(gearForSpeed(single, 30, top), 1);
  close(gearRatioToTop(single, 1), 1);
});

test('protocol estimates use the same engine function as the controller: top speed force = engineTorque / r', () => {
  const base = CAR_CLASSES.hypercar;
  const car: CarClass = { ...base, engine: SAMPLE };
  for (const tier of [1, 3, 5]) {
    const p = mapSquadControlsToPhysics({ frontWingAero: 50, engineTier: tier, chassisBalance: 0 }, car);
    const legacyTop = estimateTopSpeedKmh(p, base);
    const top = estimateTopSpeedKmh(p, car);
    // A class without a launch boost keeps its closed-form top speed exactly.
    close(top, legacyTop);
    const topMs = top / 3.6;
    close(driveForceAtSpeedN(p, topMs, car), driveForceN(p, car), 1e-6);
    close(driveForceAtSpeedN(p, topMs, car), engineDriveForceN(SAMPLE, p.engineTorque, car.driveWheelRadius, topMs, topMs), 1e-9);
    // Off the line: 1st gear × the clutch-slip rpm on the curve.
    close(driveForceAtSpeedN(p, 0, car), (p.engineTorque * torqueShape(SAMPLE, LAUNCH_RPM_FRAC) * gearRatioToTop(SAMPLE, 1)) / car.driveWheelRadius, 1e-9);
    assert.ok(driveForceAtSpeedN(p, 0, car) > 3 * driveForceN(p, car));
    // Lift-off: with more drive force below top speed the nose is lighter, never heavier.
    const lo = estimateFrontLiftOffKmh(p, base);
    const lo2 = estimateFrontLiftOffKmh(p, car);
    if (lo !== null && lo2 !== null && lo > 0) assert.ok(lo2 <= lo + 1e-6, `lift-off ${lo2} > legacy ${lo}`);
  }
  // Without an engine model the legacy formulas are untouched (a boosted sample: every class has an engine now).
  const boosted: CarClass = { ...CAR_CLASSES.hypercar, launchBoost: 1.8, launchFadeKmh: 90, engine: undefined };
  const p = mapSquadControlsToPhysics({ frontWingAero: 50, engineTier: 3, chassisBalance: 0 }, boosted);
  close(driveForceAtSpeedN(p, 0, boosted), driveForceN(p, boosted) * boosted.launchBoost);
});

test('Ackermann: the inner wheel turns more, both roll about one centre, parallel at share 0', () => {
  const out = { left: 0, right: 0 };
  const L = 2.7;
  const t = 0.84;
  ackermannAngles(0.3, L, t, 1, out);
  assert.ok(out.left > 0.3 && out.right < 0.3, `left ${out.left} right ${out.right}`);
  close(L / Math.tan(out.left) + t, L / Math.tan(out.right) - t, 1e-9);
  ackermannAngles(-0.3, L, t, 1, out);
  assert.ok(out.right < -0.3 && out.left > -0.3);
  ackermannAngles(0.3, L, t, 0, out);
  assert.equal(out.left, 0.3);
  assert.equal(out.right, 0.3);
  ackermannAngles(0.3, L, t, 0.5, out);
  assert.ok(out.left > 0.3 && out.left < Math.atan(L / (L / Math.tan(0.3) - t)));
  ackermannAngles(0, L, t, 1, out);
  assert.equal(out.left, 0);
});

test('ABS cap, live brake bias and the differential lock', () => {
  close(absBrakeCap(1.45, 3000, PHYSICS_DT, 0.98), 0.98 * 1.45 * 3000 * PHYSICS_DT);
  assert.equal(absBrakeCap(1.45, -5, PHYSICS_DT, 0.98), 0);
  // A pedal demand above the cap is clipped to it; one below passes through.
  assert.ok(Math.min(200, absBrakeCap(1.45, 3000, PHYSICS_DT, 0.98)) < 200);
  assert.equal(Math.min(10, absBrakeCap(1.45, 3000, PHYSICS_DT, 0.98)), 10);
  close(brakeFrontShare(0.62, 7000, 3000, 1), 0.7);
  close(brakeFrontShare(0.62, 7000, 3000, 0), 0.62);
  close(brakeFrontShare(0.62, 9500, 500, 1), 0.8);
  close(brakeFrontShare(0.62, 0, 0, 1), 0.62);
  close(diffLockTransfer(0.35, 2000, 1, 2), 0.35 * 0.5 * 2000 * 0.5);
  close(diffLockTransfer(0.35, 2000, 10, 2), 0.35 * 0.5 * 2000);
  close(diffLockTransfer(0.35, 2000, -10, 2), -0.35 * 0.5 * 2000);
  assert.equal(diffLockTransfer(0, 2000, 10, 2), 0);
});

test('anti-roll bar: a pure transfer bounded by the extended tyre, and a friction cap that reads μ·N', () => {
  // Left compressed by 2 cm: 60000 N/m moves 1200 N onto the left tyre and off the right one.
  close(antiRollTransferN(60000, 0.10, 0.12, 3000, 3000), 1200);
  close(antiRollTransferN(60000, 0.12, 0.10, 3000, 3000), -1200);
  close(antiRollTransferN(60000, 0.1, 0.1, 3000, 3000), 0);
  // The right tyre carries 400 N: the bar can move no more than that (the axle total never changes).
  close(antiRollTransferN(60000, 0.10, 0.12, 3000, 400), 400);
  close(antiRollTransferN(60000, 0.12, 0.10, 400, 3000), -400);
  close(antiRollTransferN(60000, 0.1, 0.15, 3000, 0), 0);
  for (const [sl, sr] of [[3000, 3000], [3000, 400], [4000, 0]]) {
    const f = antiRollTransferN(60000, 0.1, 0.13, sl, sr);
    const nl = sl + f;
    const nr = sr - f;
    assert.ok(nr >= 0 && nl >= 0, `${nl} / ${nr}`);
    close(nl + nr, sl + sr);
  }
  // Rapier caps at frictionSlip × spring: scaled by N / spring the cap is μ·N, and a stiff bar (N = 2 S
  // on the loaded tyre, 0 on the unloaded one) sums to the same μ × axle load as no bar at all.
  close(frictionSlipForLoad(1.4, 6000, 3000) * 3000, 1.4 * 6000);
  close(frictionSlipForLoad(1.4, 0, 3000) * 3000, 0);
  close(frictionSlipForLoad(1.4, 6000, 3000) * 3000 + frictionSlipForLoad(1.4, 0, 3000) * 3000, 1.4 * 6000);
  assert.equal(frictionSlipForLoad(1.4, 3000, 3000), 1.4);
  assert.equal(frictionSlipForLoad(1.4, 500, 0), 1.4);
  close(frictionSlipForLoad(1.4, 1e6, 10), 1.4 * FRICTION_LOAD_RATIO_MAX);
});

test('reverse: flat torque × reverseTorqueRatio, and traction control sees backwards wheelspin', () => {
  // The controller's reverse torque is −engineTorque × throttle × ratio for every class (no gear multiplication).
  for (const id of CAR_CLASS_IDS) {
    const spec = getVehicleSpec(id);
    const p = mapSquadControlsToPhysics({ frontWingAero: 50, engineTier: 5, chassisBalance: 0 }, CAR_CLASSES[id]);
    const reverse = p.engineTorque * spec.tuning.reverseTorqueRatio;
    // Less than the rears can hold at a standstill: a car held on the brake never spins its wheels backwards.
    const rearStatic = p.mass * GRAVITY * (1 - CAR_CLASSES[id].frontWeightNeutral);
    const rearGrip = p.traction * spec.tuning.longitudinalGripRatio * rearStatic * CAR_CLASSES[id].driveWheelRadius;
    assert.ok(reverse < rearGrip, `${id}: reverse torque ${reverse.toFixed(0)} N·m vs rear budget ${rearGrip.toFixed(0)} at tier 5`);
    if (CAR_CLASSES[id].engine) assert.ok(reverse < p.engineTorque * gearRatioToTop(CAR_CLASSES[id].engine!, 1), `${id}: 1st gear would be ${gearRatioToTop(CAR_CLASSES[id].engine!, 1).toFixed(2)}× more`);
  }
  // Slip ratio in the drive direction: a wheel spinning backwards while reversing reads positive.
  close(driveSlipRatio(-6, -1, -1, 10), 0.5);
  close(driveSlipRatio(6, 1, 1, 10), 0.5);
  close(driveSlipRatio(-6, -1, 1, 10), -0.5);
  close(driveSlipRatio(30, 20, 1, 10), 0.5);
  // The TC factor drops at once past tcSlip and recovers at tcRecover per second.
  close(tractionControlFactor(1, 0.4, 0.15, 4, 1.5, PHYSICS_DT), Math.max(0.15, 1 - 0.25 * 4), 1e-9);
  close(tractionControlFactor(0.5, 0.0, 0.15, 4, 1.5, PHYSICS_DT), 0.5 + 1.5 * PHYSICS_DT);
  assert.equal(tractionControlFactor(1, 0.0, 0.15, 4, 1.5, PHYSICS_DT), 1);
  assert.equal(tractionControlFactor(1, -0.4, 0.15, 4, 1.5, PHYSICS_DT), 1);
});

test('every class: an engine model implies handlingV2, the roll-stability number stays ≤ 1.6 on the island', () => {
  for (const id of CAR_CLASS_IDS) {
    const spec = getVehicleSpec(id);
    const car = CAR_CLASSES[id];
    if (car.engine) {
      assert.equal(spec.tuning.handlingV2, true, `${id} has an engine model but handlingV2 off`);
      assert.ok(car.engine.torqueCurve.length >= 2 && car.engine.gears >= 1 && car.engine.firstGearFrac > 0 && car.engine.firstGearFrac <= 1);
      assert.ok(car.engine.shiftUpFrac > TOP_GEAR_RPM_FRAC, `${id}: top gear must still be the gear held at top speed`);
    }
    for (const tier of [1, 5]) {
      for (const balance of [-1, 0, 1]) {
        const p = mapSquadControlsToPhysics({ frontWingAero: 50, engineTier: tier, chassisBalance: balance * 50 }, car);
        const k = balanceToSuspensionStiffness(p.balance, car);
        const inertia = stableRollInertia(spec, p.mass, k, chassisInertiaFor(spec, p.mass));
        const n = rollStabilityNumber(spec, p.mass, k, inertia[2]);
        assert.ok(n <= ROLL_STABILITY_MAX + 1e-9, `${id} tier ${tier} balance ${balance}: roll stability ${n.toFixed(2)}`);
      }
    }
  }
  assert.equal(ALL_VEHICLE_SPECS.length, CAR_CLASS_IDS.length);
  assert.equal(GRAVITY, 9.81);
});
