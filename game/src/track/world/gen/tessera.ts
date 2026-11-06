/**
 * Tessera Isle: authored plan-view data (ported from the lead's layout and re-authored where the
 * skeleton roads had to meet the drivability rules). Pure data + tiny helpers; the generator reads
 * everything from here. All names are original.
 *
 * Polar convention: θ measured from +X toward north (-Z): x = r cos θ, z = -r sin θ.
 */
import type { FilletPt, P2 } from './geom';
import type { RoadKind, SurfaceName } from './types';

export const SEED = 7177;
export const DEG = Math.PI / 180;

// ── Island shape ────────────────────────────────────────────────────────────────────────────
/** Trefoil coast before noise and the land guard. */
export const coastR = (t: number): number => 700 - 210 * Math.cos(3 * t);
/** Rimway centreline: the vetted clover. */
export const rimR = (t: number): number => 640 - 170 * Math.cos(3 * t);
export const polar = (r: number, tDeg: number): P2 => [r * Math.cos(tDeg * DEG), -r * Math.sin(tDeg * DEG)];
export const thetaOf = (x: number, z: number): number => {
  const t = Math.atan2(-z, x) / DEG;
  return t < 0 ? t + 360 : t;
};
export const rimAt = (tDeg: number): P2 => polar(rimR(tDeg * DEG), tDeg);
/** Coast noise amplitude (2 octaves). */
export const COAST_NOISE = [26, 12] as const;

// ── Heights ─────────────────────────────────────────────────────────────────────────────────
export const CITY_Y = 6;
export const PEAK = { x: 30, z: -10 };
/** Crownpeak Observatory plaza (flat disc). */
export const PLAZA = { x: 30, z: -10, r: 20, y: 181 };
/** Crown knob next to the plaza (the 185 m summit). */
export const CROWN_TOP = 185;
export const SADDLE = { x: -110, z: 190, r: 24, y: 55 };

/** Rimway height keys by θ (deg) and the θ ranges that must be exactly level. */
export const RIM_KEYS: readonly [number, number][] = [
  [0, 24.5],
  [18, 26],
  [56, 26],
  [90, 6],
  [234, 6],
  [252, 9],
  [268, 12],
  [290, 16],
  [300, 18],
  [322, 20],
  [334, 22],
  [352, 23.5],
];
export const RIM_FLATS: readonly [number, number][] = [
  [18, 56], // Saltglass Flats beside the road + the trap (and level past the Tin Spur bend)
  [90, 234], // Kite Bay, Bayfront Boulevard (city), Volt Docks, west Lantern Bay
];

// ── Prism City grid ─────────────────────────────────────────────────────────────────────────
export const AVENUES = [-700, -620, -540, -460, -380] as const;
export const STREETS = [-200, -120, -40, 40, 120, 200] as const;
/** March from (x0, z0) along (dx, dz) until reaching the Rimway radius. */
export function clipToRim(x0: number, z0: number, dx: number, dz: number): P2 {
  for (let s = 0; s < 2000; s += 0.25) {
    const x = x0 + dx * s;
    const z = z0 + dz * s;
    if (Math.hypot(x, z) >= rimR(thetaOf(x, z) * DEG)) return [x, z];
  }
  throw new Error('no rim');
}

// ── Flat areas ──────────────────────────────────────────────────────────────────────────────
export type FlatShape =
  | { kind: 'disc'; x: number; z: number; r: number }
  | { kind: 'ellipse'; x: number; z: number; a: number; b: number; yaw: number }
  | { kind: 'rect'; x: number; z: number; halfAlong: number; halfAcross: number; yaw: number };

export interface FlatArea {
  id: string;
  y: number;
  shape: FlatShape;
  /** Surface painted on it. */
  surface: SurfaceName;
  /** Land guard margin (m) beyond the shape (coastal areas). */
  guard: number;
  /** No envelope: the edge may drop straight to the water (quay walls). */
  quay?: boolean;
}

/** Kiteflat runway: W end, axis yaw (120°), flat area s ∈ [-60, 540] from the W end, across [-30, +50]. */
export const RUNWAY = { wx: -508, wz: -399, yaw: 120 * DEG, length: 480, width: 36, s0: -60, s1: 540, across0: -30, across1: 50, y: 6 };
export const runwayPoint = (s: number, across = 0): P2 => {
  const sx = Math.sin(RUNWAY.yaw);
  const sz = Math.cos(RUNWAY.yaw);
  // across > 0 is seaward (toward the bay): (cos yaw, -sin yaw)·(-1)
  return [RUNWAY.wx + sx * s - sz * across, RUNWAY.wz + sz * s + sx * across];
};

