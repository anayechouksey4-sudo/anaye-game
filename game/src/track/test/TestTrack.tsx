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
import { neonGridTexture } from '../common/neonGridTexture';
import { buildRamp } from '../common/ramp';
import type { TrackLayout, Vec3 } from '../types';
import { useRegisterTrackLayout } from '../useTrackLayout';

const WIDTH = 30;
const START_Z = -50;
const END_Z = 1850;
const LENGTH = END_Z - START_Z;
const FLOOR_THICKNESS = 2;

const RAMP_WIDTH = 12;
const RAMP_THICKNESS = 0.8;
/** Eased kicker: 3° → 6° → 9° → 11° so the suspension isn't slammed on entry. */
const RAMP = buildRamp(
  1510,
  [
    { angleDeg: 3, length: 8 },
    { angleDeg: 6, length: 8 },
    { angleDeg: 9, length: 8 },
    { angleDeg: 11, length: 12 },
  ],
  RAMP_THICKNESS,
);

const GATE_SIZE: Vec3 = [WIDTH, 9, 4];

export const TEST_TRACK_LAYOUT: TrackLayout = {
  id: 'test',
  name: 'Proving Ground',
  spawn: { position: [0, 0, 0], yaw: 0 },
  checkpoints: [
    { index: 0, position: [0, 0, 0], yaw: 0, size: GATE_SIZE },
    { index: 1, position: [0, 0, 600], yaw: 0, size: GATE_SIZE },
    { index: 2, position: [0, 0, 1200], yaw: 0, size: GATE_SIZE },
  ],
  finish: { position: [0, 0, 1800], yaw: 0, size: GATE_SIZE },
  killY: -25,
  bigJump: { lipPosition: RAMP.lip, yaw: 0, requiredKmh: BIG_JUMP_LIP_KMH, halfWidth: RAMP_WIDTH / 2 + 2 },
  lengthM: END_Z,
};

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
      m.makeScale(major ? WIDTH - 2 : 2.5, 1, major ? 0.3 : 0.35).setPosition(0, 0.012, z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 0.02, 1]} />
      <meshStandardMaterial color="#0a6d78" emissive="#00F0FF" emissiveIntensity={0.35} />
    </instancedMesh>
  );
}

export function TestTrack() {
  useRegisterTrackLayout(TEST_TRACK_LAYOUT);
  const grid = useMemo(() => {
    const texture = neonGridTexture({ cells: 4 }).clone();
    // One tile = 10 m (2.5 m cells).
    texture.repeat.set(WIDTH / 10, LENGTH / 10);
    return texture;
  }, []);
  useLayoutEffect(() => () => grid.dispose(), [grid]);

  return (
    <group name="test-track">
      <RigidBody type="fixed" colliders={false} name="test-floor">
        <CuboidCollider
          args={[WIDTH / 2, FLOOR_THICKNESS / 2, LENGTH / 2]}
          position={[0, -FLOOR_THICKNESS / 2, START_Z + LENGTH / 2]}
          friction={1}
        />
        <mesh position={[0, -FLOOR_THICKNESS / 2 - 0.01, START_Z + LENGTH / 2]}>
          <boxGeometry args={[WIDTH, FLOOR_THICKNESS, LENGTH]} />
          <meshStandardMaterial color="#090c16" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.001, START_Z + LENGTH / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[WIDTH, LENGTH]} />
          <meshStandardMaterial map={grid} emissiveMap={grid} emissive="#00F0FF" emissiveIntensity={0.22} roughness={0.8} metalness={0.15} />
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders={false} name="test-kicker">
        {RAMP.segments.map((seg, i) => (
          <group key={i} position={seg.center} rotation={[seg.rotationX, 0, 0]}>
            <CuboidCollider args={[RAMP_WIDTH / 2, RAMP_THICKNESS / 2, seg.length / 2]} friction={1} />
            <mesh castShadow receiveShadow>
              <boxGeometry args={[RAMP_WIDTH, RAMP_THICKNESS, seg.length]} />
              <meshStandardMaterial color="#1b1030" emissive="#FF2A6D" emissiveIntensity={0.18 + i * 0.06} />
            </mesh>
          </group>
        ))}
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
