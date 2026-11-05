/**
 * SHUTTER GATES: pairs of kinematic walls slide in from both deck edges, meet on the centreline,
 * hold, and retract. Their motion is a pure function of the hazard clock (deterministic); being
 * kinematicPosition bodies they shove the car with effectively infinite mass — a clipped car is
 * flung sideways off the deck, a head-on hit at a closed shutter stops it dead.
 */
import { useEffect, useMemo, useRef } from 'react';
import { CuboidCollider, RigidBody, useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import type { BufferGeometry } from 'three';
import { PHYSICS_DT } from '../../../config';
import { COLORS, SLIDERS } from '../config';
import { chaosRuntime, register, type ShutterProbe } from '../chaosRuntime';
import { hazardClock } from '../hazardClock';
import type { ShutterSpec, SliderSegment } from '../plan';
import { createVoxelMaterial, VoxelBuilder } from '../voxel';

const smootherstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Closure 0 (open) … 1 (closed) at time t. */
export function shutterClosure(spec: ShutterSpec, t: number): number {
  const u = (((t / spec.period + spec.phase) % 1) + 1) % 1;
  const c = SLIDERS.closingFraction;
  const h = SLIDERS.closedFraction;
  const o = SLIDERS.openingFraction;
  if (u < c) return smootherstep(u / c);
  if (u < c + h) return 1;
  if (u < c + h + o) return 1 - smootherstep((u - c - h) / o);
  return 0;
}

/** Distance from the centreline to each wall's inner face; fully open parks the walls beyond the deck edge. */
function innerEdge(spec: ShutterSpec, closure: number): number {
  return (1 - closure) * (spec.halfSpan + 0.6);
}

function buildWallGeometry(spec: ShutterSpec, side: 1 | -1): BufferGeometry {
  const L = spec.wallLength;
  const H = spec.height;
  const T = spec.thickness;
  const v = new VoxelBuilder();
  v.box([0, 0, 0], [L, H, T], '#1b1724', 0);
  // Diagonal-ish hazard blocks on both faces.
  const n = Math.round(L / 1.2);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const yellow = i % 2 === 0;
    for (const fz of [-1, 1]) {
      v.box([x, -H * 0.12, fz * (T / 2 + 0.02)], [L / n - 0.04, H * 0.42, 0.06], yellow ? COLORS.yellow : COLORS.black, yellow ? 0.45 : 0);
    }
  }
  v.box([0, H / 2 + 0.06, 0], [L, 0.12, T + 0.04], COLORS.magenta, 2.8);
  // Leading edge (the face that meets the other wall) glows bright so the closing gap is readable.
  v.box([-side * (L / 2 + 0.04), 0, 0], [0.08, H, T + 0.04], COLORS.magenta, 3.2);
  return v.build();
}

function Wall({ spec, side }: { spec: ShutterSpec; side: 1 | -1 }) {
  const ref = useRef<RapierRigidBody>(null);
  const geometry = useMemo(() => buildWallGeometry(spec, side), [spec, side]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => createVoxelMaterial({ roughness: 0.5, metalness: 0.3 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const y = spec.position[1] + spec.height / 2 + 0.02;
  const xAt = (t: number) => spec.position[0] + side * (innerEdge(spec, shutterClosure(spec, t)) + spec.wallLength / 2);

  const target = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  useBeforePhysicsStep(() => {
    target.x = xAt(hazardClock.time + PHYSICS_DT);
    target.y = y;
    target.z = spec.position[2];
    ref.current?.setNextKinematicTranslation(target);
  });

  return (
    <RigidBody ref={ref} type="kinematicPosition" colliders={false} position={[xAt(hazardClock.time), y, spec.position[2]]} name={`${spec.id}-${side > 0 ? 'L' : 'R'}`}>
      <CuboidCollider args={[spec.wallLength / 2, spec.height / 2, spec.thickness / 2]} friction={0.4} restitution={0.1} />
      <mesh geometry={geometry} material={material} castShadow />
    </RigidBody>
  );
}

export function SlidingWalls({ segment }: { segment: SliderSegment }) {
  useEffect(
    () =>
      register(chaosRuntime.shutterSources, {
        probe: (): ShutterProbe[] =>
          segment.shutters.map((s) => {
            const closure = shutterClosure(s, hazardClock.time);
            return { id: s.id, closure, gap: 2 * innerEdge(s, closure) };
          }),
      }),
    [segment],
  );
  return (
    <group name={segment.id}>
      {segment.shutters.map((s) => (
        <group key={s.id}>
          <Wall spec={s} side={1} />
          <Wall spec={s} side={-1} />
        </group>
      ))}
    </group>
  );
}
