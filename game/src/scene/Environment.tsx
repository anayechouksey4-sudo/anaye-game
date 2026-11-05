/**
 * Sky, fog, lights and the "bottomless void" backdrop. The sun's shadow frustum follows the
 * car so shadows stay crisp on a kilometres-long track without a giant shadow map.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Object3D, type DirectionalLight, type GridHelper, type Group } from 'three';
import { carRuntime } from '../car/runtime';

export const PALETTE = {
  bg: '#05060A',
  cyan: '#00F0FF',
  magenta: '#FF2A6D',
  yellow: '#F5E663',
  green: '#39FF14',
} as const;

const SUN_OFFSET = [-40, 70, -25] as const;
const VOID_GRID_SPACING = 40;

function FollowSun() {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  useEffect(() => {
    if (light.current) light.current.target = target;
  }, [target]);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const p = carRuntime.position;
    target.position.set(p.x, p.y, p.z + 10);
    target.updateMatrixWorld();
    l.position.set(p.x + SUN_OFFSET[0], p.y + SUN_OFFSET[1], p.z + SUN_OFFSET[2]);
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        intensity={1.6}
        color="#dff6ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0005}
      />
    </>
  );
}

/** A faint grid far below the track, snapped under the car so the void reads as endless depth. */
function VoidGrid() {
  const grid = useRef<GridHelper>(null);
  useFrame(() => {
    const g = grid.current;
    if (!g) return;
    const p = carRuntime.position;
    g.position.set(Math.round(p.x / VOID_GRID_SPACING) * VOID_GRID_SPACING, -140, Math.round(p.z / VOID_GRID_SPACING) * VOID_GRID_SPACING);
  });
  return <gridHelper ref={grid} args={[2400, 2400 / VOID_GRID_SPACING, PALETTE.magenta, '#2a0c3a']} />;
}

/** Stars centred on the camera so the sky never runs out along a long track. */
function StarField() {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position);
  });
  return (
    <group ref={group}>
      <Stars radius={500} depth={80} count={2500} factor={5} saturation={0.6} fade speed={0.4} />
    </group>
  );
}

export function Environment() {
  return (
    <>
      <color attach="background" args={[PALETTE.bg]} />
      <fog attach="fog" args={[PALETTE.bg, 90, 720]} />
      <hemisphereLight args={['#7fe6ff', '#24081f', 0.7]} />
      <ambientLight intensity={0.18} />
      <FollowSun />
      <StarField />
      <VoidGrid />
    </>
  );
}