export const SALTGLASS = { x: 479, z: -361, a: 70, b: 180, y: 26 };
export const GLASSMERE = { x: 430, z: 300, a: 90, b: 55, level: 18, bed: 17.42, rim: 18.8 };
export const COBBLE_HILL = { x: 330, z: 470, top: 50, courtyard: 46, foot: 170 };
export const HEARTHWICK = { x: 200, z: 600, y: 20, r: 30 };
export const LANTERN_POINT = { x: -395, z: 425, y: 12, r: 50 };
export const DOCKS = { x0: -730, x1: -510, z0: 300, z1: 375 };

function flatAreas(): FlatArea[] {
  const [rcx, rcz] = runwayPoint((RUNWAY.s0 + RUNWAY.s1) / 2, (RUNWAY.across0 + RUNWAY.across1) / 2);
  return [
    {
      id: 'kiteflat',
      y: RUNWAY.y,
      shape: { kind: 'rect', x: rcx, z: rcz, halfAlong: (RUNWAY.s1 - RUNWAY.s0) / 2, halfAcross: (RUNWAY.across1 - RUNWAY.across0) / 2, yaw: RUNWAY.yaw },
      surface: 'asphalt',
      guard: 20,
    },
    { id: 'saltglass', y: SALTGLASS.y, shape: { kind: 'ellipse', x: SALTGLASS.x, z: SALTGLASS.z, a: SALTGLASS.a, b: SALTGLASS.b, yaw: 0 }, surface: 'salt', guard: 0 },
    { id: 'hearthwick', y: HEARTHWICK.y, shape: { kind: 'disc', x: HEARTHWICK.x, z: HEARTHWICK.z, r: HEARTHWICK.r }, surface: 'cobble', guard: 0 },
    { id: 'cobblekeep', y: COBBLE_HILL.top, shape: { kind: 'disc', x: COBBLE_HILL.x, z: COBBLE_HILL.z, r: COBBLE_HILL.courtyard }, surface: 'cobble', guard: 0 },
    { id: 'plaza', y: PLAZA.y, shape: { kind: 'disc', x: PLAZA.x, z: PLAZA.z, r: PLAZA.r }, surface: 'cobble', guard: 0 },
    { id: 'saddle', y: SADDLE.y, shape: { kind: 'disc', x: SADDLE.x, z: SADDLE.z, r: SADDLE.r }, surface: 'asphalt', guard: 0 },
    {
      id: 'volt-docks',
      y: CITY_Y,
      shape: { kind: 'rect', x: (DOCKS.x0 + DOCKS.x1) / 2, z: (DOCKS.z0 + DOCKS.z1) / 2, halfAlong: (DOCKS.z1 - DOCKS.z0) / 2, halfAcross: (DOCKS.x1 - DOCKS.x0) / 2, yaw: 0 },
      surface: 'asphalt',
      guard: 2,
    },
  ];
}
export const FLAT_AREAS: readonly FlatArea[] = flatAreas();

// ── Roads ───────────────────────────────────────────────────────────────────────────────────
export type RoadPath = { catmull: P2[] } | { fillet: FilletPt[] } | { line: P2[] };

export interface RoadDef {
  id: string;
  name: string;
  kind: RoadKind;
  surface: SurfaceName;
  width: number;
  closed?: boolean;
  path: RoadPath;
  /** Lower = stamped later (wins) and solved first. */
  priority: number;
  minR: number;
  gradeMax: number;
  crestR: number;
  sagR: number;
  /** Box-filter width for the vertical profile, m (sets the vertical curve radii). */
  filterW: number;
  /** Height keys: anchors projected onto the road. 'rim' = the Rimway θ table. */
  keys: { x: number; z: number; h: number }[] | 'rim';
  /** Hairpin pads (flat discs, r 24, centreline R ≥ 18) by centre; height from the keys. */
  pads?: { x: number; z: number }[];
  /** Extra level stretches (anchor pairs projected onto the road). */
  flats?: { a: P2; b: P2 }[];
  /** Rally hops: crest anchors (dirt only). */
  hops?: P2[];
  /** Land guard margin beyond the road edge, m (default 50). */
  guard?: number;
  /** Visual: cyan neon edges (Prism City). */
  neon?: boolean;
  /** Visual: flush kerbs on bends. */
  kerbs?: boolean;
  /** Visual: plank deck. */
  plank?: boolean;
  /** Steep sides allowed (pier: a narrow quay). */
  quay?: boolean;
}

