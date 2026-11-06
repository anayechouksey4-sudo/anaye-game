/**
 * PENDULUM ALLEY: giant wrecking blocks on Rapier revolute (hinge) joints, swinging ACROSS the
 * track (hinge axis = driving direction, +Z). Each bob is a real 15 t dynamic body: gravity
 * swings it, contacts with the car are solved normally (the car gets thrown, the bob barely
 * notices), and a gentle hinge drive tracks the ideal free swing so impacts are recovered from
 * and the staggered timing windows stay readable forever.
 *
 * The drive is an explicit, clamped PD torque on the bob rather than Rapier's joint motor: the
 * AccelerationBased motor scales its gains by the bob's own centre-of-mass inertia (~25 t·m²)
 * instead of the pendulum's inertia about the hinge (~2.2 kt·m²), so it is ~90× weaker than
 * configured, and its soft-constraint coupling bled energy out of the swing (50° → 19° in 4 min).
 * The bare hinge is nearly lossless, so in steady state the drive does almost no work.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  CuboidCollider,
  RigidBody,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRevoluteJoint,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier';
import type { World } from '@dimforge/rapier3d-compat';
import type { BufferGeometry } from 'three';
import { PHYSICS_DT } from '../../../config';
import { carRuntime } from '../../../car/runtime';
import { onGameEvent } from '../../../game/events';
import { gameState } from '../../../state/store';
import { COLORS, PENDULUM } from '../config';
import { chaosRuntime, register, type PendulumProbe } from '../chaosRuntime';
import { hazardClock } from '../hazardClock';
import type { PendulumSegment, PendulumSpec } from '../plan';
import { CHAOS_PALETTE, type TrackPalette } from '../recipe';
import { createVoxelMaterial, VoxelBuilder } from '../voxel';

const HINGE_AXIS: [number, number, number] = [0, 0, 1];
const RAD = 180 / Math.PI;

/** Pose + velocity of the free swing at time t (world space). */
/** θ and θ̇ of the ideal free swing at hazard time t, written into `out` (no allocation: runs every step). */
export function pendulumSwingAt(spec: PendulumSpec, t: number, out: { theta: number; thetaDot: number }): void {
  const arg = spec.omega * t + spec.phase;
  out.theta = spec.amplitude * Math.sin(arg);
  out.thetaDot = spec.amplitude * spec.omega * Math.cos(arg);
}

export function pendulumStateAt(spec: PendulumSpec, t: number) {
  const arg = spec.omega * t + spec.phase;
  const theta = spec.amplitude * Math.sin(arg);
  const thetaDot = spec.amplitude * spec.omega * Math.cos(arg);
  const L = spec.armLength;
  const [px, py, pz] = spec.pivot;
  return {
    theta,
    thetaDot,
    position: { x: px + L * Math.sin(theta), y: py - L * Math.cos(theta), z: pz },
    rotation: { x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) },
    linvel: { x: thetaDot * L * Math.cos(theta), y: thetaDot * L * Math.sin(theta), z: 0 },
    angvel: { x: 0, y: 0, z: thetaDot },
  };
}

function buildBobGeometry(spec: PendulumSpec, palette: TrackPalette): BufferGeometry {
  const [w, h, d] = spec.bobSize;
  const L = spec.armLength;
  const frame = palette.glow.magenta;
  const spine = palette.glow.cyan;
  const v = new VoxelBuilder();
  // Bob (local origin = bob centre; the hinge is at +L on local Y).
  v.box([0, 0, 0], [w, h, d], palette.hazard.bob, 0.05);
  // Hazard band and glowing magenta frame.
  for (let i = 0; i < 6; i++) {
    v.box([-w / 2 + (i + 0.5) * (w / 6), -h * 0.1, 0], [w / 6 - 0.02, h * 0.28, d + 0.06], i % 2 === 0 ? COLORS.yellow : COLORS.black, i % 2 === 0 ? 0.5 : 0);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) v.box([sx * (w / 2), 0, sz * (d / 2)], [0.16, h + 0.1, 0.16], frame, 3);
    v.box([sx * (w / 2), h / 2, 0], [0.16, 0.16, d + 0.1], frame, 3);
    v.box([sx * (w / 2), -h / 2, 0], [0.16, 0.16, d + 0.1], frame, 3);
    // Voxel studs on the striking faces.
    for (let k = 0; k < 3; k++) v.box([sx * (w / 2 + 0.22), h * 0.32, -d / 3 + (k * d) / 3], [0.44, 0.5, 0.5], palette.hazard.stud, 0.15);
  }
  v.box([0, h / 2, 0], [w + 0.1, 0.16, 0.16], frame, 3);
  v.box([0, -h / 2, 0], [w + 0.1, 0.16, 0.16], frame, 3);
  // Arm up to the hinge, with a glowing spine so the swing reads at night.
  const armLen = L - h / 2 - 0.4;
  v.box([0, h / 2 + armLen / 2, 0], [0.7, armLen, 0.7], palette.hazard.arm, 0);
  v.box([0, h / 2 + armLen / 2, 0.36], [0.12, armLen, 0.04], spine, 2.2);
  v.box([0, h / 2 + armLen / 2, -0.36], [0.12, armLen, 0.04], spine, 2.2);
  v.box([0, L, 0], [1.3, 1.3, 1.5], '#2b2b38', 0);
  return v.build();
}

/** Is the car's chassis collider touching `collider` (narrow phase of the step just taken)? */
function touchesCar(world: World, collider: RapierCollider | null): boolean {
  const handle = carRuntime.chassisColliderHandle;
  if (!collider || handle === null) return false;
  const chassis = world.getCollider(handle);
  if (!chassis) return false;
  let touching = false;
  world.contactPair(chassis, collider, (manifold) => {
    if (manifold.numContacts() > 0) touching = true;
  });
  return touching;
}

