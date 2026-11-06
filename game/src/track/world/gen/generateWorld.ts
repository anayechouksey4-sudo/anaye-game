/**
 * generateWorld(seed = 7177): the whole island as transferable data (PLAN §4.2). PURE — runs in a
 * Worker or on the main thread; no three / react / rapier / DOM / Math.random / Date.
 *
 *   1 base heights (coast, regions, The Crown, landforms)
 *   2 roads: splines → vertical profiles (priority order, pinned junctions, pads) → stamp corridors
 *   3 terrain passes (smoothing that never touches corridors) + cut/fill envelopes
 *   4 textures: tileTex, fieldTex, surface map, region map, minimap
 *   5 props → solid/ghost box lists per district → near/far meshes + trimesh arrays; ramp cuboids
 *   6 events: race layouts, routes, speed plans; travel spots; pads; signs
 *   7 validate() (throws on a breach); heights already rounded to 1/256 m; FNV-1a hash
 */
import { colliderBoxes, meshBoxes, type Box } from './boxMesher';
import { buildEvents, buildRamps } from './events';
import { SegmentIndex } from './geom';
import { Fnv, stableJson } from './hash';
import { Island } from './island';
import { buildProps, type PropSet } from './props';
import { findJunctions, projectOnRoad, sampleRoads, solveRoadProfiles, type Junction, type RoadBuild } from './roads';
import { LOOP_GULCH, ROAD_DEFS, SEED } from './tessera';
import { buildTerrain, type TerrainBuild } from './terrain';
import { buildTextures } from './textures';
import { DISTRICTS, DISTRICT_SIZE, ROAD_PAD, ROAD_SAFE, rampDistance, WORLD_HALF, WORLD_N, type DistrictData, type RampInfo, type RoadData, type WorldData } from './types';
import { validateWorld, type ValidationReport } from './validate';

