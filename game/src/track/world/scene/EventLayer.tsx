/**
 * Event layer for the mounted entry (PLAN §4.7, §5.7), at most 3 draw calls:
 *   race: every gate's arch + chevron boards on bends under 120 m + the sign boards, one voxel
 *         mesh (shared voxel material); holo arrows at junction turn-offs + chevron glyphs + sign
 *         text, one glow mesh; the fog-free beacon on the next gate, one glow mesh moved per frame.
 *   roam: sign boards (voxel) + sign text, event-pad rings and fog-free pad beacons (glow).
 * Static geometry is built once per entry; per frame only the beacon moves and a time uniform
 * ticks. Sign texts follow this car's records (new best air / trap pass, car swap).
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Group, Mesh, Sphere, Vector3, type Material, type ShaderMaterial } from 'three';
import { resolveCarId } from '../../../car/catalog';
import { gameState } from '../../../state/store';
import { worldLive } from '../../../state/worldRuntime';
import { meshBoxes, type Box } from '../gen/boxMesher';
import { heightAt } from '../gen/heightAt';
import type { GateData, WorldData, WorldEvent } from '../gen/types';
import { worldEngine } from '../engine';
import { hit, nearestRoad, type RoadIndex } from '../physics/roadIndex';
import { toGeometry } from './Districts';
import type { EventAtlas } from './eventAtlas';
import { GlowBuilder, hexRgb } from './glowMaterial';
import { isRecordSign, recordRampId, signBoxes, signLines, signQuads } from './signs';

const ARCH_PILLAR = 0.8;
const CHEVRON_EVERY_M = 14;
const CHEVRON_MAX = 160;
const CHEVRON_FADE_M = 260;
const ARROW_FADE_M = 220;
const RING_FADE_M = 420;
/** Beacons are fog-free and fade in with distance: full from this far, gone when you stand on one. */
const BEACON_NEAR_M = -70;
/** Holo arrows: stations relative to the turn-off (m) and whether each shows the turn glyph. */
const ARROW_STATIONS: readonly [number, boolean][] = [
  [-62, true],
  [-38, true],
  [-14, true],
  [6, false],
  [16, false],
];

export interface EventLayerStats {
  arches: number;
  chevrons: number;
  arrows: number;
  pads: number;
  signs: number;
  voxelBoxes: number;
  glowQuads: number;
}

/** Cumulative plan distance along a route (x, y, z triples). */
function cumulative(route: Float32Array): Float32Array {
  const n = route.length / 3;
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) out[i] = out[i - 1]! + Math.hypot(route[i * 3]! - route[i * 3 - 3]!, route[i * 3 + 2]! - route[i * 3 - 1]!);
  return out;
}

function indexAt(cum: Float32Array, s: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  if (s <= 0) return 0;
  if (s >= cum[hi]!) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m]! < s) lo = m;
    else hi = m;
  }
  return hi;
}

