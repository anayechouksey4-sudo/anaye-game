/**
 * Events: the four core races (route polylines every ≈ 2 m, checkpoints snapped to the route and
 * moved ≤ 40 m to the nearest spot meeting the checkpoint rules, speed plans), the free-roam
 * entry, travel spots, event pads, signs, landmarks, probe poses and the stunt-ramp cuboids. Pure.
 */
import { buildRamp, type RampSegmentSpec } from '../../common/ramp';
import type { Box } from './boxMesher';
import { heightAt } from './heightAt';
import { projectOnRoad, ROAD_DS, type RoadBuild } from './roads';
import { SURFACE_TABLE } from './surfaces';
import {
  DEG,
  LANDMARK_DEFS,
  PLAZA,
  RACE_DEFS,
  RAMP_DEFS,
  ROAM_ACCENT,
  ROAM_ID,
  ROAM_NAME,
  RUNWAY,
  SADDLE,
  SPAWN,
  rimAt,
  runwayPoint,
  type RaceDef,
} from './tessera';
import { ROAD_PAD, rampDistance, type EventPad, type GateData, type Landmark, type ProbePose, type RampCuboid, type RampInfo, type SignData, type TravelSpot, type Vec3, type WorldEvent } from './types';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const v3 = (x: number, y: number, z: number): Vec3 => [r3(x), r3(y), r3(z)];
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

/** A route under construction: points with their road and station. */
interface RoutePt {
  x: number;
  y: number;
  z: number;
  road: number;
  s: number;
  pad: boolean;
}

function roadPoint(r: RoadBuild, s: number): RoutePt {
  const n = r.n;
  const L = r.closed ? n * r.ds : (n - 1) * r.ds;
  let ss = s;
  if (r.closed) ss = ((s % L) + L) % L;
  else ss = Math.max(0, Math.min(L, s));
  const f = ss / r.ds;
  const i = Math.floor(f);
  const t = f - i;
  const j = r.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
  const ii = Math.min(i, n - 1);
  return {
    x: r.xs[ii]! + (r.xs[j]! - r.xs[ii]!) * t,
    y: r.h[ii]! + (r.h[j]! - r.h[ii]!) * t,
    z: r.zs[ii]! + (r.zs[j]! - r.zs[ii]!) * t,
    road: r.index,
    s: ss,
    pad: ((r.flags[ii]! | r.flags[j]!) & ROAD_PAD) !== 0,
  };
}

function legPoints(r: RoadBuild, from: [number, number], to: [number, number], dir: 1 | -1 | undefined, lap: boolean | undefined): RoutePt[] {
  const L = r.closed ? r.n * r.ds : (r.n - 1) * r.ds;
  const s0 = projectOnRoad(r, from[0], from[1]).s;
  const s1 = projectOnRoad(r, to[0], to[1]).s;
  let d: 1 | -1 = dir ?? (s1 >= s0 ? 1 : -1);
  let span: number;
  if (lap) span = L;
  else if (r.closed) {
    span = d > 0 ? (s1 - s0 + L) % L : (s0 - s1 + L) % L;
  } else {
    span = Math.abs(s1 - s0);
    d = s1 >= s0 ? 1 : -1;
  }
  const out: RoutePt[] = [];
  const steps = Math.max(1, Math.round(span / ROAD_DS));
  for (let k = 0; k <= steps; k++) out.push(roadPoint(r, s0 + (d * span * k) / steps));
  return out;
}