/** Everything the generator knows that is not shipped in WorldData (validation, debugging). */
export interface WorldInternals {
  roads: RoadBuild[];
  junctions: Junction[];
  island: Island;
  terrain: TerrainBuild;
  props: PropSet;
  index: SegmentIndex;
  warnings: string[];
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

export function buildWorld(seed: number = SEED): { world: WorldData; internals: WorldInternals } {
  const t0 = now();
  const timings: Record<string, number> = {};
  let tLap = t0;
  const lap = (name: string) => {
    const t = now();
    timings[name] = Math.round((t - tLap) * 10) / 10;
    tLap = t;
  };
  // 2a. Roads: centrelines, junctions, the Rimway profile (it shapes the coast and regions).
  const roads = sampleRoads(ROAD_DEFS);
  const junctions = findJunctions(roads);
  const rim = roads.find((r) => r.def.id === 'rimway')!;
  solveRoadProfiles(roads, () => 0, (r) => r === rim);
  lap('roads');
  // 1. Natural terrain.
  const island = new Island(seed, rim);
  // 2b. Every other profile in priority order.
  solveRoadProfiles(roads, (x, z) => island.baseAt(x, z));
  for (const r of roads) for (let i = 0; i < r.n; i++) r.base[i] = island.baseAt(r.xs[i]!, r.zs[i]!);
  lap('profiles');
  // 3. Terrain (corridors, envelopes, smoothing, cliff masks).
  const loop = roads.find((r) => r.def.id === 'cinnabar-loop');
  const gulch = loop ? { road: loop, s0: projectOnRoad(loop, ...LOOP_GULCH[0]).s, s1: projectOnRoad(loop, ...LOOP_GULCH[1]).s } : null;
  const terrain = buildTerrain(island, roads, gulch, timings);
  const heights = terrain.heights;
  const hf = new Float32Array(WORLD_N * WORLD_N);
  for (let iz = 0; iz < WORLD_N; iz++) for (let ix = 0; ix < WORLD_N; ix++) hf[ix * WORLD_N + iz] = heights[iz * WORLD_N + ix]!;
  lap('terrain');
  // 5. Props and ramps → district meshes and colliders.
  const index = new SegmentIndex(roads.map((r) => ({ xs: r.xs, zs: r.zs, closed: r.closed })));
  const ramps = buildRamps(heights);
  markSafePoses(roads, ramps.info);
  const props = buildProps(heights, terrain.cliff, roads, index, island);
  lap('props');
  const districts = buildDistricts([...props.near, ...ramps.boxes], [...props.far, ...ramps.boxes], props.solid);
  lap('meshes');
  // 4. Textures.
  const tex = buildTextures(terrain, island, roads, props.footprints);
  lap('textures');
  // 6. Events.
  const ev = buildEvents(roads, heights, ramps.info);
  lap('events');
  const roadData: RoadData[] = roads.map((r) => {
    const points = new Float32Array(r.n * 3);
    const tangents = new Float32Array(r.n * 2);
    for (let i = 0; i < r.n; i++) {
      points[i * 3] = r.xs[i]!;
      points[i * 3 + 1] = r.h[i]!;
      points[i * 3 + 2] = r.zs[i]!;
      tangents[i * 2] = r.tx[i]!;
      tangents[i * 2 + 1] = r.tz[i]!;
    }
    return {
      id: r.def.id,
      name: r.def.name,
      kind: r.def.kind,
      surface: r.def.surface,
      width: r.def.width,
      closed: r.closed,
      ds: r.ds,
      length: Math.round(r.length * 100) / 100,
      points,
      base: Float32Array.from(r.base),
      tangents,
      flags: r.flags,
    };
  });
  let solidBoxes = 0;
  let colliderTriangles = 0;
  let nearVertices = 0;
  let farVertices = 0;
  let colliders = 1 + ramps.cuboids.length;
  for (const d of districts) {
    if (d.collider) {
      colliders++;
      colliderTriangles += d.collider.triangles;
    }
    nearVertices += d.near ? d.near.position.length / 3 : 0;
    farVertices += d.far ? d.far.position.length / 3 : 0;
  }
  solidBoxes = props.solid.length;
  const world: WorldData = {
    seed,
    hash: '',
    genMs: 0,
    heights,
    hf,
    tileTex: tex.tileTex,
    fieldTex: tex.fieldTex,
    surface: tex.surface,
    region: tex.region,
    cliff: terrain.cliff,
    minimap: tex.minimap,
    districts,
    ramps: ramps.cuboids,
    rampInfo: ramps.info,
    roads: roadData,
    events: ev.events,
    spots: ev.spots,
    pads: ev.pads,
    signs: ev.signs,
    landmarks: ev.landmarks,
    probes: ev.probes,
    stats: {
      boxes: props.near.length - treeBoxes(props),
      trees: props.trees,
      solidBoxes,
      ghostBoxes: props.ghostBoxes,
      colliderTriangles,
      colliders,
      nearVertices,
      farVertices,
      bytes: 0,
      rampCuboids: ramps.cuboids.length,
      timings,
    },
  };
  world.stats.bytes = worldBytes(world);
  world.hash = hashWorld(world);
  lap('hash');
  world.genMs = Math.round((now() - t0) * 10) / 10;
  const warnings = [...ev.warnings];
  for (const r of roads) for (const w of r.warnings) warnings.push(`${r.def.id}: ${w}`);
  if (terrain.conflicts > 0) warnings.push(`terrain: ${terrain.conflicts} envelope conflicts`);
  return { world, internals: { roads, junctions, island, terrain, props, index, warnings } };
}

/** Generate, validate (throws on any breach unless `validate: false`), return the data. */
export function generateWorld(seed: number = SEED, opts: { validate?: boolean } = {}): WorldData {
  const t0 = now();
  const { world, internals } = buildWorld(seed);
  if (opts.validate !== false) {
    const report = validateWorld(world, internals);
    world.stats.timings.validate = report.ms;
    if (report.errors.length > 0) {
      const head = report.errors.slice(0, 12).map((e) => `${e.rule} ${e.where}: ${e.detail}`);
      throw new Error(`Tessera Isle failed validation (${report.errors.length}):\n${head.join('\n')}`);
    }
  }
  world.genMs = Math.round((now() - t0) * 10) / 10;
  return world;
}

export type { ValidationReport };

/** Safe-pose candidates: road samples that meet the checkpoint rules (grade ≤ 4 %, R ≥ 60 m or a pad, ≥ 15 m from ramps). */
function markSafePoses(roads: RoadBuild[], ramps: readonly RampInfo[]): void {
  for (const r of roads) {
    if (r.def.kind === 'rail') continue;
    const n = r.n;
    for (let i = 0; i < n; i++) {
      if (!r.closed && (i < 3 || i > n - 4)) continue;
      const a = r.closed ? (i - 1 + n) % n : i - 1;
      const b = r.closed ? (i + 1) % n : i + 1;
      const g = Math.abs(r.h[b]! - r.h[a]!) / (2 * r.ds);
      if (g > 0.04) continue;
      if (!(r.flags[i]! & ROAD_PAD) && r.radius[i]! < 60) continue;
      if (r.h[i]! < 3) continue;
      let nearRamp = false;
      for (const ramp of ramps) if (rampDistance(ramp, r.xs[i]!, r.zs[i]!) < 15) nearRamp = true;
      if (nearRamp) continue;
      r.flags[i]! |= ROAD_SAFE;
    }
  }
}

function treeBoxes(p: PropSet): number {
  // trees are pines/oaks (3 near boxes) and cacti (3 near boxes)
  return p.trees * 3;
}

function buildDistricts(near: Box[], far: Box[], solid: Box[]): DistrictData[] {
  const bins = (list: Box[]) => {
    const out: Box[][] = Array.from({ length: DISTRICTS * DISTRICTS }, () => []);
    for (const b of list) {
      const ix = Math.max(0, Math.min(DISTRICTS - 1, Math.floor((b.x + WORLD_HALF) / DISTRICT_SIZE)));
      const iz = Math.max(0, Math.min(DISTRICTS - 1, Math.floor((b.z + WORLD_HALF) / DISTRICT_SIZE)));
      out[iz * DISTRICTS + ix]!.push(b);
    }
    return out;
  };
  const nb = bins(near);
  const fb = bins(far);
  const sb = bins(solid);
  const out: DistrictData[] = [];
  for (let iz = 0; iz < DISTRICTS; iz++)
    for (let ix = 0; ix < DISTRICTS; ix++) {
      const k = iz * DISTRICTS + ix;
      const nearM = meshBoxes(nb[k]!);
      const farM = meshBoxes(fb[k]!);
      const col = colliderBoxes(sb[k]!);
      if (!nearM && !farM && !col) continue;
      const x0 = -WORLD_HALF + ix * DISTRICT_SIZE;
      const z0 = -WORLD_HALF + iz * DISTRICT_SIZE;
      const b = nearM?.bounds ?? farM?.bounds ?? [x0, 0, z0, x0 + DISTRICT_SIZE, 0, z0 + DISTRICT_SIZE];
      out.push({ ix, iz, near: nearM, far: farM, collider: col, bounds: [b[0], b[1], b[2], b[3], b[4], b[5]] });
    }
  return out;
}

function arrays(world: WorldData): ArrayBufferView[] {
  const out: ArrayBufferView[] = [world.heights, world.hf, world.tileTex, world.fieldTex, world.surface, world.region, world.cliff, world.minimap];
  for (const d of world.districts) {
    for (const m of [d.near, d.far]) if (m) out.push(m.position, m.normal, m.color, m.glow, m.index);
    if (d.collider) out.push(d.collider.vertices, d.collider.indices);
  }
  for (const r of world.roads) out.push(r.points, r.base, r.tangents, r.flags);
  for (const e of world.events) out.push(e.route, e.speeds);
  return out;
}

export function worldBytes(world: WorldData): number {
  let n = 0;
  for (const a of arrays(world)) n += a.byteLength;
  return n;
}

/** FNV-1a over every array (fixed order) and the JSON of the rest. */
export function hashWorld(world: WorldData): string {
  const h = new Fnv();
  for (const a of arrays(world)) h.bytes(a);
  h.text(
    stableJson({
      seed: world.seed,
      ramps: world.ramps,
      rampInfo: world.rampInfo,
      events: world.events.map((e) => ({ ...e, route: e.route.length, speeds: e.speeds.length })),
      spots: world.spots,
      pads: world.pads,
      signs: world.signs,
      landmarks: world.landmarks,
      probes: world.probes,
      districts: world.districts.map((d) => [d.ix, d.iz, d.bounds]),
      roads: world.roads.map((r) => [r.id, r.kind, r.surface, r.width, r.closed, r.length]),
    }),
  );
  return h.hex();
}