/** Moment of inertia about the hinge per unit mass (box bob on a massless arm), m². */
function hingeInertiaPerKg(spec: PendulumSpec): number {
  const [a, b] = spec.bobSize;
  return (a * a + b * b) / 12 + spec.armLength * spec.armLength;
}

function Pendulum({ spec, palette }: { spec: PendulumSpec; palette: TrackPalette }) {
  const anchorRef = useRef<RapierRigidBody>(null);
  const bobRef = useRef<RapierRigidBody>(null);
  const bobColliderRef = useRef<RapierCollider>(null);
  const targetRef = useRef(0);
  const torque = useRef({ x: 0, y: 0, z: 0 });
  const swing = useRef({ theta: 0, thetaDot: 0 });
  const pinnedTime = useRef(0);
  // r3r types the refs as non-null; the joint is only created once both bodies exist.
  useRevoluteJoint(anchorRef as RefObject<RapierRigidBody>, bobRef as RefObject<RapierRigidBody>, [
    [0, 0, 0],
    [0, spec.armLength, 0],
    HINGE_AXIS,
  ]);
  const hingeInertia = useMemo(() => spec.mass * hingeInertiaPerKg(spec), [spec]);
  const initial = useMemo(() => pendulumStateAt(spec, 0), [spec]);
  const geometry = useMemo(() => buildBobGeometry(spec, palette), [spec, palette]);
  const material = useMemo(() => createVoxelMaterial({ roughness: 0.55, metalness: 0.35 }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const place = (t: number) => {
      const body = bobRef.current;
      if (!body) return;
      const s = pendulumStateAt(spec, t);
      body.setTranslation(s.position, true);
      body.setRotation(s.rotation, true);
      body.setLinvel(s.linvel, true);
      body.setAngvel(s.angvel, true);
    };
    place(hazardClock.time);
    const offs = [
      onGameEvent('restart', () => {
        place(0);
        pinnedTime.current = 0;
      }),
      onGameEvent('respawn', () => {
        pinnedTime.current = 0;
      }),
      register(chaosRuntime.pendulumSources, {
        probe: (): PendulumProbe[] => {
          const body = bobRef.current;
          if (!body) return [];
          const r = body.rotation();
          const t = body.translation();
          const lv = body.linvel();
          return [
            {
              id: spec.id,
              angleDeg: 2 * Math.atan2(r.z, r.w) * RAD,
              targetDeg: targetRef.current * RAD,
              angularVelocity: body.angvel().z,
              bob: { x: t.x, y: t.y, z: t.z },
              bobVelocity: { x: lv.x, y: lv.y, z: lv.z },
            },
          ];
        },
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [spec]);

  useBeforePhysicsStep(() => {
    const body = bobRef.current;
    if (!body) return;
    // Track the free swing at the START of this step (the state the integrator begins from).
    const s = swing.current;
    pendulumSwingAt(spec, hazardClock.time, s);
    targetRef.current = s.theta;
    const r = body.rotation();
    const theta = 2 * Math.atan2(r.z, r.w);
    const thetaDot = body.angvel().z;
    const { stiffness, damping, maxAccel } = chaosRuntime.pendulumDrive;
    const accel = Math.max(-maxAccel, Math.min(maxAccel, stiffness * (s.theta - theta) + damping * (s.thetaDot - thetaDot)));
    torque.current.z = hingeInertia * accel * PHYSICS_DT;
    body.applyTorqueImpulse(torque.current, true);
  });

  // Safety net: a car crushed under a 15 t bob can't drive out, and nothing else would respawn it.
  // Only while the bob actually bears on the car: a car stopped at the deck edge is swept over with
  // clearance for seconds per half-swing, and must not be sent back to the checkpoint for waiting.
  useAfterPhysicsStep((world) => {
    const body = bobRef.current;
    if (!body || !carRuntime.ready) return;
    const b = body.translation();
    const c = carRuntime.position;
    const [bw, , bd] = spec.bobSize;
    const underBob = Math.abs(c.x - b.x) < bw / 2 + 1.2 && Math.abs(c.z - b.z) < bd / 2 + 2.4 && c.y < b.y;
    const pinned = underBob && carRuntime.velocity.length() < 1 && touchesCar(world, bobColliderRef.current);
    pinnedTime.current = pinned ? pinnedTime.current + PHYSICS_DT : 0;
    if (pinnedTime.current > PENDULUM.pinnedRespawnS) {
      pinnedTime.current = 0;
      gameState().respawn('flipped');
    }
  });

  const [w, h, d] = spec.bobSize;
  return (
    <>
      <RigidBody ref={anchorRef} type="fixed" colliders={false} position={spec.pivot} />
      <RigidBody
        ref={bobRef}
        type="dynamic"
        colliders={false}
        canSleep={false}
        position={[initial.position.x, initial.position.y, initial.position.z]}
        quaternion={[initial.rotation.x, initial.rotation.y, initial.rotation.z, initial.rotation.w]}
        linearDamping={0}
        angularDamping={0}
        name={spec.id}
      >
        <CuboidCollider ref={bobColliderRef} args={[w / 2, h / 2, d / 2]} mass={spec.mass} friction={PENDULUM.friction} restitution={PENDULUM.restitution} />
        <mesh geometry={geometry} material={material} castShadow />
      </RigidBody>
    </>
  );
}

export function PendulumGauntlet({ segment, palette = CHAOS_PALETTE }: { segment: PendulumSegment; palette?: TrackPalette }) {
  return (
    <group name={segment.id}>
      {segment.pendulums.map((p) => (
        <Pendulum key={p.id} spec={p} palette={palette} />
      ))}
    </group>
  );
}
