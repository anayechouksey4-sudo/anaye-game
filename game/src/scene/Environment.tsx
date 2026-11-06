/**
 * Sky, fog, lights and the "bottomless void" backdrop. The sun's shadow frustum follows the
 * car so shadows stay crisp on a kilometres-long track without a giant shadow map.
 *
 * Colours come from the registered track layout's `atmosphere` (track/types.ts), so they switch
 * together with the map; a layout without one gets the default neon night (`DEFAULT_ATMOSPHERE`).
 * The light objects stay mounted across map switches (only their colours/intensities change), so
 * App's touch shadow budget, applied once at mount, keeps holding.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Color, Object3D, type DirectionalLight, type GridHelper, type Group } from 'three';
import { carRuntime } from '../car/runtime';
import { useGameStore } from '../state/store';
import type { TrackAtmosphere } from '../track/types';

export const PALETTE = {
  bg: '#05060A',
  cyan: '#00F0FF',
  magenta: '#FF2A6D',
  yellow: '#F5E663',
  green: '#39FF14',
} as const;

/** The original neon night (GamerFleet Chaos Track, Proving Ground). */
export const DEFAULT_ATMOSPHERE: TrackAtmosphere = {
  background: PALETTE.bg,
  fog: [PALETTE.bg, 90, 720],
  hemisphere: ['#7fe6ff', '#24081f', 0.7],
  ambient: 0.18,
  sun: { color: '#dff6ff', intensity: 1.6 },
  stars: 1,
  voidGrid: [PALETTE.magenta, '#2a0c3a'],
};

const SUN_OFFSET = [-40, 70, -25] as const;
const VOID_GRID_SPACING = 40;

function FollowSun({ color, intensity }: { color: string; intensity: number }) {
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
        intensity={intensity}
        color={color}
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

/**
 * A faint grid far below the track, snapped under the car so the void reads as endless depth.
 * One GridHelper for the page; a map change recolours its vertex colours in place.
 */
function VoidGrid({ colors }: { colors: [string, string] | null }) {
  const grid = useRef<GridHelper>(null);
  useEffect(() => {
    const g = grid.current;
    if (!g || !colors) return;
    // GridHelper bakes colours into a vertex attribute: centre lines use colour 1, the rest colour 2.
    const attr = g.geometry.getAttribute('color');
    const divisions = 2400 / VOID_GRID_SPACING;
    const center = divisions / 2;
    const c1 = new Color(colors[0]);
    const c2 = new Color(colors[1]);
    for (let i = 0, j = 0; i <= divisions; i++) {
      const c = i === center ? c1 : c2;
      for (let k = 0; k < 4; k++, j++) attr.setXYZ(j, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }, [colors]);
  useFrame(() => {
    const g = grid.current;
    if (!g) return;
    const p = carRuntime.position;
    g.position.set(Math.round(p.x / VOID_GRID_SPACING) * VOID_GRID_SPACING, -140, Math.round(p.z / VOID_GRID_SPACING) * VOID_GRID_SPACING);
  });
  return (
    <gridHelper
      ref={grid}
      args={[2400, 2400 / VOID_GRID_SPACING, DEFAULT_ATMOSPHERE.voidGrid?.[0], DEFAULT_ATMOSPHERE.voidGrid?.[1]]}
      visible={colors !== null}
    />
  );
}

/**
 * Stars centred on the camera so the sky never runs out along a long track. Built once; a map
 * without stars just hides them (rebuilding drei's star buffers would leak GPU buffers).
 */
function StarField({ visible }: { visible: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position);
  });
  return (
    <group ref={group} visible={visible}>
      <Stars radius={500} depth={80} count={2500} factor={5} saturation={0.6} fade speed={0.4} />
    </group>
  );
}

export function Environment() {
  const atmosphere = useGameStore((s) => s.trackLayout?.atmosphere) ?? DEFAULT_ATMOSPHERE;
  const { background, fog, hemisphere, ambient, sun, stars, voidGrid } = atmosphere;
  return (
    <>
      <color attach="background" args={[background]} />
      <fog attach="fog" args={DEFAULT_ATMOSPHERE.fog} color={fog[0]} near={fog[1]} far={fog[2]} />
      <hemisphereLight args={DEFAULT_ATMOSPHERE.hemisphere} color={hemisphere[0]} groundColor={hemisphere[1]} intensity={hemisphere[2]} />
      <ambientLight intensity={ambient} />
      <FollowSun color={sun.color} intensity={sun.intensity} />
      <StarField visible={stars > 0} />
      <VoidGrid colors={voidGrid} />
    </>
  );
}
