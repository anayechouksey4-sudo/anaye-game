/**
 * validate(): every hard drivability rule of PLAN §3.6 plus the checkpoint, lake, flatness,
 * clearance, ramp, id and budget rules. Returns errors (breaches) and warnings (documented
 * relaxations). Pure.
 */
import type { WorldInternals } from './generateWorld';
import { planRadii } from './geom';
import { heightAt as heightAt_ } from './heightAt';
import { flatAreaDist, flatDistFn, type RoadBuild } from './roads';
import { CORE_H, CORE_R } from './terrain';
import { inLake as inLake_ } from './textures';
import { AVENUES, FLAT_AREAS, GLASSMERE as GLASSMERE_, LOOP_GULCH, PEAK, STREETS } from './tessera';

const heightAt = heightAt_;
const inLake = inLake_;
const GLASSMERE = GLASSMERE_;
import { CELL, ROAD_PAD, ROAD_SAFE, rampDistance, WORLD_CELLS, WORLD_HALF, WORLD_N, type WorldData } from './types';

export interface Issue {
  rule: string;
  where: string;
  detail: string;
  x?: number;
  z?: number;
}

export interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
  /** Violation counts per rule (errors only; issue lists are capped per rule). */
  counts: Record<string, number>;
  /** Measured extremes per rule (for the report). */
  measured: Record<string, number>;
  ms: number;
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const MAX_ID = 32;
export const BUDGET = { boxes: 6000, trees: 3000, colliderTriangles: 70000, colliders: 130, bytes: 12 * 1024 * 1024, rampCuboids: 60 };

const DEG = Math.PI / 180;
const TAN25 = Math.tan(25 * DEG);
const N = WORLD_N;
const NC = WORLD_CELLS;