/** Join legs, rounding each turn-off with a quadratic corner of ≈ 12 m. */
function assemble(legs: RoutePt[][], heights: Float32Array): { pts: RoutePt[]; turnOffs: number[] } {
  let pts: RoutePt[] = [];
  const turnOffs: number[] = [];
  legs.forEach((leg, k) => {
    if (k === 0) {
      pts = [...leg];
      return;
    }
    // trim 12 m before the join on the current route and 12 m after it on the new leg
    const R = 12;
    let a = pts.length - 1;
    let acc = 0;
    while (a > 0 && acc < R) {
      acc += Math.hypot(pts[a]!.x - pts[a - 1]!.x, pts[a]!.z - pts[a - 1]!.z);
      a--;
    }
    let b = 0;
    acc = 0;
    while (b < leg.length - 1 && acc < R) {
      acc += Math.hypot(leg[b + 1]!.x - leg[b]!.x, leg[b + 1]!.z - leg[b]!.z);
      b++;
    }
    const P0 = pts[a]!;
    const P2 = leg[b]!;
    const C = leg[0]!;
    pts = pts.slice(0, a + 1);
    turnOffs.push(pts.length - 1);
    const steps = 12;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * P0.x + 2 * (1 - t) * t * C.x + t * t * P2.x;
      const z = (1 - t) * (1 - t) * P0.z + 2 * (1 - t) * t * C.z + t * t * P2.z;
      pts.push({ x, y: heightAt(heights, x, z), z, road: t < 0.5 ? P0.road : P2.road, s: t < 0.5 ? P0.s : P2.s, pad: P0.pad && P2.pad });
    }
    pts.push(...leg.slice(b));
  });
  return { pts, turnOffs };
}

/** Uniform 2 m resampling (keeps road/pad tags of the nearest source point). */
function resampleRoute(src: RoutePt[]): RoutePt[] {
  const cum = [0];
  for (let i = 1; i < src.length; i++) cum.push(cum[i - 1]! + Math.hypot(src[i]!.x - src[i - 1]!.x, src[i]!.z - src[i - 1]!.z));
  const L = cum[cum.length - 1]!;
  const n = Math.max(2, Math.round(L / ROAD_DS) + 1);
  const out: RoutePt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (L * k) / (n - 1);
    while (j < src.length - 2 && cum[j + 1]! < s) j++;
    const span = cum[j + 1]! - cum[j]! || 1;
    const t = Math.max(0, Math.min(1, (s - cum[j]!) / span));
    const a = src[j]!;
    const b = src[j + 1]!;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, road: t < 0.5 ? a.road : b.road, s: t < 0.5 ? a.s : b.s, pad: t < 0.5 ? a.pad : b.pad });
  }
  return out;
}

function routeRadius(pts: RoutePt[], i: number, k = 5): number {
  const a = pts[Math.max(0, i - k)]!;
  const b = pts[i]!;
  const c = pts[Math.min(pts.length - 1, i + k)]!;
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  return Math.abs(cross) < 1e-9 ? Infinity : (ab * bc * ca) / (2 * Math.abs(cross));
}

function routeGrade(pts: RoutePt[], i: number): number {
  const a = pts[Math.max(0, i - 2)]!;
  const b = pts[Math.min(pts.length - 1, i + 2)]!;
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return Math.abs(b.y - a.y) / d;
}

/** Checkpoint rules: grade ≤ 4 %, plan R ≥ 60 m unless on a pad, ≥ 15 m from any ramp. */
export function checkpointOk(pts: RoutePt[], i: number, ramps: readonly RampInfo[]): boolean {
  if (routeGrade(pts, i) > 0.04) return false;
  const p = pts[i]!;
  if (!p.pad && routeRadius(pts, i) < 60) return false;
  for (const r of ramps) if (rampDistance(r, p.x, p.z) < 15) return false;
  return true;
}

function gateAt(pts: RoutePt[], i: number, roads: RoadBuild[]): GateData {
  const p = pts[i]!;
  const a = pts[Math.max(0, i - 2)]!;
  const b = pts[Math.min(pts.length - 1, i + 2)]!;
  const w = roads[p.road]!.def.width;
  return { position: v3(p.x, p.y, p.z), yaw: r3(yawOf(b.x - a.x, b.z - a.z)), size: [w + 10, 10, 8] };
}

