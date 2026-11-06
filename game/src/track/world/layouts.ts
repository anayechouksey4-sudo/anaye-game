/**
 * One stable TrackLayout per island entry (memoised per WorldData), built from WorldData.events.
 * The roam entry is free drive (no gates are ever tested); races are strict-order courses.
 */
import { getTrackEntry } from '../catalog';
import type { TrackAtmosphere, TrackLayout } from '../types';
import type { WorldData, WorldEvent } from './gen/types';

/** Amber dusk on every island entry (PLAN §3.11). */
export const ISLAND_ATMOSPHERE: TrackAtmosphere = {
  background: '#f6b489',
  fog: ['#f2b48f', 140, 520],
  hemisphere: ['#ffe2c4', '#3a4a5a', 0.9],
  ambient: 0.32,
  sun: { color: '#ffd29a', intensity: 2.0 },
  stars: 0,
  voidGrid: null,
};

export const ISLAND_KILL_Y = -40;

const cache = new WeakMap<WorldData, Map<string, TrackLayout>>();

function build(e: WorldEvent): TrackLayout {
  const entry = getTrackEntry(e.id);
  const name = entry.id === e.id ? entry.name : e.name;
  const spawn = { position: [...e.spawn.position] as [number, number, number], yaw: e.spawn.yaw };
  if (e.mode === 'roam') {
    return {
      id: e.id,
      name,
      spawn,
      checkpoints: [{ index: 0, position: spawn.position, yaw: spawn.yaw, size: [1, 1, 1] }],
      finish: { position: [spawn.position[0], -10000, spawn.position[2]], yaw: 0, size: [0, 0, 0] },
      killY: ISLAND_KILL_Y,
      atmosphere: ISLAND_ATMOSPHERE,
      mode: 'roam',
    };
  }
  return {
    id: e.id,
    name,
    spawn,
    checkpoints: e.checkpoints.map((c) => ({ index: c.index, position: [...c.position] as [number, number, number], yaw: c.yaw, size: [...c.size] as [number, number, number] })),
    finish: { position: [...e.finish.position] as [number, number, number], yaw: e.finish.yaw, size: [...e.finish.size] as [number, number, number] },
    killY: ISLAND_KILL_Y,
    lengthM: Math.round(e.lengthM),
    atmosphere: ISLAND_ATMOSPHERE,
    mode: 'race',
    strictOrder: true,
  };
}

/** The layout for an island entry id, or null when the world has no such event. Same object on every call. */
export function islandLayout(world: WorldData, id: string): TrackLayout | null {
  let byId = cache.get(world);
  if (!byId) {
    byId = new Map();
    cache.set(world, byId);
  }
  const hit = byId.get(id);
  if (hit) return hit;
  const e = world.events.find((ev) => ev.id === id);
  if (!e) return null;
  const layout = build(e);
  byId.set(id, layout);
  return layout;
}

/** Every layout object this world has handed out (WorldRoot's unmount check). */
export function isIslandLayout(world: WorldData | null, layout: TrackLayout | null): boolean {
  if (!world || !layout) return false;
  return cache.get(world)?.get(layout.id) === layout;
}

export function eventOf(world: WorldData, id: string): WorldEvent | null {
  return world.events.find((e) => e.id === id) ?? null;
}