/** Point at bearing b (deg, atan2(dz, dx) around the peak) and radius r from the peak. */
export const aroundPeak = (b: number, r: number): P2 => [PEAK.x + r * Math.cos(b * DEG), PEAK.z + r * Math.sin(b * DEG)];

/**
 * Switchback of arcs around the peak. Each leg runs from bearing b0 to b1 while its radius goes
 * r0 → r1; consecutive legs are joined by a hairpin pad wrapped around a circle of radius 19 m
 * placed `over` degrees beyond the leg end, midway between the two legs' radii.
 */
export interface ArcLeg {
  b0: number;
  b1: number;
  r0: number;
  r1: number;
}
export function switchback(
  start: FilletPt,
  legs: readonly ArcLeg[],
  end: FilletPt,
  finalPad: { b: number; r: number } | null = null,
  over = 6,
  stepDeg = 22,
): { path: FilletPt[]; pads: P2[] } {
  const path: FilletPt[] = [start];
  const pads: P2[] = [];
  legs.forEach((leg, k) => {
    const span = leg.b1 - leg.b0;
    const steps = Math.max(1, Math.round(Math.abs(span) / stepDeg));
    const i0 = k === 0 ? 1 : 1;
    for (let i = i0; i < steps; i++) {
      const f = i / steps;
      const r = leg.r0 + (leg.r1 - leg.r0) * f;
      const [x, z] = aroundPeak(leg.b0 + span * f, r);
      path.push([x, z, r * 0.9]);
    }
    const next = legs[k + 1];
    if (next) {
      const dir = Math.sign(span);
      const pb = leg.b1 + dir * over;
      const pr = (leg.r1 + next.r0) / 2;
      const c = aroundPeak(pb, pr);
      // travelling with decreasing bearing (dir < 0) the peak is on the right: turn right (-1)
      path.push([c[0], c[1], 19, dir < 0 ? -1 : 1]);
      pads.push(c);
    } else if (finalPad) {
      // last hairpin: its inner side opens onto the end (the summit plaza)
      const c = aroundPeak(finalPad.b, finalPad.r);
      path.push([c[0], c[1], 19, Math.sign(span) < 0 ? -1 : 1]);
      pads.push(c);
    }
  });
  path.push(end);
  return { path, pads };
}

const rimCtrl: P2[] = [];
for (let i = 0; i < 48; i++) rimCtrl.push(rimAt(i * 7.5));

const STREET = { kind: 'street' as const, surface: 'asphalt' as const, width: 14, minR: 0, gradeMax: 0.04, crestR: 0, sagR: 0, filterW: 30, neon: true };

function cityGrid(): RoadDef[] {
  const out: RoadDef[] = [];
  for (const x of AVENUES) {
    const north = clipToRim(x, 0, 0, -1);
    const south: P2 = x === -620 ? [-620, 345] : clipToRim(x, 0, 0, 1);
    out.push({
      ...STREET,
      id: `av${x}`,
      name: `Avenue ${-x}`,
      path: { line: [north, south] },
      priority: 1,
      keys: [
        { x: north[0], z: north[1], h: CITY_Y },
        { x: south[0], z: south[1], h: CITY_Y },
      ],
    });
  }
  for (const z of STREETS) {
    const west = clipToRim(-540, z, -1, 0);
    const east: P2 = [-380, z];
    out.push({
      ...STREET,
      id: `st${z}`,
      name: `Street ${z < 0 ? 'N' : 'S'}${Math.abs(z)}`,
      path: { line: [west, east] },
      priority: 2,
      keys: [
        { x: west[0], z: west[1], h: CITY_Y },
        { x: east[0], z: east[1], h: CITY_Y },
      ],
    });
  }
  return out;
}

const rim104 = rimAt(104);
const rim352 = rimAt(352);
const rim273 = rimAt(273);
const rim334 = rimAt(334);

