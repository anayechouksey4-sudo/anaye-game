/**
 * Tyre smoke, in WORLD space (a sibling of the car's RigidBody, so puffs stay where they were
 * laid down). One InstancedMesh of voxel puffs (SmokePool), fed every frame from carRuntime:
 *
 *   emit when a rear wheel is on the ground and its slip01 passes SLIP_START (wheelspin on tier
 *   4–5 launches, burnouts, handbrake turns, slides); rate and puff size/opacity scale with slip.
 *   Spinning tyres throw smoke backwards, sliding tyres throw it sideways.
 *
 *   All-wheel-drive cars (a driven front axle in the car's spec) also kick up launch dust: their
 *   centre diff keeps every tyre inside its grip, so a hard launch shows no wheelspin smoke. While
 *   the throttle is down below ~40 km/h, light dust puffs leave each driven wheel on the ground,
 *   scaled by the drive force over the tyres' grip (smokeRules.ts launchDustIntensity), a little
 *   more for the buggy, pale snow spray on ice. Purely visual: nothing here touches the physics.
 *   Same pool and the same budget: dust only gets what the rears' smoke leaves of the
 *   2 × MAX_RATE_PER_WHEEL puffs/s, so the particle count and draw calls never grow. Rear-drive
 *   cars never enter that branch, so their smoke (and every Math.random draw behind it) is unchanged.
 *
 * No React state, no per-frame allocations.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, InstancedMesh, Vector3 } from 'three';
import { PHYSICS_DT } from '../../config';
import { onGameEvent } from '../../game/events';
import { selectionState } from '../../state/selection';
import { gameState } from '../../state/store';
import { carFxDebug } from '../model/carFxDebug';
import { carRuntime, type CarRuntime } from '../runtime';
import { FRONT_WHEELS, REAR_WHEELS, WHEEL_COUNT, type VehicleSpec, type WheelSpec } from '../vehicleSpec';
import { SmokePool, type PuffSpawn } from './smokePool';
import { createSmokeMaterial } from './smokeMaterial';
import { LAUNCH_DUST_AMOUNT, launchDustIntensity, smokeIntensity } from './smokeRules';

export { SLIP_START, launchDustIntensity, smokeIntensity } from './smokeRules';

export const SMOKE_CAPACITY = 384;
/** Puffs per second per rear wheel at full intensity. */
const MAX_RATE_PER_WHEEL = 75;
/** Most puffs per second for the whole car (both rears flat out); driven fronts share it. */
const MAX_RATE_TOTAL = MAX_RATE_PER_WHEEL * REAR_WHEELS.length;
/** Fraction of the car's velocity a fresh puff inherits (the tyre drags the air along). */
const VELOCITY_CARRY = 0.3;
/** Launch-dust puffs per second per driven wheel at full intensity (× LAUNCH_DUST_AMOUNT). */
const DUST_RATE_PER_WHEEL = 24;
/** Dust tint (linear RGB): warm pale grit on tarmac, cool white spray on a low-grip (ice) surface. */
const DUST_TINT = { r: 0.86, g: 0.78, b: 0.66 } as const;
const SNOW_TINT = { r: 0.9, g: 0.96, b: 1 } as const;

const _render = new Vector3();
const _offset = new Vector3();
const spawn: PuffSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 0.3, size1: 1.5, alpha: 0.5, r: 1, g: 1, b: 1 };

/**
 * Spawn the whole puffs in `pending` (puffs owed to this wheel, fractional) at its contact patch;
 * returns the fraction carried to the next frame. Expects `_offset` set for this frame.
 */