function speedPlan(pts: RoutePt[], roads: RoadBuild[]): Float32Array {
  const n = pts.length;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const grip = SURFACE_TABLE[roads[pts[i]!.road]!.def.surface].grip;
    v[i] = Math.min(85, Math.sqrt(9 * grip * routeRadius(pts, i)));
  }
  const brake = 7;
  const accel = 5;
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! * v[i + 1]! + 2 * brake * ROAD_DS));
  v[0] = 0;
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i]!, Math.sqrt(v[i - 1]! * v[i - 1]! + 2 * accel * ROAD_DS));
  for (let i = 0; i < n; i++) v[i] = Math.round(v[i]! * 100) / 100;
  return v;
}

function buildRace(def: RaceDef, roads: RoadBuild[], heights: Float32Array, ramps: readonly RampInfo[], warn: (m: string) => void): WorldEvent {
  const byId = (id: string) => {
    const r = roads.find((q) => q.def.id === id);
    if (!r) throw new Error(`race ${def.id}: unknown road ${id}`);
    return r;
  };
  const legs = def.legs.map((l) => legPoints(byId(l.road), l.from, l.to, l.dir, l.lap));
  if (def.spawnBack > 0) {
    const first = def.legs[0]!;
    const r = byId(first.road);
    const p0 = legs[0]![0]!;
    const dir = first.dir ?? 1;
    const back: RoutePt[] = [];
    const steps = Math.round(def.spawnBack / ROAD_DS);
    for (let k = steps; k >= 1; k--) back.push(roadPoint(r, p0.s - dir * k * ROAD_DS));
    legs[0] = [...back, ...legs[0]!];
  }
  const assembled = assemble(legs, heights);
  const pts = resampleRoute(assembled.pts);
  const n = pts.length;
  // checkpoints: nearest route point after the previous one, then ≤ 40 m to a valid one
  const gates: number[] = [];
  let from = 1;
  const pickNear = (ax: number, az: number, start: number): number => {
    let bi = start;
    let bd = Infinity;
    for (let i = start; i < n; i++) {
      const d = Math.hypot(pts[i]!.x - ax, pts[i]!.z - az);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  };
  const slide = (i0: number, label: string): number => {
    const maxK = Math.round(40 / ROAD_DS);
    for (let k = 0; k <= maxK; k++)
      for (const sgn of [1, -1]) {
        const i = i0 + sgn * k;
        if (i <= 0 || i >= n - 1) continue;
        if (checkpointOk(pts, i, ramps)) return i;
      }
    warn(`${def.id}: no valid spot within 40 m of ${label}`);
    return i0;
  };
  def.checkpoints.forEach((a, k) => {
    let i = pickNear(a[0], a[1], from);
    if (def.padExits?.[k]) {
      // the anchor's pad: walk to the pad's exit
      let j = i;
      while (j < n - 1 && pts[j + 1]!.pad) j++;
      if (pts[i]!.pad) i = j;
    }
    i = slide(i, `checkpoint ${k + 1}`);
    gates.push(i);
    from = i + 5;
  });
  let fi = n - 1;
  if (def.finish) fi = slide(pickNear(def.finish[0], def.finish[1], from), 'finish');
  gates.push(fi);
  const spawnI = 0;
  const sp = pts[spawnI]!;
  const sn = pts[Math.min(n - 1, spawnI + 3)]!;
  const spawn = { position: v3(sp.x, sp.y, sp.z), yaw: r3(yawOf(sn.x - sp.x, sn.z - sp.z)) };
  const checkpoints = [{ index: 0, position: spawn.position, yaw: spawn.yaw, size: [roads[sp.road]!.def.width + 10, 10, 8] as Vec3 }];
  gates.slice(0, -1).forEach((gi, k) => checkpoints.push({ index: k + 1, ...gateAt(pts, gi, roads) }));
  const finish = gateAt(pts, fi, roads);
  // route arrays (to the finish)
  const last = fi;
  const route = new Float32Array((last + 1) * 3);
  for (let i = 0; i <= last; i++) {
    route[i * 3] = r3(pts[i]!.x);
    route[i * 3 + 1] = r3(pts[i]!.y);
    route[i * 3 + 2] = r3(pts[i]!.z);
  }
  const used = pts.slice(0, last + 1);
  const tight: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i < used.length; i++) {
    const t = routeRadius(used, i) < 120;
    if (t && runStart < 0) runStart = i;
    if (!t && runStart >= 0) {
      tight.push([runStart, i]);
      runStart = -1;
    }
  }
  if (runStart >= 0) tight.push([runStart, used.length]);
  let lengthM = 0;
  for (let i = 1; i <= last; i++) lengthM += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  return {
    id: def.id,
    name: def.name,
    mode: 'race',
    accent: def.accent,
    spawn,
    checkpoints,
    finish,
    lengthM: Math.round(lengthM),
    route,
    speeds: speedPlan(used, roads),
    gates,
    turnOffs: assembled.turnOffs.map((t) => Math.min(last, Math.round((t * (n - 1)) / Math.max(1, assembled.pts.length - 1)))),
    tightBends: tight,
  };
}