/** Crownway: city gate → W foothills (one hairpin pad) → Crown Saddle → south flank → Rimway θ 352°. */
const CROWNWAY_PAD = { x: -286, z: -228 };
const CROWNWAY_LEVEL: P2 = [-78, 248];
const CROWNWAY_PATH: FilletPt[] = [
  [-380, 40],
  [-325, 30, 60],
  [-310, -70, 80],
  [CROWNWAY_PAD.x, CROWNWAY_PAD.z, 19, 1],
  [-230, -110, 90],
  [-230, 0, 100],
  [-215, 100, 100],
  [SADDLE.x, SADDLE.z, 60],
  aroundPeak(106, 318),
  aroundPeak(75, 335),
  [270, 300, 110],
  [380, 220, 100],
  [rim352[0], rim352[1]],
];
// give the two south-flank vertices fillets
CROWNWAY_PATH[8] = [CROWNWAY_PATH[8]![0], CROWNWAY_PATH[8]![1], 120];
CROWNWAY_PATH[9] = [CROWNWAY_PATH[9]![0], CROWNWAY_PATH[9]![1], 140];

/**
 * Summit Road: arcs around the peak on the S/SW faces with four hairpin pads; the last pad is at
 * plaza level and opens onto the Crownpeak plaza.
 */
const SUMMIT_PAD_Y = [84, 124, 162, PLAZA.y];
const SUMMIT_END = aroundPeak(186, PLAZA.r + 1);
const SUMMIT = switchback(
  [SADDLE.x, SADDLE.z],
  [
    { b0: 120, b1: 40, r0: 238, r1: 228 },
    { b0: 40, b1: 222, r0: 190, r1: 178 },
    { b0: 222, b1: 40, r0: 140, r1: 128 },
    { b0: 40, b1: 214, r0: 92, r1: 70 },
  ],
  [SUMMIT_END[0], SUMMIT_END[1]],
  { b: 220, r: 51 },
);

/**
 * Cinnabar Loop (closed, dirt): Tin Spur main street (west) → Dustline service road → down into
 * Cinnabar Gulch under the Arch → canyon S-bends → up beside Saltglass Flats (three rally hops) →
 * back into Tin Spur.
 */
export const LOOP_PATH: FilletPt[] = [
  [405, -572, 50],
  [330, -582, 60],
  [240, -622, 70],
  [150, -640, 70],
  [76, -596, 42, -1],
  [112, -560, 60],
  [185, -515, 50],
  [205, -445, 50],
  [270, -410, 50],
  [300, -330, 50],
  [240, -290, 45],
  [260, -200, 45],
  [350, -175, 45],
  [394, -235, 50],
  [396, -480, 60],
];
/** Gulch section of the loop: from the west-end descent to the climb-out beside the flats. */
export const LOOP_GULCH: [P2, P2] = [
  [30, -585],
  [390, -220],
];
export const LOOP_HOPS: P2[] = [
  [396, -335],
  [396, -385],
  [396, -435],
];

/** Cobblekeep gate: where the castle ramp's spiral (1.25 turns clockwise from 98°) meets the courtyard. */
const CASTLE_A0 = 152;
const CASTLE_GATE: P2 = [COBBLE_HILL.x + Math.cos((CASTLE_A0 / 180) * Math.PI + 2.5 * Math.PI) * 50, COBBLE_HILL.z + Math.sin((CASTLE_A0 / 180) * Math.PI + 2.5 * Math.PI) * 50];

/** Summit hairpin pad centres (in climbing order); the last one opens onto the plaza. */
export const SUMMIT_PADS: readonly P2[] = SUMMIT.pads;
export const CROWNWAY_PAD_CENTRE: P2 = [CROWNWAY_PAD.x, CROWNWAY_PAD.z];