function emitPuffs(
  pool: SmokePool,
  w: CarRuntime['wheels'][number],
  wheel: WheelSpec,
  intensity: number,
  pending: number,
  dt: number,
  v: Vector3,
  f: Vector3,
  right: Vector3,
): number {
  const outward = wheel.side === 'left' ? -1 : 1; // world sign along `right`
  // Wheelspin throws smoke back off the tread; a slide throws it out sideways.
  const kickBack = Math.min(w.longitudinalSlip * 0.12, 2.6);
  const kickSide = Math.min(Math.abs(w.lateralSlip) * 0.1, 2);
  while (pending >= 1) {
    pending -= 1;
    const along = -Math.random(); // spread over this frame's travel, so fast slides stay continuous
    const across = (Math.random() - 0.5) * wheel.width;
    const p = w.contactPointWorld;
    spawn.x = p.x + _offset.x + v.x * dt * along + right.x * across - f.x * 0.12;
    spawn.y = p.y + _offset.y + 0.14 + Math.random() * 0.08;
    spawn.z = p.z + _offset.z + v.z * dt * along + right.z * across - f.z * 0.12;
    const side = (Math.random() * 0.8 + 0.2) * (0.4 + kickSide);
    spawn.vx = v.x * VELOCITY_CARRY - f.x * kickBack + right.x * outward * side + (Math.random() - 0.5) * 0.6;
    spawn.vy = 0.45 + Math.random() * 0.7;
    spawn.vz = v.z * VELOCITY_CARRY - f.z * kickBack + right.z * outward * side + (Math.random() - 0.5) * 0.6;
    spawn.life = (1.1 + Math.random() * 0.9) * (0.75 + 0.45 * intensity);
    spawn.size0 = 0.26 + Math.random() * 0.16;
    spawn.size1 = (1.1 + Math.random() * 0.9) * (0.7 + 0.5 * intensity);
    spawn.alpha = (0.3 + Math.random() * 0.22) * (0.55 + 0.45 * intensity);
    const shade = 0.72 + Math.random() * 0.2;
    spawn.r = shade * 0.96;
    spawn.g = shade * 0.98;
    spawn.b = shade;
    pool.spawn(spawn);
  }
  return pending;
}

/**
 * Spawn the whole launch-dust puffs in `pending` at this driven wheel's contact patch (low, thrown
 * back off the tread and out to the side, lighter and shorter-lived than smoke); returns the
 * fraction carried to the next frame. Expects `_offset` set for this frame.
 */
function emitDust(
  pool: SmokePool,
  w: CarRuntime['wheels'][number],
  wheel: WheelSpec,
  intensity: number,
  amount: number,
  tint: { r: number; g: number; b: number },
  pending: number,
  dt: number,
  v: Vector3,
  f: Vector3,
  right: Vector3,
): number {
  const outward = wheel.side === 'left' ? -1 : 1;
  while (pending >= 1) {
    pending -= 1;
    const along = -Math.random();
    const across = (Math.random() - 0.5) * wheel.width;
    const p = w.contactPointWorld;
    spawn.x = p.x + _offset.x + v.x * dt * along + right.x * across - f.x * 0.2;
    spawn.y = p.y + _offset.y + 0.08 + Math.random() * 0.06;
    spawn.z = p.z + _offset.z + v.z * dt * along + right.z * across - f.z * 0.2;
    const back = (1.2 + Math.random() * 1.6) * (0.6 + 0.4 * intensity);
    const side = (0.3 + Math.random() * 0.9) * outward;
    spawn.vx = v.x * VELOCITY_CARRY * 0.5 - f.x * back + right.x * side + (Math.random() - 0.5) * 0.5;
    spawn.vy = 0.25 + Math.random() * 0.45;
    spawn.vz = v.z * VELOCITY_CARRY * 0.5 - f.z * back + right.z * side + (Math.random() - 0.5) * 0.5;
    spawn.life = (0.7 + Math.random() * 0.6) * (0.8 + 0.3 * intensity);
    spawn.size0 = 0.18 + Math.random() * 0.12;
    spawn.size1 = (0.75 + Math.random() * 0.55) * (0.75 + 0.35 * intensity) * Math.sqrt(amount);
    spawn.alpha = (0.2 + Math.random() * 0.14) * (0.6 + 0.4 * intensity) * Math.min(1.2, amount);
    const shade = 0.82 + Math.random() * 0.14;
    spawn.r = shade * tint.r;
    spawn.g = shade * tint.g;
    spawn.b = shade * tint.b;
    pool.spawn(spawn);
  }
  return pending;
}

