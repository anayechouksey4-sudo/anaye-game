/**
 * `?track=test` — a 1.85 km flat calibration straight over the void with a kicker ramp near
 * the end. Long enough to reach top speed at every engine tier; the kicker doubles as the
 * speed trap (bigJump) so telemetry can be checked without the chaos track.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { BIG_JUMP_LIP_KMH } from '@shared/protocol';
import { Matrix4, type InstancedMesh } from 'three';
import { Gate } from '../common/Gate';
import type { TrackLayout, Vec3 } from '../types';
import { useRegisterTrackLayout } from '../useTrackLayout';

const WIDTH = 30;
const START_Z = -50;
const END_Z = 1850;
const LENGTH = END_Z - START_Z;
const FLOOR_THICKNESS = 2;

const RAMP_START_Z = 1520;
const RAMP_LENGTH = 22;
const RAMP_ANGLE = (11 * Math.PI) / 180;
const RAMP_WIDTH = 12;
const RAMP_THICKNESS = 0.8;
const RAMP_LIP: Vec3 = [0, RAMP_LENGTH * Math.sin(RAMP_ANGLE), RAMP_START_Z + RAMP_LENGTH * Math.cos(RAMP_ANGLE)];

const GATE_SIZE: Vec3 = [WIDTH, 9, 4];

export const TEST_TRACK_LAYOUT: TrackLayout = {
  id: 'test',
  name: 'Calibration Straight',
  spawn: { position: [0, 0, 0], yaw: 0 },
  checkpoints: [
    { index: 0, position: [0, 0, 0], yaw: 0, size: GATE_SIZE },
    { index: 1, position: [0, 0, 600], yaw: 0, size: GATE_SIZE },
    { index: 2, position: [0, 0, 1200], yaw: 0, size: GATE_SIZE },
  ],
  finish: { position: [0, 0, 1800], yaw: 0, size: GATE_SIZE },
  killY: -25,
  bigJump: { lipPosition: RAMP_LIP, yaw: 0, requiredKmh: BIG_JUMP_LIP_KMH, halfWidth: RAMP_WIDTH / 2 + 2 },
  lengthM: END_Z,
};

/** Centre of a box whose top-face rear edge sits at (0, 0, startZ) after pitching up by `angle`. */
function rampCenter(startZ: number): Vec3 {
  const h = RAMP_THICKNESS / 2;
  const l = RAMP_LENGTH / 2;
  return [0, -h * Math.cos(RAMP_ANGLE) + l * Math.sin(RAMP_ANGLE), startZ + h * Math.sin(RAMP_ANGLE) + l * Math.cos(RAMP_ANGLE)];
}

function LaneStripes() {
  const ref = useRef<InstancedMesh>(null);
  const count = Math.floor(LENGTH / 10);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    for (let i = 0; i < count; i++) {
      const z = START_Z + i * 10;
      const major = Math.round(z) % 100 === 0;
      m.makeScale(major ? WIDTH : 2.5, 1, major ? 0.8 : 0.35).setPosition(0, 0.012, z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 0.02, 1]} />
      <meshStandardMaterial color="#00F0FF" emissive="#00F0FF" emissiveIntensity={0.6} />
    </instancedMesh>
  );
}

export function TestTrack() {
  useRegisterTrackLayout(TEST_TRACK_LAYOUT);
  const ramp = useMemo(() => rampCenter(RAMP_START_Z), []);

  return (
    <group name="test-track">
      <RigidBody type="fixed" colliders={false} name="test-floor">
        <CuboidCollider
          args={[WIDTH / 2, FLOOR_THICKNESS / 2, LENGTH / 2]}
          position={[0, -FLOOR_THICKNESS / 2, START_Z + LENGTH / 2]}
          friction={1}
        />
        <mesh position={[0, -FLOOR_THICKNESS / 2, START_Z + LENGTH / 2]} receiveShadow>
          <boxGeometry args={[WIDTH, FLOOR_THICKNESS, LENGTH]} />
          <meshStandardMaterial color="#0b0e18" roughness={0.85} metalness={0.1} />
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders={false} name="test-kicker" position={ramp} rotation={[-RAMP_ANGLE, 0, 0]}>
        <CuboidCollider args={[RAMP_WIDTH / 2, RAMP_THICKNESS / 2, RAMP_LENGTH / 2]} friction={1} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[RAMP_WIDTH, RAMP_THICKNESS, RAMP_LENGTH]} />
          <meshStandardMaterial color="#1b1030" emissive="#FF2A6D" emissiveIntensity={0.18} />
        </mesh>
      </RigidBody>

      <LaneStripes />
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * WIDTH) / 2, 0.15, START_Z + LENGTH / 2]}>
          <boxGeometry args={[0.3, 0.3, LENGTH]} />
          <meshStandardMaterial color="#FF2A6D" emissive="#FF2A6D" emissiveIntensity={1.2} toneMapped={false} />
        </mesh>
      ))}

      {TEST_TRACK_LAYOUT.checkpoints.slice(1).map((cp) => (
        <Gate key={cp.index} position={cp.position} yaw={cp.yaw} size={cp.size} color="#F5E663" />
      ))}
      <Gate
        position={TEST_TRACK_LAYOUT.finish.position}
        yaw={TEST_TRACK_LAYOUT.finish.yaw}
        size={TEST_TRACK_LAYOUT.finish.size}
        color="#39FF14"
        label="finish"
      />
    </group>
  );
}