export const ROAD_DEFS: readonly RoadDef[] = [
  {
    id: 'rimway',
    name: 'The Rimway',
    kind: 'highway',
    surface: 'asphalt',
    width: 16,
    closed: true,
    path: { catmull: rimCtrl },
    priority: 0,
    minR: 150,
    gradeMax: 0.06,
    crestR: 1200,
    sagR: 900,
    filterW: 110,
    keys: 'rim',
    kerbs: true,
  },
  ...cityGrid(),
  {
    id: 'quay',
    name: 'Volt Docks Quay',
    kind: 'street',
    surface: 'asphalt',
    width: 14,
    path: { line: [[-720, 345], [-520, 345]] },
    priority: 3,
    minR: 40,
    gradeMax: 0.01,
    crestR: 0,
    sagR: 0,
    filterW: 30,
    keys: [
      { x: -720, z: 345, h: CITY_Y },
      { x: -520, z: 345, h: CITY_Y },
    ],
    neon: true,
  },
  {
    id: 'pier',
    name: 'Volt Docks Pier',
    kind: 'street',
    surface: 'asphalt',
    width: 12,
    path: { line: [[-600, 345], [-600, 470]] },
    priority: 4,
    minR: 0,
    gradeMax: 0.01,
    crestR: 0,
    sagR: 0,
    filterW: 30,
    keys: [
      { x: -600, z: 345, h: CITY_Y },
      { x: -600, z: 470, h: CITY_Y },
    ],
    guard: 2,
    plank: true,
    quay: true,
  },
  {
    id: 'crownway',
    name: 'Crownway',
    kind: 'mountain',
    surface: 'asphalt',
    width: 12,
    path: { fillet: CROWNWAY_PATH },
    priority: 5,
    minR: 60,
    gradeMax: 0.09,
    crestR: 250,
    sagR: 200,
    filterW: 28,
    keys: [
      { x: -380, z: 40, h: CITY_Y },
      { x: SADDLE.x, z: SADDLE.z, h: SADDLE.y },
      // level for the first ~60 m past the saddle, where it parts from the summit road
      { x: CROWNWAY_LEVEL[0], z: CROWNWAY_LEVEL[1], h: SADDLE.y },
      { x: rim352[0], z: rim352[1], h: 23.5 },
    ],
    pads: [CROWNWAY_PAD],
  },
  {
    id: 'summit',
    name: 'Summit Road',
    kind: 'mountain',
    surface: 'asphalt',
    width: 12,
    path: { fillet: SUMMIT.path },
    priority: 6,
    minR: 60,
    gradeMax: 0.11,
    crestR: 250,
    sagR: 200,
    filterW: 28,
    keys: [
      { x: SADDLE.x, z: SADDLE.z, h: SADDLE.y },
      ...SUMMIT.pads.map(([x, z], k) => ({ x, z, h: SUMMIT_PAD_Y[k]! })),
      { x: SUMMIT_END[0], z: SUMMIT_END[1], h: PLAZA.y },
    ],
    pads: SUMMIT.pads.map(([x, z]) => ({ x, z })),
  },
  {
    id: 'kite-access',
    name: 'Kiteflat Road',
    kind: 'dirt',
    surface: 'dirt',
    width: 10,
    path: { line: [rim104, [-152, -568]] },
    priority: 7,
    minR: 40,
    gradeMax: 0.08,
    crestR: 0,
    sagR: 0,
    filterW: 30,
    keys: [
      { x: rim104[0], z: rim104[1], h: RUNWAY.y },
      { x: -152, z: -568, h: RUNWAY.y },
    ],
  },
  {
    id: 'cinnabar-loop',
    name: 'Cinnabar Loop',
    kind: 'dirt',
    surface: 'dirt',
    width: 10,
    closed: true,
    path: { fillet: LOOP_PATH },
    priority: 8,
    minR: 40,
    gradeMax: 0.12,
    crestR: 200,
    sagR: 150,
    filterW: 50,
    keys: [
      { x: 405, z: -572, h: 27 },
      { x: 240, z: -622, h: 23 },
      { x: 110, z: -640, h: 12.5 },
      { x: 34, z: -596, h: 10 },
      { x: 112, z: -560, h: 11 },
      { x: 270, z: -410, h: 12.5 },
      { x: 255, z: -230, h: 17 },
      { x: 350, z: -175, h: 19 },
      { x: 395, z: -290, h: 26 },
      { x: 396, z: -480, h: 26 },
    ],
    hops: LOOP_HOPS,
  },
  {
    id: 'lanes',
    name: 'Patchwork Lanes',
    kind: 'lane',
    surface: 'dirt',
    width: 8,
    path: {
      fillet: [
        [rim273[0], rim273[1]],
        [110, 615, 60],
        [HEARTHWICK.x, HEARTHWICK.z, 80],
        [310, 612, 80],
        [420, 595, 70],
        [510, 525, 60],
        [497, 445, 60],
        [471, 370, 60],
        [470, 238, 60],
        [rim334[0], rim334[1]],
      ],
    },
    priority: 9,
    minR: 30,
    gradeMax: 0.12,
    crestR: 200,
    sagR: 150,
    filterW: 40,
    keys: [
      { x: rim273[0], z: rim273[1], h: 13 },
      { x: HEARTHWICK.x, z: HEARTHWICK.z, h: HEARTHWICK.y },
      { x: 420, z: 595, h: 22 },
      { x: 497, z: 445, h: 20 },
      { x: 470, z: 300, h: 17.5 },
      { x: rim334[0], z: rim334[1], h: 22 },
    ],
    flats: [
      { a: [470, 348], b: [470, 252] }, // Glassmere Ford (just above the bed)
    ],
  },
  {
    id: 'castle-ramp',
    name: 'Cobblekeep Ramp',
    kind: 'lane',
    surface: 'cobble',
    width: 8,
    path: { fillet: castleSpiral() },
    priority: 10,
    minR: 28,
    gradeMax: 0.1,
    crestR: 150,
    sagR: 120,
    filterW: 30,
    keys: [{ x: CASTLE_GATE[0], z: CASTLE_GATE[1], h: COBBLE_HILL.top }],
    guard: 0,
  },
  {
    id: 'dustline',
    name: 'Dustline',
    kind: 'rail',
    surface: 'dirt',
    width: 6,
    path: {
      fillet: [
        [410, -588],
        [300, -642, 150],
        [185, -668],
      ],
    },
    priority: 11,
    minR: 150,
    gradeMax: 0.04,
    crestR: 0,
    sagR: 0,
    filterW: 60,
    keys: [
      { x: 410, z: -588, h: 27 },
      { x: 185, z: -668, h: 20 },
    ],
  },
];