export function validateWorld(world: WorldData, ctx: WorldInternals): ValidationReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const counts: Record<string, number> = {};
  const measured: Record<string, number> = {};
  const err = (rule: string, where: string, detail: string, x?: number, z?: number) => {
    counts[rule] = (counts[rule] ?? 0) + 1;
    if (counts[rule]! <= 40) errors.push({ rule, where, detail, x, z });
  };
  const warn = (rule: string, where: string, detail: string) => warnings.push({ rule, where, detail });
  const meas = (key: string, v: number) => {
    if (!(key in measured) || v > measured[key]!) measured[key] = Math.round(v * 10000) / 10000;
  };
  const H = world.heights;
  const hAt = (x: number, z: number) => heightAt(H, x, z);
  const roads = ctx.roads;
  const byId = (id: string) => roads.find((r) => r.def.id === id);
  const loop = byId('cinnabar-loop');
  const gulchS = loop ? [stationOf(loop, LOOP_GULCH[0]), stationOf(loop, LOOP_GULCH[1])] : [0, 0];
  const nat = ctx.terrain.natural;
  const inCore = (x: number, z: number) => {
    const ix = Math.max(0, Math.min(N - 1, Math.round((x + WORLD_HALF) / CELL)));
    const iz = Math.max(0, Math.min(N - 1, Math.round((z + WORLD_HALF) / CELL)));
    return Math.hypot(x - PEAK.x, z - PEAK.z) < CORE_R && nat[iz * N + ix]! > CORE_H - 6;
  };

  // ── Roads ────────────────────────────────────────────────────────────────────────────────
  for (const r of roads) {
    const d = r.def;
    const n = r.n;
    const L = r.closed ? n * r.ds : (n - 1) * r.ds;
    const radii = planRadii(r.xs, r.zs, r.closed, 5);
    const padNear = (i: number) => {
      for (let k = -6; k <= 6; k++) {
        const j = r.closed ? (i + k + n) % n : i + k;
        if (j >= 0 && j < n && r.flags[j]! & ROAD_PAD) return true;
      }
      return false;
    };
    const inHop = (s: number) => r.hopZones.some(([a, b]) => s >= a - 4 && s <= b + 4);
    for (let i = 0; i < n; i++) {
      const s = i * r.ds;
      const x = r.xs[i]!;
      const z = r.zs[i]!;
      // plan radius
      if (d.minR > 0 && Number.isFinite(radii[i]!)) {
        if (r.flags[i]! & ROAD_PAD) {
          meas(`minRpad`, -radii[i]!);
          if (radii[i]! < 18 - 0.5) err('plan-radius-pad', d.id, `R ${radii[i]!.toFixed(1)} < 18 m`, x, z);
        } else if (!padNear(i) && radii[i]! < d.minR - 0.5) err('plan-radius', d.id, `R ${radii[i]!.toFixed(1)} < ${d.minR} m at s ${s.toFixed(0)}`, x, z);
      }
      // grade
      const j = r.closed ? (i + 1) % n : i + 1;
      if (j < n) {
        const g = Math.abs(r.h[j]! - r.h[i]!) / r.ds;
        meas(`grade.${d.id}`, g);
        const bothPad = r.flags[i]! & ROAD_PAD && r.flags[j]! & ROAD_PAD;
        if (bothPad && g > 0.002) err('pad-grade', d.id, `pad grade ${(g * 100).toFixed(2)} %`, x, z);
        if (g > d.gradeMax + 0.002) err('grade', d.id, `${(g * 100).toFixed(2)} % > ${(d.gradeMax * 100).toFixed(1)} % at s ${s.toFixed(0)}`, x, z);
      }
      // vertical curves (10 m chords)
      if (d.crestR > 0) {
        const k = 5;
        const ia = r.closed ? (i - k + n) % n : i - k;
        const ib = r.closed ? (i + k) % n : i + k;
        if (ia >= 0 && ib < n) {
          const c = (r.h[ib]! - 2 * r.h[i]! + r.h[ia]!) / (k * r.ds) ** 2;
          const hop = inHop(s);
          const crestMin = hop ? 40 : d.crestR;
          const sagMin = hop ? 150 : d.sagR;
          if (c < 0 && -1 / c < crestMin * 0.98) err('crest-radius', d.id, `crest R ${(-1 / c).toFixed(0)} < ${crestMin} at s ${s.toFixed(0)}`, x, z);
          if (c > 0 && 1 / c < sagMin * 0.98) err('sag-radius', d.id, `sag R ${(1 / c).toFixed(0)} < ${sagMin} at s ${s.toFixed(0)}`, x, z);
        }
      }
      // coast
      if (r.h[i]! < 3 - 1e-6) err('coast', d.id, `road at y ${r.h[i]!.toFixed(2)} < 3 m`, x, z);
      // cut / fill
      const cf = Math.abs(r.h[i]! - r.base[i]!);
      const relaxed = (d.id === 'cinnabar-loop' && s >= gulchS[0]! && s <= gulchS[1]!) || inCore(x, z);
      if (relaxed) {
        meas('cutFillRelaxed', cf);
        if (cf > 30) err('cut-fill', d.id, `${cf.toFixed(1)} m (masked zone limit 30)`, x, z);
      } else {
        meas('cutFill', cf);
        if (cf > 18) err('cut-fill', d.id, `${cf.toFixed(1)} m > 18 m at s ${s.toFixed(0)}`, x, z);
      }
      // safe-pose candidates
      if (r.flags[i]! & ROAD_SAFE) {
        const g = Math.abs(r.h[Math.min(n - 1, i + 1)]! - r.h[Math.max(0, i - 1)]!) / (2 * r.ds);
        if (g > 0.04 + 1e-3 || (!(r.flags[i]! & ROAD_PAD) && radii[i]! < 60)) err('safe-pose', d.id, `candidate breaks the checkpoint rules`, x, z);
      }
    }
    // land guard (every 10 m)
    const quayish = d.quay || d.id === 'quay' || d.id === 'av-620' || d.kind === 'rail';
    if (!quayish) {
      for (let i = 0; i < n; i += 5) {
        const off = d.width / 2 + (d.guard ?? 50);
        for (const side of [-1, 1]) {
          const px = r.xs[i]! - r.tz[i]! * off * side;
          const pz = r.zs[i]! + r.tx[i]! * off * side;
          if (Math.abs(px) > 1020 || Math.abs(pz) > 1020) continue;
          if (hAt(px, pz) < -0.05 && !inLake(px, pz)) {
            err('land-guard', d.id, `sea within half-width + ${d.guard ?? 50} m`, px, pz);
            break;
          }
        }
      }
    }
    // fidelity along the centreline and wheel tracks (every 0.5 m)
    const step = 0.5;
    let prev2 = NaN;
    let prev1 = NaN;
    for (let s = 0; s <= L - (r.closed ? step : 0); s += step) {
      const f = s / r.ds;
      const i0 = Math.min(n - 1, Math.floor(f));
      const i1 = r.closed ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
      const t = f - Math.floor(f);
      const x = r.xs[i0]! + (r.xs[i1]! - r.xs[i0]!) * t;
      const z = r.zs[i0]! + (r.zs[i1]! - r.zs[i0]!) * t;
      const p = r.h[i0]! + (r.h[i1]! - r.h[i0]!) * t;
      const tx = r.tx[i0]!;
      const tz = r.tz[i0]!;
      const hop = inHop(s);
      const tc = hAt(x, z);
      const dc = Math.abs(tc - p);
      meas(hop ? 'fidelityHop' : 'fidelity', dc);
      if (dc > (hop ? 0.15 : 0.05)) err('fidelity', d.id, `|terrain - profile| ${dc.toFixed(3)} m at s ${s.toFixed(1)}`, x, z);
      for (const side of [-0.85, 0.85]) {
        const wx = x - tz * side;
        const wz = z + tx * side;
        const dw = Math.abs(hAt(wx, wz) - p);
        meas(hop ? 'wheelHop' : 'wheel', dw);
        if (dw > (hop ? 0.12 : 0.03)) err('wheel-track', d.id, `${dw.toFixed(3)} m at s ${s.toFixed(1)}`, wx, wz);
      }
      if (!hop && Number.isFinite(prev2)) {
        const d2 = Math.abs(tc - 2 * prev1 + prev2);
        meas('secondDiff', d2);
        if (d2 > 0.02) err('second-diff', d.id, `${d2.toFixed(3)} m per 0.5 m at s ${s.toFixed(1)}`, x, z);
      }
      prev2 = prev1;
      prev1 = tc;
      if (hop) {
        prev1 = NaN;
        prev2 = NaN;
      }
      const e = d.width / 2 - 0.5;
      const hl = hAt(x - tz * e, z + tx * e);
      const hr = hAt(x + tz * e, z - tx * e);
      const cs = Math.abs(hl - hr) / (2 * e);
      meas('crossSlope', cs);
      if (cs > 0.02) err('cross-slope', d.id, `${(cs * 100).toFixed(2)} % at s ${s.toFixed(1)}`, x, z);
    }
  }
  // junction height mismatch
  for (const j of ctx.junctions) {
    const M = roads[j.major]!;
    const m = roads[j.minor]!;
    const dh = Math.abs(profileAt(M, j.sMajor) - profileAt(m, j.sMinor));
    meas('junction', dh);
    if (dh > 0.05) err('junction', `${M.def.id}/${m.def.id}`, `mismatch ${dh.toFixed(3)} m`, j.x, j.z);
  }

  // ── Terrain ──────────────────────────────────────────────────────────────────────────────
  const cliff = world.cliff;
  const edge = ctx.terrain.edgeDist;
  const nx = new Float64Array(NC * NC * 2);
  const ny = new Float64Array(NC * NC * 2);
  const nz = new Float64Array(NC * NC * 2);
  for (let cz = 0; cz < NC; cz++)
    for (let cx = 0; cx < NC; cx++) {
      const v = cz * N + cx;
      for (let k = 0; k < 2; k++) {
        let gx: number;
        let gz: number;
        if (k === 0) {
          gx = (H[v + 1]! - H[v]!) / CELL;
          gz = (H[v + N]! - H[v]!) / CELL;
        } else {
          gx = (H[v + N + 1]! - H[v + N]!) / CELL;
          gz = (H[v + N + 1]! - H[v + 1]!) / CELL;
        }
        const len = Math.sqrt(gx * gx + gz * gz + 1);
        const o = (cz * NC + cx) * 2 + k;
        nx[o] = -gx / len;
        ny[o] = 1 / len;
        nz[o] = -gz / len;
      }
    }
  const deep = (cx: number, cz: number) => {
    const v = cz * N + cx;
    return Math.max(H[v]!, H[v + 1]!, H[v + N]!, H[v + N + 1]!) < -1.5;
  };
  const free = (cx: number, cz: number) => cliff[cz * NC + cx] === 0 && !deep(cx, cz);
  const angle = (a: number, b: number) => Math.acos(Math.min(1, nx[a]! * nx[b]! + ny[a]! * ny[b]! + nz[a]! * nz[b]!)) / DEG;
  const fillCut = Math.tan(Math.atan(1 / 3));
  for (let cz = 0; cz < NC; cz++)
    for (let cx = 0; cx < NC; cx++) {
      const c = cz * NC + cx;
      const x = -WORLD_HALF + cx * CELL + 2;
      const z = -WORLD_HALF + cz * CELL + 2;
      const o = c * 2;
      const slope0 = Math.sqrt(1 / (ny[o]! * ny[o]!) - 1);
      const slope1 = Math.sqrt(1 / (ny[o + 1]! * ny[o + 1]!) - 1);
      const smax = Math.max(slope0, slope1);
      if (free(cx, cz)) {
        meas('slopeDeg', Math.atan(smax) / DEG);
        if (smax > TAN25 + 1e-4) err('slope', 'terrain', `${(Math.atan(smax) / DEG).toFixed(1)}° > 25°`, x, z);
        let dih = angle(o, o + 1);
        if (cx + 1 < NC && free(cx + 1, cz)) dih = Math.max(dih, angle(o + 1, (c + 1) * 2));
        if (cz + 1 < NC && free(cx, cz + 1)) dih = Math.max(dih, angle(o + 1, (c + NC) * 2));
        meas('dihedralDeg', dih);
        if (dih > 12 + 1e-3) err('slope-change', 'terrain', `${dih.toFixed(1)}° > 12° between neighbouring triangles`, x, z);
        // fills ≤ 6 m: ≤ 1:3
        const v = cz * N + cx;
        const ri = ctx.terrain.roadNear[v]!;
        const ed = Math.min(edge[v]!, edge[v + 1]!, edge[v + N]!, edge[v + N + 1]!);
        if (ri >= 0 && ed > 1.2 && ed < 40) {
          const r = roads[ri]!;
          const hr = profileAt(r, ctx.terrain.roadStation[v]!);
          const hc = (H[v]! + H[v + 1]! + H[v + N]! + H[v + N + 1]!) / 4;
          const depth = hr - hc;
          const raised = hc - (nat[v]! + nat[v + 1]! + nat[v + N]! + nat[v + N + 1]!) / 4;
          if (depth > 0.3 && depth <= 6 && raised > 0.3 && !r.def.quay) {
            meas('fillSlope', smax);
            if (smax > fillCut + 0.01) err('fill-slope', r.def.id, `fill slope 1:${(1 / smax).toFixed(2)} (depth ${depth.toFixed(1)} m)`, x, z);
          }
        }
      } else if (cliff[c] === 1 && smax > TAN25) {
        const v = cz * N + cx;
        const ed = Math.min(edge[v]!, edge[v + 1]!, edge[v + N]!, edge[v + N + 1]!);
        if (ed < 6 - 0.01) err('cliff-near-road', 'terrain', `cliff ${ed.toFixed(1)} m from a road edge`, x, z);
      }
    }
  // flat areas
  for (const a of FLAT_AREAS) {
    if (a.id !== 'kiteflat' && a.id !== 'saltglass') continue;
    let worst = 0;
    const f = flatDistFn(a);
    const sh = a.shape;
    const R = sh.kind === 'disc' ? sh.r : sh.kind === 'ellipse' ? Math.max(sh.a, sh.b) : Math.hypot(sh.halfAlong, sh.halfAcross);
    const ix0 = Math.max(0, Math.floor((sh.x - R + WORLD_HALF) / CELL));
    const ix1 = Math.min(N - 1, Math.ceil((sh.x + R + WORLD_HALF) / CELL));
    const iz0 = Math.max(0, Math.floor((sh.z - R + WORLD_HALF) / CELL));
    const iz1 = Math.min(N - 1, Math.ceil((sh.z + R + WORLD_HALF) / CELL));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -WORLD_HALF + ix * CELL;
        const z = -WORLD_HALF + iz * CELL;
        if (f(x, z) > 0) continue;
        worst = Math.max(worst, Math.abs(H[iz * N + ix]! - a.y));
      }
    meas(`flat.${a.id}`, worst);
    if (worst > 0.05) err('flatness', a.id, `±${worst.toFixed(3)} m > 0.05 m`);
  }
  // city intersections ± 0.1
  let cityWorst = 0;
  for (const ax of AVENUES)
    for (const sz of STREETS)
      for (let dz = -7; dz <= 7; dz += 1)
        for (let dx = -7; dx <= 7; dx += 1) cityWorst = Math.max(cityWorst, Math.abs(hAt(ax + dx, sz + dz) - 6));
  meas('cityIntersections', cityWorst);
  if (cityWorst > 0.1) err('intersection-flat', 'prism-city', `±${cityWorst.toFixed(3)} m`);
  // Glassmere
  let lakeDeep = 0;
  const lz0 = Math.max(0, Math.floor((GLASSMERE.z - GLASSMERE.b * 1.4 + WORLD_HALF) / CELL));
  const lz1 = Math.min(N - 1, Math.ceil((GLASSMERE.z + GLASSMERE.b * 1.4 + WORLD_HALF) / CELL));
  const lx0 = Math.max(0, Math.floor((GLASSMERE.x - GLASSMERE.a * 1.4 + WORLD_HALF) / CELL));
  const lx1 = Math.min(N - 1, Math.ceil((GLASSMERE.x + GLASSMERE.a * 1.4 + WORLD_HALF) / CELL));
  for (let iz = lz0; iz <= lz1; iz++)
    for (let ix = lx0; ix <= lx1; ix++) {
      const x = -WORLD_HALF + ix * CELL;
      const z = -WORLD_HALF + iz * CELL;
      if (!inLake(x, z)) continue;
      const h = H[iz * N + ix]!;
      if (h < GLASSMERE.level) lakeDeep = Math.max(lakeDeep, GLASSMERE.level - h);
      const e = Math.hypot((x - GLASSMERE.x) / GLASSMERE.a, (z - GLASSMERE.z) / GLASSMERE.b);
      if (e >= 1.02 && e <= 1.15 && h < GLASSMERE.rim) {
        const ri = ctx.terrain.roadNear[iz * N + ix]!;
        const ford = ri >= 0 && roads[ri]!.def.id === 'lanes' && ctx.terrain.roadDist[iz * N + ix]! < 4 + 16;
        if (!ford) err('lake-rim', 'glassmere', `rim ${h.toFixed(2)} < ${GLASSMERE.rim}`, x, z);
      }
    }
  meas('lakeDepth', lakeDeep);
  if (lakeDeep > 0.6 + 1e-3) err('lake-depth', 'glassmere', `${lakeDeep.toFixed(3)} m > 0.6 m`);
  // world edge is sea
  for (let k = 0; k < N; k += 4)
    for (const [ix, iz] of [
      [k, 0],
      [k, N - 1],
      [0, k],
      [N - 1, k],
    ] as const)
      if (H[iz * N + ix]! >= 0) err('edge', 'terrain', 'land at the world edge', -WORLD_HALF + ix * CELL, -WORLD_HALF + iz * CELL);

  // ── Props ────────────────────────────────────────────────────────────────────────────────
  const streetIds = new Set(roads.filter((r) => r.def.kind === 'street').map((r) => r.index));
  const intersections: [number, number][] = [];
  for (const ax of AVENUES) for (const sz of STREETS) intersections.push([ax, sz]);
  for (const f of ctx.props.footprints) {
    if (f.kind === 'rail') continue;
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    const rectDist = (px: number, pz: number) => {
      const dx = px - f.x;
      const dz = pz - f.z;
      const lx = Math.abs(dx * c - dz * s) - f.hx;
      const lz = Math.abs(dx * s + dz * c) - f.hz;
      return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
    };
    const R = Math.hypot(f.hx, f.hz) + 30;
    ctx.index.forEachNear(f.x, f.z, R, (li, seg) => {
      const r = roads[li]!;
      if (r.def.kind === 'rail' && f.kind !== 'building') return;
      const px = r.xs[seg]!;
      const pz = r.zs[seg]!;
      const dist = rectDist(px, pz) - r.def.width / 2;
      const roadY = r.h[seg]!;
      if (f.y0 > roadY + 6) return;
      let need = 0;
      let rule = '';
      if (f.kind === 'tree') {
        need = 8;
        rule = 'tree-clearance';
      } else if (f.kind === 'ghost') {
        need = 2;
        rule = 'ghost-clearance';
      } else if (f.kind === 'arch') {
        need = 4;
        rule = 'arch-clearance';
      } else {
        need = 3;
        rule = 'solid-clearance';
        if (f.kind === 'building' && streetIds.has(li)) {
          need = 6;
          rule = 'building-setback';
          for (const [ix, iz] of intersections) if (Math.hypot(f.x - ix, f.z - iz) < 40) need = 6;
        }
      }
      if (dist < need - 0.3) err(rule, `${f.label} by ${r.def.id}`, `${dist.toFixed(1)} m < ${need} m`, f.x, f.z);
    });
    if (f.kind === 'building') {
      for (const [ix, iz] of intersections) {
        const d = rectDist(ix, iz);
        // intersection corner: ≥ 8 m from both street edges at the corner (7 m half-width + 8)
        if (d < 7 + 8 - 0.3 && Math.abs(f.x - ix) < 40 && Math.abs(f.z - iz) < 40) err('corner-setback', f.label, `${(d - 7).toFixed(1)} m < 8 m at (${ix}, ${iz})`, f.x, f.z);
      }
    }
  }
  // guard rails where required
  const rails = ctx.props.footprints.filter((f) => f.kind === 'rail');
  for (const r of roads) {
    if (r.def.kind !== 'mountain') continue;
    const off = r.def.width / 2 + 1.5;
    for (let s = 6; s < r.length - 6; s += 8) {
      const i = Math.round(s / r.ds);
      for (const side of [-1, 1]) {
        const nxv = -r.tz[i]! * side;
        const nzv = r.tx[i]! * side;
        const drop = r.h[i]! - hAt(r.xs[i]! + nxv * (off + 8), r.zs[i]! + nzv * (off + 8));
        if (drop <= 6.5) continue;
        const px = r.xs[i]! + nxv * off;
        const pz = r.zs[i]! + nzv * off;
        if (edgeAt(ctx, px, pz) < 1.0) continue;
        if (!rails.some((f) => Math.hypot(f.x - px, f.z - pz) < 5)) err('guard-rail', r.def.id, `${drop.toFixed(1)} m drop without a rail at s ${s.toFixed(0)}`, px, pz);
      }
    }
  }
  // ramps: ≥ 8 m from every race route (route edge)
  for (const ramp of world.rampInfo) {
    for (const e of world.events) {
      const pts = e.route;
      if (pts.length === 0) continue;
      let best = Infinity;
      for (let k = 0; k < pts.length; k += 3) {
        const hit = ctx.index.nearest(pts[k]!, pts[k + 2]!, 30);
        const half = hit ? roads[hit.line]!.def.width / 2 : 8;
        best = Math.min(best, rampDistance(ramp, pts[k]!, pts[k + 2]!) - half);
      }
      meas('rampRouteMin', -best);
      if (best < 8) err('ramp-route', `${ramp.id} / ${e.id}`, `${best.toFixed(1)} m < 8 m from the route edge`);
    }
  }

  // ── Events, spots, ids ───────────────────────────────────────────────────────────────────
  const idOk = (id: string) => id.length <= MAX_ID && ID_PATTERN.test(id);
  for (const id of [...world.events.map((e) => e.id), ...world.spots.map((s) => s.id), ...world.roads.map((r) => r.id), ...world.rampInfo.map((r) => r.id), ...world.signs.map((s) => s.id)])
    if (!idOk(id)) err('id', id, 'fails the sanitizeId pattern');
  const pointRules = (label: string, x: number, y: number, z: number, yaw: number) => {
    // on a road (within its half-width) or on a flat area
    const hit = ctx.index.nearest(x, z, 20);
    const onRoad = hit && hit.dist <= roads[hit.line]!.def.width / 2 + 0.01;
    const onArea = FLAT_AREAS.some((a) => flatAreaDist(a, x, z) <= 0);
    if (!onRoad && !onArea) err('checkpoint-rules', label, 'not on a road', x, z);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const g = Math.abs(hAt(x + fx * 3, z + fz * 3) - hAt(x - fx * 3, z - fz * 3)) / 6;
    if (g > 0.04 + 1e-3) err('checkpoint-rules', label, `grade ${(g * 100).toFixed(1)} % > 4 %`, x, z);
    if (Math.abs(hAt(x, z) - y) > 0.1) err('checkpoint-rules', label, `y ${y.toFixed(2)} off the ground ${hAt(x, z).toFixed(2)}`, x, z);
    if (hit && onRoad) {
      const r = roads[hit.line]!;
      const radii = planRadii(r.xs, r.zs, r.closed, 5);
      const i = hit.seg;
      if (!(r.flags[i]! & ROAD_PAD) && radii[i]! < 60 && !onArea) err('checkpoint-rules', label, `plan R ${radii[i]!.toFixed(0)} < 60 m`, x, z);
    }
    for (const ramp of world.rampInfo) if (rampDistance(ramp, x, z) < 15) err('checkpoint-rules', label, `within 15 m of ${ramp.id}`, x, z);
  };
  for (const e of world.events) {
    if (e.mode === 'race') {
      e.checkpoints.forEach((cp) => pointRules(`${e.id} cp${cp.index}`, cp.position[0], cp.position[1], cp.position[2], cp.yaw));
      pointRules(`${e.id} finish`, e.finish.position[0], e.finish.position[1], e.finish.position[2], e.finish.yaw);
      for (let k = 1; k < e.gates.length; k++) if (e.gates[k]! <= e.gates[k - 1]!) err('gate-order', e.id, `gate ${k} not after gate ${k - 1}`);
      e.checkpoints.slice(1).forEach((cp) => {
        const hit = ctx.index.nearest(cp.position[0], cp.position[2], 20);
        const w = hit ? roads[hit.line]!.def.width : 0;
        if (cp.size[0] !== w + 10 || cp.size[1] !== 10 || cp.size[2] !== 8) err('gate-size', `${e.id} cp${cp.index}`, `size ${cp.size.join('×')}`);
      });
      const rt = e.route;
      for (let k = 3; k < rt.length; k += 3) {
        const step = Math.hypot(rt[k]! - rt[k - 3]!, rt[k + 2]! - rt[k - 1]!);
        if (step > 3) err('route-gap', e.id, `${step.toFixed(1)} m between route points`, rt[k]!, rt[k + 2]!);
      }
      for (let k = 0; k < rt.length; k += 3) {
        const hit = ctx.index.nearest(rt[k]!, rt[k + 2]!, 30);
        if (!hit || hit.dist > roads[hit.line]!.def.width / 2 + 3) err('route-off-road', e.id, `route point ${(hit?.dist ?? 99).toFixed(1)} m from a road`, rt[k]!, rt[k + 2]!);
      }
    } else pointRules(`${e.id} spawn`, e.spawn.position[0], e.spawn.position[1], e.spawn.position[2], e.spawn.yaw);
  }
  for (const s of world.spots) pointRules(`spot ${s.id}`, s.position[0], s.position[1], s.position[2], s.yaw);
  for (const w of ctx.warnings) if (/no valid spot/.test(w)) err('checkpoint-snap', 'events', w);

  // ── Budgets ──────────────────────────────────────────────────────────────────────────────
  const st = world.stats;
  if (st.boxes > BUDGET.boxes) err('budget', 'boxes', `${st.boxes} > ${BUDGET.boxes}`);
  if (st.trees > BUDGET.trees) err('budget', 'trees', `${st.trees} > ${BUDGET.trees}`);
  if (st.colliderTriangles > BUDGET.colliderTriangles) err('budget', 'collider triangles', `${st.colliderTriangles} > ${BUDGET.colliderTriangles}`);
  if (st.colliders > BUDGET.colliders) err('budget', 'colliders', `${st.colliders} > ${BUDGET.colliders}`);
  if (st.bytes > BUDGET.bytes) err('budget', 'bytes', `${st.bytes} > ${BUDGET.bytes}`);
  if (st.rampCuboids > BUDGET.rampCuboids) err('budget', 'ramp cuboids', `${st.rampCuboids} > ${BUDGET.rampCuboids}`);

  if ((measured.cutFillRelaxed ?? 0) > 18) warn('cut-fill', 'masked zones', `cut/fill up to ${measured.cutFillRelaxed!.toFixed(1)} m inside cliff-masked zones (gulch, massif core)`);
  const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  return { errors, warnings, counts, measured, ms: Math.round(ms) };
}

function stationOf(r: RoadBuild, p: [number, number]): number {
  let best = Infinity;
  let bs = 0;
  for (let i = 0; i < r.n; i++) {
    const d = Math.hypot(r.xs[i]! - p[0], r.zs[i]! - p[1]);
    if (d < best) {
      best = d;
      bs = i * r.ds;
    }
  }
  return bs;
}

function profileAt(r: RoadBuild, s: number): number {
  const n = r.n;
  let f = s / r.ds;
  if (r.closed) {
    f %= n;
    if (f < 0) f += n;
  } else f = Math.max(0, Math.min(n - 1, f));
  const i = Math.floor(f);
  const t = f - i;
  const j = r.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
  return r.h[i % n]! + (r.h[j]! - r.h[i % n]!) * t;
}

function edgeAt(ctx: WorldInternals, x: number, z: number): number {
  let best = Infinity;
  ctx.index.forEachNear(x, z, 30, (li, s) => {
    const r = ctx.roads[li]!;
    const d = Math.hypot(r.xs[s]! - x, r.zs[s]! - z) - r.def.width / 2;
    if (d < best) best = d;
  });
  return best;
}
