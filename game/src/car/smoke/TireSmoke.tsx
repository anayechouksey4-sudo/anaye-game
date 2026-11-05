/**
 * Rear-tyre smoke, in WORLD space (a sibling of the car's RigidBody, so puffs stay where they were
 * laid down). One InstancedMesh of voxel puffs (SmokePool), fed every frame from carRuntime:
 *
 *   emit when a rear wheel is on the ground and its slip01 passes SLIP_START (wheelspin on tier
 *   4–5 launches, burnouts, handbrake turns, slides); rate and puff size/opacity scale with slip.
 *   Spinning tyres throw smoke backwards, sliding tyres throw it sideways.
 *
 * No React state, no per-frame allocations.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, InstancedMesh, Vector3 } from 'three';
import { PHYSICS_DT } from '../../config';
import { onGameEvent } from '../../game/events';
import { carFxDebug } from '../model/carFxDebug';
import { carRuntime } from '../runtime';
import { REAR_WHEELS, WHEELS } from '../vehicleSpec';
import { SmokePool, type PuffSpawn } from './smokePool';
import { createSmokeMaterial } from './smokeMaterial';

export const SMOKE_CAPACITY = 384;
/** slip01 where smoke starts, and where it reaches full intensity. */
export const SLIP_START = 0.25;
const SLIP_FULL = 0.85;
/** Puffs per second per rear wheel at full intensity. */
const MAX_RATE_PER_WHEEL = 75;
/** Fraction of the car's velocity a fresh puff inherits (the tyre drags the air along). */
const VELOCITY_CARRY = 0.3;

const _render = new Vector3();
const _offset = new Vector3();
const spawn: PuffSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 0.3, size1: 1.5, alpha: 0.5, r: 1, g: 1, b: 1 };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Smoke intensity 0…1 for one rear wheel (0 when gripping or airborne). */
export function smokeIntensity(inContact: boolean, slip01: number): number {
  return inContact ? smoothstep(SLIP_START, SLIP_FULL, slip01) : 0;
}

export function TireSmoke() {
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

  const emitter = useMemo(() => ({ carry: [0, 0] as [number, number], rate: 0 }), []);

  useEffect(() => {
    const offRestart = onGameEvent('restart', () => pool.clear());
    carFxDebug.smoke = () => ({ capacity: pool.capacity, alive: pool.alive, emitted: pool.emitted, rate: emitter.rate });
    return () => {
      offRestart();
      carFxDebug.smoke = null;
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
      mesh.dispose();
    };
  }, [mesh, pool, emitter]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const rt = carRuntime;
    emitter.rate = 0;

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
        const spec = WHEELS[index];
        if (!w || !spec) continue;
        const intensity = smokeIntensity(w.inContact, w.slip01);
        if (intensity <= 0) {
          emitter.carry[n] = 0;
          continue;
        }
        const rate = MAX_RATE_PER_WHEEL * intensity;
        emitter.rate += rate;
        let pending = (emitter.carry[n] ?? 0) + rate * dt;
        const outward = spec.side === 'left' ? -1 : 1; // world sign along `right`
        // Wheelspin throws smoke back off the tread; a slide throws it out sideways.
        const kickBack = Math.min(w.longitudinalSlip * 0.12, 2.6);
        const kickSide = Math.min(Math.abs(w.lateralSlip) * 0.1, 2);
        while (pending >= 1) {
          pending -= 1;
          const along = -Math.random(); // spread over this frame's travel, so fast slides stay continuous
          const across = (Math.random() - 0.5) * spec.width;
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
        emitter.carry[n] = pending;
      }
    }

    const alive = pool.alive > 0 || emitter.rate > 0 ? pool.update(dt) : 0;
    mesh.visible = alive > 0;
  });

  return <primitive object={mesh} />;
}