/** Cobblekeep ramp: from the lanes, a 1.25-turn spiral up Cobble Hill to the gatehouse. Fillet vertices. */
function castleSpiral(): FilletPt[] {
  const cx = COBBLE_HILL.x;
  const cz = COBBLE_HILL.z;
  // from Hearthwick square heading NNW, 1.25 turns counter-clockwise (west, north past Glassmere,
  // east, south) up to the gate
  const pts: FilletPt[] = [[218, 603]];
  const a0 = (CASTLE_A0 * Math.PI) / 180;
  const turns = 1.25;
  const steps = Math.round(turns * 12);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const r = 150 - 100 * f;
    const a = a0 + f * turns * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, i === steps ? undefined : 70]);
  }
  return pts;
}

// ── Landmarks ───────────────────────────────────────────────────────────────────────────────
export const LANDMARK_DEFS = [
  { id: 'volt-docks', name: 'Volt Docks', x: -640, z: 360, glyph: 'dock' },
  { id: 'prism-spire', name: 'Prism Spire', x: -580, z: -160, glyph: 'spire' },
  { id: 'spire-plaza', name: 'Spire Plaza', x: -620, z: -255, glyph: 'town' },
  { id: 'lantern-point', name: 'Lantern Point', x: LANTERN_POINT.x, z: LANTERN_POINT.z, glyph: 'light' },
  { id: 'kiteflat', name: 'Kiteflat Airstrip', x: -300, z: -519, glyph: 'strip' },
  { id: 'tin-spur', name: 'Tin Spur', x: 380, z: -575, glyph: 'town' },
  { id: 'saltglass', name: 'Saltglass Flats', x: SALTGLASS.x, z: SALTGLASS.z, glyph: 'flats' },
  { id: 'cinnabar-arch', name: 'Cinnabar Arch', x: 112, z: -560, glyph: 'arch' },
  { id: 'hearthwick', name: 'Hearthwick', x: HEARTHWICK.x, z: HEARTHWICK.z, glyph: 'mill' },
  { id: 'cobblekeep', name: 'Cobblekeep', x: COBBLE_HILL.x, z: COBBLE_HILL.z, glyph: 'castle' },
  { id: 'glassmere', name: 'Glassmere', x: GLASSMERE.x, z: GLASSMERE.z, glyph: 'lake' },
  { id: 'crown-saddle', name: 'Crown Saddle', x: SADDLE.x, z: SADDLE.z, glyph: 'pass' },
  { id: 'crownpeak', name: 'Crownpeak Observatory', x: PLAZA.x, z: PLAZA.z, glyph: 'peak' },
] as const;

