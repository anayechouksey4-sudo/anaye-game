/**
 * PENDULUM ALLEY: giant wrecking blocks on Rapier revolute (hinge) joints, swinging ACROSS the
 * track (hinge axis = driving direction, +Z). Each bob is a real 15 t dynamic body: gravity
 * swings it, contacts with the car are solved normally (the car gets thrown, the bob barely
 * notices), and a joint motor that tracks the ideal free swing replaces friction losses and pulls
 * it back into phase after an impact — so the timing windows stay readable forever.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  useRevoluteJoint,
  type RapierRigidBody,
} from '@react-three/rapier';
import type { BufferGeometry } from 'three';
import { PHYSICS_DT } from '../../../config';
import { onGameEvent } from '../../../game/events';
import { COLORS, PENDULUM } from '../config';
import { chaosRuntime, register, type PendulumProbe } from '../chaosRuntime';
import { hazardClock } from '../hazardClock';
import type { PendulumSegment, PendulumSpec } from '../plan';
import { createVoxelMaterial, VoxelBuilder } from '../voxel';

const HINGE_AXIS: [number, number, number] = [0, 0, 1];
const RAD = 180 / Math.PI;

/** Pose + velocity of the free swing at time t (world space). */
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

function buildBobGeometry(spec: PendulumSpec): BufferGeometry {
  const [w, h, d] = spec.bobSize;
  const L = spec.armLength;
  const v = new VoxelBuilder();
  // Bob (local origin = bob centre; the hinge is at +L on local Y).
  v.box([0, 0, 0], [w, h, d], '#2a1030', 0.05);
  // Hazard band and glowing magenta frame.
  for (let i = 0; i < 6; i++) {
    v.box([-w / 2 + (i + 0.5) * (w / 6), -h * 0.1, 0], [w / 6 - 0.02, h * 0.28, d + 0.06], i % 2 === 0 ? COLORS.yellow : COLORS.black, i % 2 === 0 ? 0.5 : 0);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) v.box([sx * (w / 2), 0, sz * (d / 2)], [0.16, h + 0.1, 0.16], COLORS.magenta, 3);
    v.box([sx * (w / 2), h / 2, 0], [0.16, 0.16, d + 0.1], COLORS.magenta, 3);
    v.box([sx * (w / 2), -h / 2, 0], [0.16, 0.16, d + 0.1], COLORS.magenta, 3);
    // Voxel studs on the striking faces.
    for (let k = 0; k < 3; k++) v.box([sx * (w / 2 + 0.22), h * 0.32, -d / 3 + (k * d) / 3], [0.44, 0.5, 0.5], '#3a1640', 0.15);
  }
  v.box([0, h / 2, 0], [w + 0.1, 0.16, 0.16], COLORS.magenta, 3);
  v.box([0, -h / 2, 0], [w + 0.1, 0.16, 0.16], COLORS.magenta, 3);
  // Arm up to the hinge, with a glowing spine so the swing reads at night.
  const armLen = L - h / 2 - 0.4;
  v.box([0, h / 2 + armLen / 2, 0], [0.7, armLen, 0.7], '#1d1a26', 0);
  v.box([0, h / 2 + armLen / 2, 0.36], [0.12, armLen, 0.04], COLORS.cyan, 2.2);
  v.box([0, h / 2 + armLen / 2, -0.36], [0.12, armLen, 0.04], COLORS.cyan, 2.2);
  v.box([0, L, 0], [1.3, 1.3, 1.5], '#2b2b38', 0);
  return v.build();
}

function Pendulum({ spec }: { spec: PendulumSpec }) {
  const { rapier } = useRapier();
  const anchorRef = useRef<RapierRigidBody>(null);
  const bobRef = useRef<RapierRigidBody>(null);
  const configured = useRef(false);
  const targetRef = useRef(0);
  // r3r types the refs as non-null; the joint is only created once both bodies exist.
  const joint = useRevoluteJoint(anchorRef as RefObject<RapierRigidBody>, bobRef as RefObject<RapierRigidBody>, [
    [0, 0, 0],
    [0, spec.armLength, 0],
    HINGE_AXIS,
  ]);
  const initial = useMemo(() => pendulumStateAt(spec, 0), [spec]);
  const geometry = useMemo(() => buildBobGeometry(spec), [spec]);
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
      onGameEvent('restart', () => place(0)),
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
    const j = joint.current;
    if (!j) return;
    if (!configured.current) {
      j.configureMotorModel(rapier.MotorModel.AccelerationBased);
      configured.current = true;
    }
    const s = pendulumStateAt(spec, hazardClock.time + PHYSICS_DT);
    targetRef.current = s.theta;
    j.configureMotor(s.theta, s.thetaDot, PENDULUM.motorStiffness, PENDULUM.motorDamping);
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
        <CuboidCollider args={[w / 2, h / 2, d / 2]} mass={spec.mass} friction={PENDULUM.friction} restitution={PENDULUM.restitution} />
        <mesh geometry={geometry} material={material} castShadow />
      </RigidBody>
    </>
  );
}

export function PendulumGauntlet({ segment }: { segment: PendulumSegment }) {
  return (
    <group name={segment.id}>
      {segment.pendulums.map((p) => (
        <Pendulum key={p.id} spec={p} />
      ))}
    </group>
  );
}