function roamEvent(roads: RoadBuild[]): WorldEvent {
  const av = roads.find((r) => r.def.id === 'av-620')!;
  const s = projectOnRoad(av, SPAWN.x, SPAWN.z).s;
  const p = roadPoint(av, s);
  const spawn = { position: v3(SPAWN.x, p.y, SPAWN.z), yaw: r3(SPAWN.yaw) };
  return {
    id: ROAM_ID,
    name: ROAM_NAME,
    mode: 'roam',
    accent: ROAM_ACCENT,
    spawn,
    checkpoints: [{ index: 0, position: spawn.position, yaw: spawn.yaw, size: [24, 10, 8] }],
    finish: { position: [SPAWN.x, -10000, SPAWN.z], yaw: 0, size: [0, 0, 0] },
    lengthM: 0,
    route: new Float32Array(0),
    speeds: new Float32Array(0),
    gates: [],
    turnOffs: [],
    tightBends: [],
  };
}

// ── Ramps ───────────────────────────────────────────────────────────────────────────────────

export interface RampBuild {
  cuboids: RampCuboid[];
  info: RampInfo[];
  boxes: Box[];
}

export function buildRamps(heights: Float32Array): RampBuild {
  const cuboids: RampCuboid[] = [];
  const info: RampInfo[] = [];
  const boxes: Box[] = [];
  const T = 0.6; // slab thickness
  for (const d of RAMP_DEFS) {
    const g = heightAt(heights, d.at[0], d.at[1]);
    // eased kicker: four segments of rising pitch whose rise sums to kickerH
    const fr = [0.25, 0.5, 0.75, 1];
    const sinSum = fr.reduce((s, f) => s + Math.sin(d.kickerDeg * f * DEG), 0);
    const segLen = d.kickerH / sinSum;
    const profile: RampSegmentSpec[] = fr.map((f) => ({ angleDeg: d.kickerDeg * f, length: segLen }));
    if (d.tableLen > 0) {
      profile.push({ angleDeg: 0, length: d.tableLen });
      const landLen = d.kickerH / Math.sin(d.landingDeg * DEG);
      profile.push({ angleDeg: -d.landingDeg, length: landLen });
    }
    const build = buildRamp(0, profile, T, 0);
    const c = Math.cos(d.yaw);
    const s = Math.sin(d.yaw);
    const toWorld = (lx: number, ly: number, lz: number): Vec3 => v3(d.at[0] + lx * c + lz * s, g + ly, d.at[1] - lx * s + lz * c);
    build.segments.forEach((seg) => {
      const center = toWorld(seg.center[0], seg.center[1], seg.center[2]);
      cuboids.push({ rampId: d.id, center, half: [d.width / 2, T / 2, seg.length / 2], yaw: r3(d.yaw), pitch: r3(seg.rotationX) });
      boxes.push({ x: center[0], y: center[1], z: center[2], sx: d.width, sy: T, sz: seg.length, yaw: d.yaw, pitch: seg.rotationX, color: 0xd9dde4, glow: 0, ground: false });
      boxes.push({ x: center[0], y: center[1] + T / 2 + 0.02, z: center[2], sx: 0.4, sy: 0.05, sz: seg.length, yaw: d.yaw, pitch: seg.rotationX, color: 0xffb02e, glow: 1.8, ground: false });
    });
    // support block under the table (collider + visual)
    if (d.tableLen > 0) {
      const z0 = d.kickerH / Math.tan(d.kickerDeg * DEG * 0.62);
      const centerZ = z0 + d.tableLen / 2;
      const h = d.kickerH - T;
      const center = toWorld(0, h / 2, centerZ);
      cuboids.push({ rampId: d.id, center, half: [d.width / 2, h / 2, d.tableLen / 2], yaw: r3(d.yaw), pitch: 0 });
      boxes.push({ x: center[0], y: center[1], z: center[2], sx: d.width, sy: h, sz: d.tableLen, yaw: d.yaw, color: 0x8b8f99, glow: 0, ground: true });
    }
    const lip = toWorld(build.lip[0], build.lip[1], build.lip[2]);
    const span = build.lip[2] + (d.tableLen > 0 ? d.tableLen + d.kickerH / Math.tan(d.landingDeg * DEG) : 0);
    const mid = toWorld(0, 0, span / 2);
    info.push({ id: d.id, name: d.name, lip, yaw: r3(d.yaw), center: mid, radius: r3(span / 2 + d.width / 2), halfLength: r3(span / 2), halfWidth: d.width / 2 });
  }
  return { cuboids, info, boxes };
}