// ── Regions (θ sectors; The Crown = within 420 m of the peak) ───────────────────────────────
export const CROWN_REGION_R = 420;
export const REGION_SECTORS: readonly [number, number, string][] = [
  [150, 210, 'prism-city'],
  [92, 150, 'kite-bay'],
  [30, 92, 'cinnabar-reach'],
  [-28, 30, 'shell-cove'],
  [268, 332, 'patchwork-downs'],
  [210, 268, 'lantern-bay'],
];

// ── Races ───────────────────────────────────────────────────────────────────────────────────
export interface RaceLeg {
  road: string;
  /** Anchor where the leg starts and ends (projected onto the road). */
  from: P2;
  to: P2;
  /** Direction along a closed road: +1 = increasing station, -1 = decreasing. Open roads infer it. */
  dir?: 1 | -1;
  /** Full laps of a closed road (from === to). */
  lap?: boolean;
}

export interface RaceDef {
  id: string;
  name: string;
  accent: string;
  legs: RaceLeg[];
  /** Spawn: distance before the start anchor along the route (m) — 0 = at the route start. */
  spawnBack: number;
  /** Checkpoint anchors (snapped to the route, ±40 m). */
  checkpoints: P2[];
  /** Finish anchor (snapped); omitted = route end. */
  finish?: P2;
  /** Per checkpoint: snap to the exit of the pad the anchor lies on. */
  padExits?: boolean[];
}

const rimT = (t: number): P2 => rimAt(t);

export const RACE_DEFS: readonly RaceDef[] = [
  {
    id: 'tessera-rim',
    name: 'Rimway Loop',
    accent: '#ffd23f',
    legs: [{ road: 'rimway', from: rimT(180), to: rimT(180), dir: -1, lap: true }],
    spawnBack: 30,
    checkpoints: [rimT(128), rimT(98), rimT(62), rimT(33), rimT(357), rimT(322), rimT(290), rimT(245), rimT(205)],
  },
  {
    id: 'tessera-crown',
    name: 'Crown Climb',
    accent: '#b8f25c',
    legs: [
      { road: 'st40', from: [-392, 40], to: [-380, 40] },
      { road: 'crownway', from: [-380, 40], to: [SADDLE.x, SADDLE.z] },
      { road: 'summit', from: [SADDLE.x, SADDLE.z], to: [30, 10] },
    ],
    spawnBack: 0,
    checkpoints: [CROWNWAY_PAD_CENTRE, [SADDLE.x, SADDLE.z], SUMMIT_PADS[1]!, SUMMIT_PADS[2]!],
    padExits: [true, true, true, true],
  },
  {
    id: 'tessera-neon',
    name: 'Neon Sprint',
    accent: '#5c7cff',
    legs: [
      { road: 'av-620', from: [-620, 335], to: [-620, 120] },
      { road: 'st120', from: [-620, 120], to: [-700, 120] },
      { road: 'av-700', from: [-700, 120], to: [-700, -40] },
      { road: 'st-40', from: [-700, -40], to: [-460, -40] },
      { road: 'av-460', from: [-460, -40], to: [-460, -200] },
      { road: 'st-200', from: [-460, -200], to: [-620, -200] },
      { road: 'av-620', from: [-620, -200], to: [-620, -255] },
    ],
    spawnBack: 0,
    checkpoints: [[-620, 160], [-700, 80], [-580, -40], [-460, -80], [-580, -200]],
    finish: [-620, -255],
  },
  {
    id: 'tessera-rally',
    name: 'Cinnabar Rally',
    accent: '#ff6a3d',
    legs: [{ road: 'cinnabar-loop', from: [345, -580], to: [345, -580], dir: 1, lap: true }],
    spawnBack: 0,
    checkpoints: [[120, -640], [112, -560], [260, -205], [396, -470]],
  },
];

export const ROAM_ID = 'tessera';
export const ROAM_NAME = 'Tessera Isle';
export const ROAM_ACCENT = '#7bd389';
/** Free-roam spawn: Volt Docks plaza facing north up Avenue 620. */
export const SPAWN = { x: -620, z: 335, yaw: Math.PI };