/** Unit plan tangent at route index i (central difference over ±k samples). */
function tangentAt(route: Float32Array, i: number, k = 2): [number, number] {
  const n = route.length / 3;
  const a = Math.max(0, i - k);
  const b = Math.min(n - 1, i + k);
  const dx = route[b * 3]! - route[a * 3]!;
  const dz = route[b * 3 + 2]! - route[a * 3 + 2]!;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

function archBoxes(gate: GateData, accent: number, finish: boolean, heights: Float32Array, out: Box[]): void {
  const [x, y, z] = gate.position;
  const [W, H] = gate.size;
  const c = Math.cos(gate.yaw);
  const s = Math.sin(gate.yaw);
  const half = W / 2 + ARCH_PILLAR / 2;
  for (const side of [-1, 1]) {
    const px = x + c * side * half;
    const pz = z - s * side * half;
    const base = Math.min(y, heightAt(heights, px, pz)) - 1;
    const top = y + H;
    out.push({ x: px, y: (base + top) / 2, z: pz, sx: ARCH_PILLAR, sy: top - base, sz: ARCH_PILLAR, yaw: gate.yaw, color: 0x1b1e27, glow: 0, ground: true });
    // glowing strip on the inner face
    const ix = x + c * side * (half - ARCH_PILLAR / 2 - 0.06);
    const iz = z - s * side * (half - ARCH_PILLAR / 2 - 0.06);
    out.push({ x: ix, y: y + H / 2 + 0.5, z: iz, sx: 0.12, sy: H - 1, sz: 0.36, yaw: gate.yaw, color: accent, glow: 1.6, ground: false });
  }
  out.push({ x, y: y + H + 0.4, z, sx: W + ARCH_PILLAR * 2, sy: 0.8, sz: ARCH_PILLAR, yaw: gate.yaw, color: accent, glow: 1.5, ground: false });
  if (finish) {
    const n = 14;
    const span = W + ARCH_PILLAR * 2;
    for (let k = 0; k < n; k++) {
      const o = -span / 2 + (k + 0.5) * (span / n);
      for (let row = 0; row < 2; row++) {
        const white = (k + row) % 2 === 0;
        out.push({ x: x + c * o, y: y + H + 1.15 + row * 0.7, z: z - s * o, sx: span / n, sy: 0.7, sz: ARCH_PILLAR * 0.9, yaw: gate.yaw, color: white ? 0xf2f2f2 : 0x101114, glow: white ? 0.7 : 0, ground: false });
      }
    }
  }
}

interface Built {
  group: Group;
  geometries: BufferGeometry[];
  beacon: Mesh | null;
  stats: EventLayerStats;
}

function build(data: WorldData, event: WorldEvent | null, roads: RoadIndex, atlas: EventAtlas, voxel: Material, glowMat: ShaderMaterial): Built {
  const boxes: Box[] = signBoxes(data);
  const glow = new GlowBuilder();
  signQuads(data, atlas.signUv, glow);
  const stats: EventLayerStats = { arches: 0, chevrons: 0, arrows: 0, pads: 0, signs: data.signs.length, voxelBoxes: 0, glowQuads: 0 };
  const sp = atlas.sprite;
  let beaconGeo: BufferGeometry | null = null;

  if (event && event.mode === 'race') {
    const accentHex = parseInt(event.accent.replace('#', ''), 16);
    const accent = hexRgb(event.accent);
    // Arches.
    event.checkpoints.slice(1).forEach((g) => archBoxes(g, accentHex, false, data.heights, boxes));
    archBoxes(event.finish, accentHex, true, data.heights, boxes);
    stats.arches = event.checkpoints.length;
    const route = event.route;
    const cum = cumulative(route);
    const n = cum.length;
    // Chevron boards on the outside of bends tighter than 120 m, facing the approaching car.
    for (const [a, b] of event.tightBends) {
      const s0 = cum[Math.min(a, n - 1)]!;
      const s1 = cum[Math.min(b, n) - 1]!;
      if (s1 - s0 < 10) continue;
      for (let st = s0 + 4; st <= s1 && stats.chevrons < CHEVRON_MAX; st += CHEVRON_EVERY_M) {
        const i = indexAt(cum, st);
        const t1 = tangentAt(route, Math.max(0, i - 5));
        const t2 = tangentAt(route, Math.min(n - 1, i + 5));
        const t = tangentAt(route, i);
        // right of the heading t is (-tz, tx); a right turn rotates the tangent toward it
        const turn = (t2[0] - t1[0]) * -t1[1] + (t2[1] - t1[1]) * t1[0] > 0 ? 1 : -1;
        const px = route[i * 3]!;
        const pz = route[i * 3 + 2]!;
        const py = route[i * 3 + 1]!;
        nearestRoad(roads, px, pz, 20);
        const hw = hit.found ? hit.halfWidth : 6;
        const off = hw + 3.5;
        const bx = px - turn * -t[1] * off;
        const bz = pz - turn * t[0] * off;
        // never on another road
        if (nearestRoad(roads, bx, bz, 30) && hit.dist < hit.halfWidth + 1.5) continue;
        const g = heightAt(data.heights, bx, bz);
        const cy = Math.max(g, py) + 1.5;
        const yaw = Math.atan2(-t[0], -t[1]); // board faces the approaching car
        boxes.push({ x: bx, y: cy, z: bz, sx: 2.6, sy: 1.3, sz: 0.25, yaw, color: 0x15171d, glow: 0, ground: false });
        boxes.push({ x: bx, y: (g - 0.5 + cy) / 2, z: bz, sx: 0.22, sy: cy - g + 0.5, sz: 0.22, yaw, color: 0x2a2d36, glow: 0, ground: true });
        const fx = Math.sin(yaw) * 0.16;
        const fz = Math.cos(yaw) * 0.16;
        glow.upright([bx + fx, cy, bz + fz], yaw, 2.4, 1.15, sp.chevron, accent, CHEVRON_FADE_M, turn < 0);
        stats.chevrons++;
      }
    }
    // Holo arrows at junction turn-offs (floating 0.25 m above the road).
    for (const ti of event.turnOffs) {
      if (ti <= 0 || ti >= n - 1) continue;
      const sT = cum[ti]!;
      const tb = tangentAt(route, indexAt(cum, sT - 12), 3);
      const ta = tangentAt(route, indexAt(cum, sT + 36), 3);
      const turn = (ta[0] - tb[0]) * -tb[1] + (ta[1] - tb[1]) * tb[0] > 0 ? 1 : -1;
      for (const [d, glyph] of ARROW_STATIONS) {
        const st = sT + d;
        if (st < 8 || st > cum[n - 1]! - 4) continue;
        const i = indexAt(cum, st);
        const ib = indexAt(cum, st - 2.4);
        const iF = indexAt(cum, st + 2.4);
        const t = tangentAt(route, i, 2);
        const rx = -t[1] * 2;
        const rz = t[0] * 2;
        const back = [route[ib * 3]!, route[ib * 3 + 1]! + 0.25, route[ib * 3 + 2]!] as const;
        const front = [route[iF * 3]!, route[iF * 3 + 1]! + 0.25, route[iF * 3 + 2]!] as const;
        glow.quad(
          [back[0] - rx, back[1], back[2] - rz],
          [back[0] + rx, back[1], back[2] + rz],
          [front[0] + rx, front[1], front[2] + rz],
          [front[0] - rx, front[1], front[2] - rz],
          glyph ? sp.turn : sp.arrow,
          hexRgb(event.accent, 0.9),
          ARROW_FADE_M,
          -st * 0.12,
          glyph && turn < 0,
        );
        stats.arrows++;
      }
    }
    // Beacon (crossed quads at the origin, moved onto the next gate every frame).
    const bg = new GlowBuilder();
    const bc = hexRgb(event.accent, 1.15);
    bg.upright([0, 80, 0], 0, 5, 160, sp.beam, bc, BEACON_NEAR_M);
    bg.upright([0, 80, 0], Math.PI / 2, 5, 160, sp.beam, bc, BEACON_NEAR_M);
    beaconGeo = bg.build();
  } else {
    // Event pads: a ring on the ground + a fog-free beam, in each event's accent.
    for (const p of data.pads) {
      const c = hexRgb(p.accent);
      const [x, , z] = p.position;
      const r = p.radius;
      const N = 6;
      const [u0, v0, u1, v1] = sp.ring;
      for (let a = 0; a < N; a++)
        for (let b = 0; b < N; b++) {
          const xa = x - r + (2 * r * a) / N;
          const xb = x - r + (2 * r * (a + 1)) / N;
          const za = z - r + (2 * r * b) / N;
          const zb = z - r + (2 * r * (b + 1)) / N;
          const y = (px: number, pz: number) => heightAt(data.heights, px, pz) + 0.15;
          const U = (k: number) => u0 + ((u1 - u0) * k) / N;
          const V = (k: number) => v1 - ((v1 - v0) * k) / N;
          glow.quad([xa, y(xa, zb), zb], [xb, y(xb, zb), zb], [xb, y(xb, za), za], [xa, y(xa, za), za], [U(a), V(b + 1), U(a + 1), V(b)], c, RING_FADE_M);
        }
      const g = heightAt(data.heights, x, z);
      glow.upright([x, g + 45, z], 0, 3.2, 90, sp.beam, c, BEACON_NEAR_M);
      glow.upright([x, g + 45, z], Math.PI / 2, 3.2, 90, sp.beam, c, BEACON_NEAR_M);
      stats.pads++;
    }
  }

  const group = new Group();
  group.name = 'tessera-events';
  const geometries: BufferGeometry[] = [];
  const vox = meshBoxes(boxes);
  if (vox) {
    const g = toGeometry(vox);
    geometries.push(g);
    const m = new Mesh(g, voxel);
    m.name = 'tessera-events-voxel';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  stats.voxelBoxes = boxes.length;
  stats.glowQuads = glow.quads;
  const gg = glow.build();
  if (gg) {
    geometries.push(gg);
    const m = new Mesh(gg, glowMat);
    m.name = 'tessera-events-glow';
    m.matrixAutoUpdate = false;
    m.renderOrder = 2;
    group.add(m);
  }
  let beacon: Mesh | null = null;
  if (beaconGeo) {
    geometries.push(beaconGeo);
    // the beacon moves: give it a bounding sphere that covers its whole height
    beaconGeo.boundingSphere = new Sphere(new Vector3(0, 80, 0), 82);
    beacon = new Mesh(beaconGeo, glowMat);
    beacon.name = 'tessera-events-beacon';
    beacon.renderOrder = 3;
    beacon.visible = false;
    group.add(beacon);
  }
  return { group, geometries, beacon, stats };
}

/** Last built layer's counts (for __WORLD__ / tests). */
export const eventLayerStats: { current: EventLayerStats | null } = { current: null };

export function EventLayer({ data, entryId, roads, atlas, voxel, glow }: { data: WorldData; entryId: string; roads: RoadIndex; atlas: EventAtlas; voxel: Material; glow: ShaderMaterial }) {
  const event = useMemo(() => data.events.find((e) => e.id === entryId) ?? null, [data, entryId]);
  const built = useMemo(() => build(data, event, roads, atlas, voxel, glow), [data, event, roads, atlas, voxel, glow]);
  useEffect(() => {
    eventLayerStats.current = built.stats;
    return () => {
      built.geometries.forEach((g) => g.dispose());
      if (eventLayerStats.current === built.stats) eventLayerStats.current = null;
    };
  }, [built]);

  // Sign texts that follow this car's records.
  const watch = useMemo(() => ({ raw: '', car: atlas.meta.carId, air: worldLive.air.serial, trap: worldLive.trap.serial }), [atlas]);
  const recordSigns = useMemo(() => data.signs.map((s, i) => ({ s, i })).filter(({ s }) => isRecordSign(s)), [data]);

  useFrame((state) => {
    built.group.visible = worldEngine.reveal.districts;
    glow.uniforms.uTime!.value = state.clock.elapsedTime;
    // beacon on the next gate
    const b = built.beacon;
    if (b && event) {
      const k = worldLive.nextGate;
      const gate = k >= 1 ? (k < event.checkpoints.length ? event.checkpoints[k] : event.finish) : undefined;
      b.visible = gate !== undefined;
      if (gate && (b.position.x !== gate.position[0] || b.position.z !== gate.position[2])) {
        b.position.set(gate.position[0], gate.position[1], gate.position[2]);
        b.updateMatrix();
      }
    }
    // records → sign texts (rare: a new best, or another car)
    const raw = gameState().carId;
    if (raw !== watch.raw) {
      watch.raw = raw;
      atlas.meta.carId = resolveCarId(raw);
    }
    const car = atlas.meta.carId;
    const air = worldLive.air;
    const trap = worldLive.trap;
    if (car !== watch.car || air.serial !== watch.air || trap.serial !== watch.trap) {
      const all = car !== watch.car;
      const airRamp = air.serial !== watch.air && air.best ? recordRampId(air.rampId) : '';
      const trapBest = trap.serial !== watch.trap && trap.best;
      watch.car = car;
      watch.air = air.serial;
      watch.trap = trap.serial;
      for (const { s, i } of recordSigns) {
        const hitRamp = s.rampId !== null && airRamp !== '' && recordRampId(s.rampId) === airRamp;
        const hitTrap = trapBest && s.id === 'sign-saltglass';
        if (all || hitRamp || hitTrap) atlas.redraw(i, signLines(s, car));
      }
    }
  });

  return <primitive object={built.group} />;
}