// ── Everything else ─────────────────────────────────────────────────────────────────────────

export interface EventSet {
  events: WorldEvent[];
  spots: TravelSpot[];
  pads: EventPad[];
  signs: SignData[];
  landmarks: Landmark[];
  probes: ProbePose[];
  warnings: string[];
}

export function buildEvents(roads: RoadBuild[], heights: Float32Array, ramps: readonly RampInfo[]): EventSet {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const races = RACE_DEFS.map((d) => buildRace(d, roads, heights, ramps, warn));
  const roam = roamEvent(roads);
  const events = [roam, ...races];
  const race = (id: string) => races.find((e) => e.id === id)!;
  const byId = (id: string) => roads.find((r) => r.def.id === id)!;
  const onRoad = (id: string, x: number, z: number, forward: boolean): TravelSpot['position'] & number[] => {
    const r = byId(id);
    const p = roadPoint(r, projectOnRoad(r, x, z).s);
    void forward;
    return v3(p.x, p.y, p.z);
  };
  const tangentYaw = (id: string, x: number, z: number, sign: 1 | -1): number => {
    const r = byId(id);
    const s = projectOnRoad(r, x, z).s;
    const a = roadPoint(r, s - 2);
    const b = roadPoint(r, s + 2);
    return r3(sign > 0 ? yawOf(b.x - a.x, b.z - a.z) : yawOf(a.x - b.x, a.z - b.z));
  };
  // Travel spots.
  const rim = byId('rimway');
  const trapS = projectOnRoad(rim, ...rimAt(33)).s;
  const satP = roadPoint(rim, trapS + 250);
  const satA = roadPoint(rim, trapS + 252);
  const satB = roadPoint(rim, trapS + 248);
  const summit = byId('summit');
  const summitEnd = roadPoint(summit, (summit.n - 1) * summit.ds - 6);
  const summitPrev = roadPoint(summit, (summit.n - 1) * summit.ds - 10);
  const kite = runwayPoint(12, 0);
  const spots: TravelSpot[] = [
    { id: 'volt-docks', label: 'Volt Docks', position: roam.spawn.position, yaw: roam.spawn.yaw },
    { id: 'rim-start', label: 'Rimway Loop start', position: race('tessera-rim').spawn.position, yaw: race('tessera-rim').spawn.yaw },
    { id: 'crown-start', label: 'Crown Climb start', position: race('tessera-crown').spawn.position, yaw: race('tessera-crown').spawn.yaw },
    { id: 'rally-start', label: 'Cinnabar Rally start', position: race('tessera-rally').spawn.position, yaw: race('tessera-rally').spawn.yaw },
    { id: 'kiteflat', label: 'Kiteflat', position: v3(kite[0], RUNWAY.y, kite[1]), yaw: r3(RUNWAY.yaw) },
    { id: 'glassmere', label: 'Glassmere shore', position: onRoad('rimway', ...rimAt(322), true), yaw: tangentYaw('rimway', ...rimAt(322), -1) },
    { id: 'hearthwick', label: 'Hearthwick', position: onRoad('lanes', 200, 600, true), yaw: tangentYaw('lanes', 200, 600, 1) },
    { id: 'crownpeak', label: 'Crownpeak', position: v3(summitEnd.x, summitEnd.y, summitEnd.z), yaw: r3(yawOf(summitEnd.x - summitPrev.x, summitEnd.z - summitPrev.z)) },
    { id: 'saltglass', label: 'Saltglass Flats', position: v3(satP.x, satP.y, satP.z), yaw: r3(yawOf(satB.x - satA.x, satB.z - satA.z)) },
  ];
  // Event pads at each race start.
  const pads: EventPad[] = races.map((e) => ({ eventId: e.id, position: e.spawn.position, yaw: e.spawn.yaw, radius: 9, accent: e.accent }));
  // Landmarks.
  const landmarks: Landmark[] = LANDMARK_DEFS.map((l) => ({ id: l.id, name: l.name, x: l.x, z: l.z, y: r3(heightAt(heights, l.x, l.z)), glyph: l.glyph }));
  // Signs: place names beside a road near each landmark, ramp signs at the ramps.
  const signs: SignData[] = [];
  const placeSign = (id: string, text: string, sub: string, roadId: string, x: number, z: number) => {
    const r = byId(roadId);
    const s = projectOnRoad(r, x, z).s;
    const p = roadPoint(r, s);
    const a = roadPoint(r, s - 2);
    const b = roadPoint(r, s + 2);
    const tx = (b.x - a.x) / 4;
    const tz = (b.z - a.z) / 4;
    const off = r.def.width / 2 + 3;
    const px = p.x - tz * off;
    const pz = p.z + tx * off;
    signs.push({ id, text, sub, kind: 'place', rampId: null, position: v3(px, heightAt(heights, px, pz), pz), yaw: r3(yawOf(-tx, -tz)), width: 8, height: 3 });
  };
  placeSign('sign-volt-docks', 'VOLT DOCKS', 'PRISM CITY', 'quay', -560, 345);
  placeSign('sign-spire-plaza', 'SPIRE PLAZA', 'PRISM CITY', 'av-620', -620, -240);
  placeSign('sign-crownway', 'CROWNWAY', 'CROWN SADDLE', 'crownway', -360, 40);
  placeSign('sign-saddle', 'CROWN SADDLE', 'SUMMIT ROAD', 'summit', SADDLE.x + 30, SADDLE.z - 10);
  placeSign('sign-crownpeak', 'CROWNPEAK', 'OBSERVATORY', 'summit', PLAZA.x - 30, PLAZA.z + 30);
  placeSign('sign-kiteflat', 'KITEFLAT', 'AIRSTRIP', 'kite-access', -140, -540);
  placeSign('sign-tin-spur', 'TIN SPUR', 'CINNABAR REACH', 'cinnabar-loop', 400, -540);
  placeSign('sign-arch', 'CINNABAR ARCH', 'CINNABAR LOOP', 'cinnabar-loop', 80, -560);
  placeSign('sign-saltglass', 'SALTGLASS FLATS', 'SPEED TRAP', 'rimway', ...rimAt(40));
  placeSign('sign-hearthwick', 'HEARTHWICK', 'PATCHWORK DOWNS', 'lanes', 150, 610);
  placeSign('sign-cobblekeep', 'COBBLEKEEP', 'COBBLE HILL', 'castle-ramp', 320, 612);
  placeSign('sign-glassmere', 'GLASSMERE FORD', 'PATCHWORK LANES', 'lanes', 440, 410);
  placeSign('sign-lantern', 'LANTERN POINT', 'LANTERN BAY', 'rimway', ...rimAt(228));
  placeSign('sign-shell-cove', 'SHELL COVE', 'THE RIMWAY', 'rimway', ...rimAt(8));
  for (const ri of ramps) {
    if (ri.id === 'hay-hop-2' || ri.id === 'hay-hop-3') continue;
    const c = Math.cos(ri.yaw);
    const s = Math.sin(ri.yaw);
    const px = ri.lip[0] + c * 9;
    const pz = ri.lip[2] - s * 9;
    signs.push({ id: `sign-${ri.id}`, text: ri.name, sub: 'BEST AIR —', kind: 'ramp', rampId: ri.id, position: v3(px, heightAt(heights, px, pz), pz), yaw: r3(ri.yaw + Math.PI), width: 7, height: 3 });
  }
  // Probe poses (render-budget spots).
  const rimPose = (t: number): ProbePose['position'] & number[] => {
    const p = roadPoint(rim, projectOnRoad(rim, ...rimAt(t)).s);
    return v3(p.x, p.y, p.z);
  };
  const loop = byId('cinnabar-loop');
  const archS = projectOnRoad(loop, 112, -560).s;
  const archP = roadPoint(loop, archS);
  const archN = roadPoint(loop, archS + 4);
  const saddleP = onRoad('crownway', SADDLE.x, SADDLE.z, true);
  const probes: ProbePose[] = [
    { id: 'spawn', label: 'Volt Docks plaza (spawn)', position: roam.spawn.position, yaw: roam.spawn.yaw },
    { id: 'spire-plaza', label: 'Spire Plaza facing south', position: onRoad('av-620', -620, -255, true), yaw: 0 },
    { id: 'city-centre', label: 'City centre facing east', position: onRoad('st-40', -540, -40, true), yaw: r3(Math.PI / 2) },
    { id: 'crownpeak', label: 'Crownpeak plaza facing SE', position: spots[7]!.position, yaw: r3(Math.PI / 4) },
    { id: 'crown-saddle', label: 'Crown Saddle', position: saddleP, yaw: tangentYaw('crownway', SADDLE.x, SADDLE.z, 1) },
    { id: 'kiteflat', label: 'Kiteflat W end', position: spots[4]!.position, yaw: spots[4]!.yaw },
    { id: 'glassmere', label: 'Glassmere jetty', position: spots[5]!.position, yaw: spots[5]!.yaw },
    { id: 'cinnabar-arch', label: 'Cinnabar Arch', position: v3(archP.x, archP.y, archP.z), yaw: r3(yawOf(archN.x - archP.x, archN.z - archP.z)) },
    { id: 'tin-spur', label: 'Tin Spur', position: race('tessera-rally').spawn.position, yaw: race('tessera-rally').spawn.yaw },
    { id: 'hearthwick', label: 'Hearthwick', position: spots[6]!.position, yaw: spots[6]!.yaw },
    { id: 'rim-0', label: 'Rimway θ 0° along the road', position: rimPose(0), yaw: tangentYaw('rimway', ...rimAt(0), -1) },
    { id: 'rim-90', label: 'Rimway θ 90° along the road', position: rimPose(90), yaw: tangentYaw('rimway', ...rimAt(90), -1) },
  ];
  return { events, spots, pads, signs, landmarks, probes, warnings };
}