// ── Travel spots ────────────────────────────────────────────────────────────────────────────
export const SPOT_DEFS: readonly { id: string; label: string; road: string; at: P2; heading: P2 | 'race-start' }[] = [
  { id: 'volt-docks', label: 'Volt Docks', road: 'av-620', at: [SPAWN.x, SPAWN.z], heading: [-620, 200] },
  { id: 'rim-start', label: 'Rimway Loop start', road: 'rimway', at: [0, 0], heading: 'race-start' },
  { id: 'crown-start', label: 'Crown Climb start', road: 'st40', at: [0, 0], heading: 'race-start' },
  { id: 'rally-start', label: 'Cinnabar Rally start', road: 'cinnabar-loop', at: [0, 0], heading: 'race-start' },
  { id: 'kiteflat', label: 'Kiteflat', road: '', at: [0, 0], heading: [0, 0] },
  { id: 'glassmere', label: 'Glassmere shore', road: 'rimway', at: [0, 0], heading: [0, 0] },
  { id: 'hearthwick', label: 'Hearthwick', road: 'lanes', at: [HEARTHWICK.x, HEARTHWICK.z], heading: [300, 605] },
  { id: 'crownpeak', label: 'Crownpeak', road: '', at: [PLAZA.x, PLAZA.z], heading: [0, 0] },
  { id: 'saltglass', label: 'Saltglass Flats', road: 'rimway', at: [0, 0], heading: [0, 0] },
];

// ── Stunt ramps (table-tops) ────────────────────────────────────────────────────────────────
export interface RampDef {
  id: string;
  name: string;
  /** Kicker start point and yaw (local +Z = travel direction). */
  at: P2;
  yaw: number;
  kickerH: number;
  kickerDeg: number;
  tableLen: number;
  landingDeg: number;
  width: number;
}

export const RAMP_DEFS: readonly RampDef[] = [
  { id: 'kite-hop', name: 'KITE HOP', at: runwayPoint(140 - 9, 0), yaw: RUNWAY.yaw, kickerH: 1.5, kickerDeg: 10, tableLen: 18, landingDeg: 9, width: 10 },
  { id: 'kite-leap', name: 'KITE LEAP', at: runwayPoint(270 - 14, 0), yaw: RUNWAY.yaw, kickerH: 3, kickerDeg: 13, tableLen: 30, landingDeg: 10, width: 10 },
  { id: 'kite-launcher', name: 'KITE LAUNCHER', at: runwayPoint(400 - 19, 0), yaw: RUNWAY.yaw, kickerH: 5, kickerDeg: 16, tableLen: 40, landingDeg: 11, width: 10 },
  { id: 'pier-launch', name: 'PIER LAUNCH', at: [-600, 452], yaw: 0, kickerH: 1.5, kickerDeg: 12, tableLen: 0, landingDeg: 0, width: 10 },
  { id: 'hay-hop-1', name: 'HAY HOPS', at: [262, 668], yaw: Math.PI / 2, kickerH: 1, kickerDeg: 9, tableLen: 0, landingDeg: 0, width: 8 },
  { id: 'hay-hop-2', name: 'HAY HOPS', at: [282, 668], yaw: Math.PI / 2, kickerH: 1, kickerDeg: 9, tableLen: 0, landingDeg: 0, width: 8 },
  { id: 'hay-hop-3', name: 'HAY HOPS', at: [302, 668], yaw: Math.PI / 2, kickerH: 1, kickerDeg: 9, tableLen: 0, landingDeg: 0, width: 8 },
];

// ── Region palette (tile colours, sRGB hex) ─────────────────────────────────────────────────
export const PALETTE = {
  sea: '#1e5b8a',
  shallow: '#3aa6b5',
  sand: '#e8cf94',
  grassCity: '#7aa86a',
  grassBay: '#86b85c',
  grassDowns: '#79b34f',
  grassCrown: '#5f9348',
  cinnabar: '#c8623c',
  cinnabarDust: '#d98a52',
  rock: '#8a7f78',
  chalk: '#e6e1d3',
  snow: '#f4f6fb',
  salt: '#f1ede4',
  dirt: '#a5764a',
  asphalt: '#3b3d45',
  cobble: '#9c9184',
  lakeBed: '#6c8f7a',
};
