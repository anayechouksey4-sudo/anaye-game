/**
 * What the HUD reads from the world (state/worldRuntime.ts contract): the minimap image, map
 * markers, the race route polyline and the travel spots. Memoised per WorldData / event so the
 * minimap paints once and re-entering the island hands it the same objects.
 */
import type { MapMarker, MinimapImage, TravelSpot } from '../../state/worldRuntime';
import { WORLD_CELLS, WORLD_HALF, type WorldData, type WorldEvent } from './gen/types';

const minimaps = new WeakMap<WorldData, MinimapImage>();
const markerCache = new WeakMap<WorldData, Map<string, readonly MapMarker[]>>();
const routes = new WeakMap<WorldEvent, Float32Array>();
const spotCache = new WeakMap<WorldData, readonly TravelSpot[]>();

export function minimapOf(world: WorldData): MinimapImage {
  let m = minimaps.get(world);
  if (!m) {
    const src = world.minimap;
    m = {
      width: WORLD_CELLS,
      height: WORLD_CELLS,
      data: new Uint8ClampedArray(src.buffer, src.byteOffset, src.byteLength),
      originX: -WORLD_HALF,
      originZ: -WORLD_HALF,
      metresPerPixel: (2 * WORLD_HALF) / WORLD_CELLS,
    };
    minimaps.set(world, m);
  }
  return m;
}

/** Roam: an event flag per race pad + landmark glyphs. Race: checkpoints 1…n−1 in order, then the finish. */
export function markersOf(world: WorldData, entryId: string): readonly MapMarker[] {
  let byId = markerCache.get(world);
  if (!byId) {
    byId = new Map();
    markerCache.set(world, byId);
  }
  const hit = byId.get(entryId);
  if (hit) return hit;
  const ev = world.events.find((e) => e.id === entryId);
  let out: MapMarker[] = [];
  if (!ev || ev.mode === 'roam') {
    for (const p of world.pads) {
      const e = world.events.find((x) => x.id === p.eventId);
      out.push({ id: `pad-${p.eventId}`, kind: 'event', x: p.position[0], z: p.position[2], label: e?.name ?? p.eventId, accent: p.accent, trackId: p.eventId });
    }
    for (const l of world.landmarks) out.push({ id: `lm-${l.id}`, kind: 'landmark', x: l.x, z: l.z, label: l.name });
  } else {
    out = ev.checkpoints.slice(1).map((c) => ({ id: `${ev.id}-cp${c.index}`, kind: 'checkpoint' as const, x: c.position[0], z: c.position[2], label: `CP ${c.index}`, accent: ev.accent }));
    out.push({ id: `${ev.id}-finish`, kind: 'finish', x: ev.finish.position[0], z: ev.finish.position[2], label: 'FINISH', accent: ev.accent });
  }
  byId.set(entryId, out);
  return out;
}

/** Race route as [x0, z0, x1, z1, …] every ~4 m; null for free roam. */
export function routeOf(world: WorldData, entryId: string): Float32Array | null {
  const ev = world.events.find((e) => e.id === entryId);
  if (!ev || ev.mode !== 'race') return null;
  let r = routes.get(ev);
  if (!r) {
    const n = ev.route.length / 3;
    const keep = Math.ceil(n / 2) + (n % 2 === 0 ? 1 : 0);
    r = new Float32Array(keep * 2);
    let k = 0;
    for (let i = 0; i < n; i += 2) {
      r[k++] = ev.route[i * 3]!;
      r[k++] = ev.route[i * 3 + 2]!;
    }
    if ((n - 1) % 2 !== 0) {
      r[k++] = ev.route[(n - 1) * 3]!;
      r[k++] = ev.route[(n - 1) * 3 + 2]!;
    }
    r = r.slice(0, k);
    routes.set(ev, r);
  }
  return r;
}

export function travelSpotsOf(world: WorldData): readonly TravelSpot[] {
  let s = spotCache.get(world);
  if (!s) {
    s = world.spots.map((sp) => ({ id: sp.id, label: sp.label }));
    spotCache.set(world, s);
  }
  return s;
}