/** `spec`: the mounted car's geometry (contact patches, tyre widths, which axles are driven). */
export function TireSmoke({ spec }: { spec: VehicleSpec }) {
  const { mesh, pool } = useMemo(() => {
    const geometry = new BoxGeometry(1, 1, 1);
    const instanced = new InstancedMesh(geometry, createSmokeMaterial(), SMOKE_CAPACITY);
    instanced.name = 'tyre-smoke';
    // Puffs span tens of metres behind a sliding car; the bounds would always be stale.
    instanced.frustumCulled = false;
    instanced.castShadow = false;
    instanced.receiveShadow = false;
    instanced.renderOrder = 3;
    instanced.visible = false;
    return { mesh: instanced, pool: new SmokePool(instanced) };
  }, []);

  const emitter = useMemo(
    () => ({ carry: [0, 0] as [number, number], dustCarry: new Array<number>(WHEEL_COUNT).fill(0), rate: 0, dustRate: 0, dustEmitted: 0 }),
    [],
  );
  /** All-wheel drive (a driven front axle): launch dust. Rear-drive specs skip that pass entirely. */
  const allWheelDrive = useMemo(() => FRONT_WHEELS.some((i) => spec.wheels[i]?.driven === true), [spec]);
  const dustAmount = LAUNCH_DUST_AMOUNT[spec.id] ?? 1;

  useEffect(() => {
    const offRestart = onGameEvent('restart', () => pool.clear());
    carFxDebug.smoke = () => ({
      capacity: pool.capacity,
      alive: pool.alive,
      emitted: pool.emitted,
      rate: emitter.rate,
      dustRate: emitter.dustRate,
      dustEmitted: emitter.dustEmitted,
    });
    return () => {
      offRestart();
      carFxDebug.smoke = null;
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
      mesh.dispose();
    };
  }, [mesh, pool, emitter]);

  useFrame((_, delta) => {
    // Paused by the ☰ menu: physics is frozen with the last slip values still set, so neither emit
    // nor age puffs — the smoke hangs in place like everything else and carries on on RESUME.
    if (selectionState().menuOpen) return;
    const dt = Math.min(delta, 0.1);
    const rt = carRuntime;
    emitter.rate = 0;
    emitter.dustRate = 0;

    if (rt.ready && rt.chassisObject) {
      // Contact points are recorded before the step integrates (pose one step behind rt.position),
      // and the rendered car is interpolated a little behind rt.position. Shift spawns by both gaps
      // so puffs leave the wheel you actually see.
      rt.chassisObject.getWorldPosition(_render);
      _offset.subVectors(_render, rt.position).addScaledVector(rt.velocity, PHYSICS_DT);
      const v = rt.velocity;
      const f = rt.forward;
      const right = rt.right;

      for (let n = 0; n < REAR_WHEELS.length; n++) {
        const index = REAR_WHEELS[n] ?? 2;
        const w = rt.wheels[index];
        const wheel = spec.wheels[index];
        if (!w || !wheel) continue;
        const intensity = smokeIntensity(w.inContact, w.slip01);
        if (intensity <= 0) {
          emitter.carry[n] = 0;
          continue;
        }
        const rate = MAX_RATE_PER_WHEEL * intensity;
        emitter.rate += rate;
        emitter.carry[n] = emitPuffs(pool, w, wheel, intensity, (emitter.carry[n] ?? 0) + rate * dt, dt, v, f, right);
      }

      // All-wheel drive: launch dust at every driven wheel on the ground, from whatever the rears'
      // smoke left of the budget.
      if (allWheelDrive) {
        const intensity = launchDustIntensity(rt.throttle, rt.speedKmh, rt.driveForceN, rt.driveGripN);
        let budget = MAX_RATE_TOTAL - emitter.rate;
        const tint = (gameState().trackLayout?.surfaceGrip ?? 1) < 1 ? SNOW_TINT : DUST_TINT;
        for (let index = 0; index < WHEEL_COUNT; index++) {
          const w = rt.wheels[index];
          const wheel = spec.wheels[index];
          if (!w || !wheel || !wheel.driven || !w.inContact || intensity <= 0 || budget <= 0) {
            emitter.dustCarry[index] = 0;
            continue;
          }
          const rate = Math.min(DUST_RATE_PER_WHEEL * dustAmount * intensity, budget);
          budget -= rate;
          emitter.rate += rate;
          emitter.dustRate += rate;
          const pending = (emitter.dustCarry[index] ?? 0) + rate * dt;
          emitter.dustEmitted += Math.floor(pending);
          emitter.dustCarry[index] = emitDust(pool, w, wheel, intensity, dustAmount, tint, pending, dt, v, f, right);
        }
      }
    }

    const alive = pool.alive > 0 || emitter.rate > 0 ? pool.update(dt) : 0;
    mesh.visible = alive > 0;
  });

  return <primitive object={mesh} />;
}
