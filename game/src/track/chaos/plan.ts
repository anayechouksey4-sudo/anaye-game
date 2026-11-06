/**
 * Procedural generator for every map over the void. Pure data: no three.js, no React, no
 * Rapier — `generateTrack(recipe, seed)` returns the same plan for the same recipe + seed, every
 * time. `generateChaosTrack(seed)` is the GamerFleet Chaos Track's recipe (maps/chaos.ts).
 *
 * A course runs along +Z (yaw 0) over a bottomless void. The recipe's `compose` lays out the
 * sections with the builder below (start, straights, staircase chicanes, checkpoint lead-ins,
 * hazards, islands, the big jump, a finish straight); the seed decides what the recipe leaves to
 * chance (chaos: the hazard order, lengths, chicanes, tile grid, pendulum/shutter counts, phases).
 * The builder reads every dimension from the recipe, so the chaos recipe (config.ts constants)
 * reproduces the hand-validated seed-1337 layout exactly.
 */
import { buildRamp, type RampSegmentSpec } from '../common/ramp';
import { CHAOS_RECIPE } from '../maps/chaos';
import type { TrackCheckpoint, TrackLayout, Vec3 } from '../types';
import { CHECKPOINT_INSET, DECK, DEFAULT_CHAOS_SEED, GATE_DEPTH, GATE_HEIGHT, KILL_DEPTH } from './config';
import { HAZARD_LABEL, type BigJumpTuning, type DecorTuning, type TrackPalette, type TrackRecipe } from './recipe';
import { int, mulberry32, pick, range, stepped, type Rng } from './rng';

// ── Plan types ───────────────────────────────────────────────────────────────────────────────

export type HazardKind = 'gap' | 'tiles' | 'pendulums' | 'sliders';
export type SegmentKind = 'start' | 'straight' | 'chicane' | 'leadIn' | 'island' | 'finish' | HazardKind | 'bigJump';
export type DeckStyle = 'start' | 'deck' | 'stripes' | 'hazard' | 'ramp' | 'landing' | 'finish';
export type GlowColor = 'cyan' | 'magenta' | 'yellow' | 'green' | 'orange';

/** A static slab of driving surface (collider + voxel visuals). */
export interface DeckBox {
  center: Vec3;
  /** [width across, thickness, length along the box's local Z], m. */
  size: Vec3;
  /** Rotation about +X, rad (three.js sign: negative climbs toward +Z). */
  pitch: number;
  style: DeckStyle;
  edge: GlowColor;
  /** Hanging support pylons underneath (purely visual). */
  pylons: boolean;
}

/** Visual-only voxel box (structures, fills, kerbs, gantries). */
export interface TrimBox {
  center: Vec3;
  size: Vec3;
  /** Euler XYZ rotation, rad. */
  rotation?: Vec3;
  color: string;
  /** Emissive strength (0 = matte). */
  glow?: number;
}

/** Extra static colliders that are not driving surface (knoll face, end wall). */
export interface SolidBox {
  center: Vec3;
  size: Vec3;
}

export interface SegmentBase {
  id: string;
  index: number;
  kind: SegmentKind;
  label: string;
  startZ: number;
  endZ: number;
  /** Centreline lateral position at the start / end. */
  x0: number;
  x1: number;
  /** Driving-surface height at the start. */
  y: number;
  /** Checkpoint a respawn would use while on this segment (hazards reset when respawning at ≤ this). */
  checkpoint: number;
}

export interface SimpleSegment extends SegmentBase {
  kind: 'start' | 'straight' | 'leadIn' | 'island' | 'finish';
}

export interface ChicaneSegment extends SegmentBase {
  kind: 'chicane';
  shift: number;
}

export interface GapSegment extends SegmentBase {
  kind: 'gap';
  lip: Vec3;
  lipAngleDeg: number;
  gapM: number;
  landingZ: number;
  /** Landing deck below the take-off deck, m (0 on the chaos track). */
  dropM?: number;
}

export interface TileSpec {
  index: number;
  col: number;
  row: number;
  /** Body centre (the top surface is flush with the decks). */
  center: Vec3;
}

export interface TilesSegment extends SegmentBase {
  kind: 'tiles';
  cols: number;
  rows: number;
  size: number;
  thickness: number;
  fieldStartZ: number;
  fieldEndZ: number;
  tiles: TileSpec[];
}

export interface PendulumSpec {
  id: string;
  /** World pivot (hinge) point. */
  pivot: Vec3;
  armLength: number;
  bobSize: readonly [number, number, number];
  mass: number;
  /** Swing amplitude, rad. */
  amplitude: number;
  /** Swing angular frequency, rad/s (compound pendulum incl. the large-amplitude correction). */
  omega: number;
  /** θ(t) = amplitude · sin(omega · t + phase), with t the hazard clock. */
  phase: number;
}

export interface PendulumSegment extends SegmentBase {
  kind: 'pendulums';
  pendulums: PendulumSpec[];
}

export interface ShutterSpec {
  id: string;
  /** Centre of the closed doorway (centreline, deck top). */
  position: Vec3;
  period: number;
  /** Cycle offset, 0…1. */
  phase: number;
  /** Half the deck width the shutter has to close. */
  halfSpan: number;
  wallLength: number;
  height: number;
  thickness: number;
}

export interface SliderSegment extends SegmentBase {
  kind: 'sliders';
  shutters: ShutterSpec[];
}

export interface BigJumpSegment extends SegmentBase {
  kind: 'bigJump';
  checkpointZ: number;
  laneShift: { startZ: number; endZ: number; fromX: number; toX: number };
  kickerToeZ: number;
  lip: Vec3;
  lipHeight: number;
  takeoffDeg: number;
  gapM: number;
  knoll: Vec3;
  landingEnd: Vec3;
  finishZ: number;
}

export type ChaosSegment = SimpleSegment | ChicaneSegment | GapSegment | TilesSegment | PendulumSegment | SliderSegment | BigJumpSegment;

export interface GateSpec {
  /** Checkpoint index, or 'start' / 'finish'. */
  kind: 'start' | 'checkpoint' | 'finish';
  index: number;
  position: Vec3;
  width: number;
  height: number;
  label: string;
  color: GlowColor;
}

export interface SignSpec {
  id: string;
  lines: string[];
  position: Vec3;
  yaw: number;
  width: number;
  height: number;
  color: GlowColor;
  /** Live content drawn on top of the static text. */
  live?: 'speedTrap';
}

export interface DebrisSpec {
  position: Vec3;
  size: number;
  rotation: Vec3;
  color: string;
  glow: number;
  bob: number;
  speed: number;
  phase: number;
  /** Per-axis stretch of `size` (clouds, shards, towers); omitted = a cube. */
  scale?: Vec3;
  /** Tumble rate multiplier (0 = no tumble, e.g. clouds); omitted = 1. */
  spin?: number;
}

export interface BillboardSpec {
  position: Vec3;
  yaw: number;
  width: number;
  height: number;
}

export interface ChaosTrackPlan {
  seed: number;
  id: string;
  name: string;
  segments: ChaosSegment[];
  decks: DeckBox[];
  trims: TrimBox[];
  solids: SolidBox[];
  gates: GateSpec[];
  signs: SignSpec[];
  debris: DebrisSpec[];
  billboards: BillboardSpec[];
  /** Polyline [z, x] of the ideal line (chicanes sampled smoothly), for autopilots and decor. */
  centerline: [number, number][];
  layout: TrackLayout;
  lengthM: number;
  /** Map id of the recipe that generated this plan (equals `id` for the validated seed). */
  recipeId: string;
  palette: TrackPalette;
  decor: DecorTuning;
}

/** Every generated map shares the plan shape. */
export type TrackPlan = ChaosTrackPlan;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const snapTile = (v: number) => Math.round(v / DECK.tile) * DECK.tile;
/** Lateral S-curve profile 0 → 1 (half cosine: peak curvature π²/2 vs 6 for smoothstep). */
const sCurve = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return (1 - Math.cos(Math.PI * x)) / 2;
};

/** ω of a box bob on a massless arm swinging about the hinge axis, with the large-amplitude correction. */
export function pendulumOmega(armLength: number, bobSize: readonly [number, number, number], amplitude: number, gravity = 9.81): number {
  const [a, b] = bobSize;
  const inertiaCm = (a * a + b * b) / 12; // per unit mass, about the hinge axis (along the track)
  const omega0 = Math.sqrt((gravity * armLength) / (inertiaCm + armLength * armLength));
  const A2 = amplitude * amplitude;
  return omega0 / (1 + A2 / 16 + (11 * A2 * A2) / 3072);
}

// ── Builder ──────────────────────────────────────────────────────────────────────────────────

/** Where every course starts (the start deck runs START_Z → START_Z + 64 with the spawn at z 0). */
export const COURSE_START_Z = -24;

/** Options a recipe may pass to the gap section (the chaos track lets the seed pick). */
export interface GapOptions {
  gapM?: number;
  lipAngleDeg?: number;
  /** Landing deck this far below the take-off deck, m (floating islands). */
  dropM?: number;
  landingLength?: number;
  label?: string;
}

export interface FinishOptions {
  width?: number;
  label?: string;
}

/**
 * Lays a course out section by section along +Z. Every dimension comes from the recipe (the
 * chaos recipe = config.ts), so the arithmetic for the chaos track is exactly the original's.
 */
export class PlanBuilder {
  z: number;
  x = 0;
  y = 0;
  readonly segments: ChaosSegment[] = [];
  readonly decks: DeckBox[] = [];
  readonly trims: TrimBox[] = [];
  readonly solids: SolidBox[] = [];
  readonly gates: GateSpec[] = [];
  readonly signs: SignSpec[] = [];
  readonly checkpoints: TrackCheckpoint[] = [];
  readonly centerline: [number, number][] = [];
  private checkpointCount = 0;
  readonly rng: Rng;
  readonly recipe: TrackRecipe;
  /** Hanging support pylons under flat decks (off for floating-island maps). */
  pylons = true;

  constructor(recipe: TrackRecipe, rng: Rng, startZ: number) {
    this.recipe = recipe;
    this.rng = rng;
    this.z = startZ;
    this.centerline.push([startZ, 0]);
  }

  /** Standard deck width of this map. */
  get width(): number {
    return this.recipe.width;
  }

  get currentCheckpoint(): number {
    return Math.max(0, this.checkpointCount - 1);
  }

  /** The map's colour for a named glow. */
  glow(color: GlowColor): string {
    return this.recipe.palette.glow[color];
  }

  private base(kind: SegmentKind, label: string, length: number, x1 = this.x): SegmentBase {
    const seg: SegmentBase = {
      id: `s${this.segments.length}-${kind}`,
      index: this.segments.length,
      kind,
      label,
      startZ: r3(this.z),
      endZ: r3(this.z + length),
      x0: r3(this.x),
      x1: r3(x1),
      y: r3(this.y),
      checkpoint: this.currentCheckpoint,
    };
    return seg;
  }

  private advance(length: number, x1 = this.x): void {
    this.z += length;
    this.x = x1;
    this.centerline.push([r3(this.z), r3(this.x)]);
  }

  flatDeck(z0: number, z1: number, x: number, width: number, style: DeckStyle, edge: GlowColor, y = this.y, pylons = this.pylons): void {
    if (z1 - z0 <= 1e-6) return;
    this.decks.push({
      center: [r3(x), r3(y - DECK.thickness / 2), r3((z0 + z1) / 2)],
      size: [width, DECK.thickness, r3(z1 - z0)],
      pitch: 0,
      style,
      edge,
      pylons,
    });
  }

  /** Ramp plates (local profile climbing toward +Z) placed at (x, y0, z0); returns the lip point. */
  ramp(z0: number, x: number, y0: number, profile: readonly RampSegmentSpec[], width: number, thickness: number, style: DeckStyle, edge: GlowColor, fill: boolean): { lip: Vec3; takeoff: number } {
    const build = buildRamp(z0, profile, thickness, y0);
    for (const seg of build.segments) {
      this.decks.push({
        center: [r3(x), r3(seg.center[1]), r3(seg.center[2])],
        size: [width, thickness, seg.length],
        pitch: seg.rotationX,
        style,
        edge,
        pylons: false,
      });
    }
    if (fill) {
      // Voxel mass under the plates: one column per plate down to the base.
      let zPrev = z0;
      let yPrev = y0;
      for (const seg of build.segments) {
        const angle = -seg.rotationX;
        const zEnd = zPrev + seg.length * Math.cos(angle);
        const yEnd = yPrev + seg.length * Math.sin(angle);
        const top = Math.min(yPrev, yEnd) - thickness * Math.cos(angle);
        const bottom = Math.min(y0, build.lip[1]) - DECK.thickness;
        if (top - bottom > 0.05) {
          // Solid (collider + visual) so a car sliding off a ramp edge can't clip through the support.
          this.solids.push({
            center: [r3(x), r3((top + bottom) / 2), r3((zPrev + zEnd) / 2)],
            size: [width - 0.6, r3(top - bottom), r3(zEnd - zPrev + 0.02)],
          });
        }
        zPrev = zEnd;
        yPrev = yEnd;
      }
    }
    return { lip: [r3(x), r3(build.lip[1]), r3(build.lip[2])], takeoff: build.takeoffAngle };
  }

  /** Yellow/black voxel kerb across the deck at z (visual). */
  kerbAcross(z: number, x: number, width: number, y = this.y, depth = 1): void {
    const n = Math.max(2, Math.round(width / 1));
    const w = width / n;
    for (let i = 0; i < n; i++) {
      this.trims.push({
        center: [r3(x - width / 2 + (i + 0.5) * w), r3(y + 0.02), r3(z)],
        size: [r3(w - 0.04), 0.06, depth],
        color: i % 2 === 0 ? '#F5E663' : '#0b0b0f',
        glow: i % 2 === 0 ? 0.35 : 0,
      });
    }
  }

  /** Yellow/black kerb lying on a ramp's last plate, ending at the lip (pitched with the plate). */
  lipKerb(lip: Vec3, takeoff: number, width: number, depth: number): void {
    const n = Math.max(2, Math.round(width));
    const w = width / n;
    const z = lip[2] - (depth / 2) * Math.cos(takeoff);
    const y = lip[1] - (depth / 2) * Math.sin(takeoff) + 0.03;
    for (let i = 0; i < n; i++) {
      this.trims.push({
        center: [r3(lip[0] - width / 2 + (i + 0.5) * w), r3(y), r3(z)],
        size: [r3(w - 0.04), 0.06, depth],
        rotation: [-takeoff, 0, 0],
        color: i % 2 === 0 ? '#F5E663' : '#0b0b0f',
        glow: i % 2 === 0 ? 0.35 : 0,
      });
    }
  }

  checkpoint(z: number, x: number, width: number, label: string, color: GlowColor = 'yellow'): number {
    const index = this.checkpointCount++;
    const position: Vec3 = [r3(x), r3(this.y), r3(z)];
    this.checkpoints.push({ index, position, yaw: 0, size: [width + 2, GATE_HEIGHT, GATE_DEPTH] });
    this.gates.push({ kind: index === 0 ? 'start' : 'checkpoint', index, position, width: width + 2, height: GATE_HEIGHT, label, color });
    return index;
  }

  /** A text panel beside the track (backing panel + posts are added by the scenery). */
  sign(sign: SignSpec): void {
    this.signs.push(sign);
  }

  // ── Segments ───────────────────────────────────────────────────────────────────────────────

  start(length: number, spawnZ: number): void {
    const seg = this.base('start', 'START GRID', length);
    this.flatDeck(this.z, this.z + length, this.x, this.width, 'start', 'cyan');
    // Start gate doubles as checkpoint 0 (the spawn).
    this.segments.push({ ...seg, kind: 'start', checkpoint: 0 });
    this.checkpoint(spawnZ, this.x, this.width, this.recipe.title, 'cyan');
    this.kerbAcross(spawnZ + 4, this.x, this.width);
    this.advance(length);
  }

  straight(length: number, width = this.width): void {
    const seg = this.base('straight', 'STRAIGHT', length);
    this.flatDeck(this.z, this.z + length, this.x, width, 'deck', 'cyan');
    this.segments.push({ ...seg, kind: 'straight' });
    this.advance(length);
  }

  /** A wide floating island: flat deck with a tapering voxel-rock underside (no pylons). */
  island(length: number, label: string, width = this.width): void {
    const seg = this.base('island', label, length);
    this.flatDeck(this.z, this.z + length, this.x, width, 'deck', 'cyan', this.y, false);
    this.islandRock(this.z, this.z + length, this.x, width, this.y);
    this.segments.push({ ...seg, kind: 'island' });
    this.advance(length);
  }

  /** Lateral S-bend built from axis-aligned voxel slices (a staircase in plan view, seamless to drive). */
  chicane(length: number, shift: number): void {
    const x0 = this.x;
    const x1 = x0 + shift;
    const seg = this.base('chicane', `CHICANE ${shift > 0 ? 'L' : 'R'}${Math.abs(shift)}`, length, x1);
    this.slices(this.z, this.z + length, x0, x1, this.width, 'deck', 'cyan');
    this.segments.push({ ...seg, kind: 'chicane', shift });
    // Centreline: sample the smooth curve for autopilots / decor.
    const n = Math.ceil(length / 4);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      this.centerline.push([r3(this.z + t * length), r3(x0 + shift * sCurve(t))]);
    }
    this.advance(length, x1);
  }

  private slices(z0: number, z1: number, x0: number, x1: number, width: number, style: DeckStyle, edge: GlowColor): void {
    const n = Math.max(1, Math.round((z1 - z0) / this.recipe.tunings.connector.sliceLength));
    const len = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const xc = x0 + (x1 - x0) * sCurve(t);
      this.flatDeck(z0 + i * len, z0 + (i + 1) * len, xc, width, style, edge, this.y, this.pylons && i % 3 === 0);
    }
  }

  /** Straight with a checkpoint near its start; the last 8 m are hazard stripes. */
  leadIn(length: number, label: string): number {
    const seg = this.base('leadIn', `CHECKPOINT → ${label}`, length);
    const cp = this.checkpoint(this.z + CHECKPOINT_INSET, this.x, this.width, label);
    const stripeLen = 8;
    this.flatDeck(this.z, this.z + length - stripeLen, this.x, this.width, 'deck', 'cyan');
    this.flatDeck(this.z + length - stripeLen, this.z + length, this.x, this.width, 'stripes', 'yellow');
    this.segments.push({ ...seg, kind: 'leadIn', checkpoint: cp });
    this.advance(length);
    return cp;
  }

  gap(opts: GapOptions = {}): void {
    const { rng } = this;
    const G = this.recipe.tunings.gap;
    const lipAngle = opts.lipAngleDeg ?? pick(rng, G.lipAnglesDeg);
    const gapM = opts.gapM ?? pick(rng, G.lengths);
    const profile: RampSegmentSpec[] = [...G.approachDeg, lipAngle].map((angleDeg) => ({ angleDeg, length: G.pieceLength }));
    const toe = this.z;
    const kick = this.ramp(toe, this.x, this.y, profile, G.width, G.thickness, 'ramp', 'magenta', true);
    const lipZ = kick.lip[2];
    // Base deck under the kicker ends exactly at the lip.
    this.flatDeck(toe, lipZ, this.x, this.width, 'hazard', 'magenta');
    this.lipKerb(kick.lip, kick.takeoff, G.width, 0.9);
    const drop = opts.dropM ?? 0;
    const landY = this.y - drop;
    const landingZ = lipZ + gapM;
    const end = landingZ + (opts.landingLength ?? G.landingLength);
    this.flatDeck(landingZ, end, this.x, this.width, 'landing', 'green', landY);
    this.kerbAcross(landingZ + 0.6, this.x, this.width, landY, 1.2);
    const length = end - this.z;
    const seg = this.base('gap', opts.label ?? `${HAZARD_LABEL.gap} ${gapM} m (lip ${lipAngle}°)`, length);
    this.segments.push({ ...seg, kind: 'gap', lip: kick.lip, lipAngleDeg: lipAngle, gapM, landingZ: r3(landingZ), ...(drop !== 0 ? { dropM: drop } : {}) });
    this.y = landY;
    this.advance(length);
  }

  tiles(opts: { cols?: number; rows?: number } = {}): void {
    const { rng } = this;
    const T = this.recipe.tunings.tiles;
    const cols = opts.cols ?? pick(rng, T.colsOptions);
    const rows = opts.rows ?? int(rng, T.rowsMin, T.rowsMax);
    const size = T.size;
    const fieldStart = this.z;
    const fieldEnd = fieldStart + rows * size;
    const tiles: TileSpec[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        tiles.push({
          index: tiles.length,
          col,
          row,
          center: [r3(this.x + (col - (cols - 1) / 2) * size), r3(this.y - T.thickness / 2), r3(fieldStart + (row + 0.5) * size)],
        });
      }
    }
    // Floating orange guide rails along the field (visual only: no walls over the void).
    const width = cols * size;
    for (const side of [-1, 1]) {
      this.trims.push({
        center: [r3(this.x + side * (width / 2 + 0.6)), r3(this.y - 0.2), r3((fieldStart + fieldEnd) / 2)],
        size: [0.25, 0.25, rows * size],
        color: this.glow('orange'),
        glow: 2.2,
      });
    }
    const exitEnd = fieldEnd + T.exitLength;
    this.flatDeck(fieldEnd, exitEnd, this.x, this.width, 'deck', 'cyan');
    this.kerbAcross(fieldEnd + 0.6, this.x, this.width, this.y, 1.2);
    const length = exitEnd - this.z;
    const seg = this.base('tiles', `${HAZARD_LABEL.tiles} ${cols}×${rows}`, length);
    this.segments.push({
      ...seg,
      kind: 'tiles',
      cols,
      rows,
      size,
      thickness: T.thickness,
      fieldStartZ: r3(fieldStart),
      fieldEndZ: r3(fieldEnd),
      tiles,
    });
    this.advance(length);
  }

  pendulums(opts: { count?: number } = {}): void {
    const { rng } = this;
    const P = this.recipe.tunings.pendulum;
    const count = opts.count ?? int(rng, P.countMin, P.countMax);
    const spacing = stepped(rng, P.spacingMin, P.spacingMax, 2);
    const length = snapTile(P.entryLength + (count - 1) * spacing + P.exitLength);
    const seg = this.base('pendulums', `${HAZARD_LABEL.pendulums} ×${count}`, length);
    this.flatDeck(this.z, this.z + length, this.x, P.width, 'hazard', 'magenta');
    const [, bobH] = P.bobSize;
    const pivotY = this.y + P.clearance + bobH / 2 + P.armLength;
    const basePhase = range(rng, 0, Math.PI * 2);
    const pendulums: PendulumSpec[] = [];
    for (let k = 0; k < count; k++) {
      const z = this.z + P.entryLength + k * spacing;
      const amplitude = range(rng, P.amplitudeDegMin, P.amplitudeDegMax) * DEG;
      const omega = pendulumOmega(P.armLength, P.bobSize, amplitude);
      // Green wave: a car holding designSpeed meets every pendulum at the same point of its swing.
      const phase = basePhase - (k * omega * spacing) / P.designSpeed + range(rng, -0.25, 0.25);
      pendulums.push({
        id: `${seg.id}-p${k}`,
        pivot: [r3(this.x), r3(pivotY), r3(z)],
        armLength: P.armLength,
        bobSize: P.bobSize,
        mass: P.bobMass,
        amplitude: r3(amplitude),
        omega,
        phase: ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
      });
      this.gantry(z, this.x, pivotY);
    }
    this.segments.push({ ...seg, kind: 'pendulums', pendulums });
    this.advance(length);
  }

  /** Portal gantry holding a pendulum hinge (visual; the hinge's fixed anchor body sits at the pivot). */
  private gantry(z: number, x: number, pivotY: number): void {
    const span = this.recipe.tunings.pendulum.gantryHalfSpan;
    const steel = this.recipe.palette.gantry;
    const glow = this.glow('magenta');
    for (const side of [-1, 1]) {
      const px = x + side * span;
      this.trims.push({ center: [r3(px), r3((pivotY + 1.2 - 70) / 2), r3(z)], size: [1.2, r3(pivotY + 1.2 + 70), 1.2], color: steel, glow: 0 });
      this.trims.push({ center: [r3(px), r3(pivotY - 2), r3(z)], size: [1.32, 0.3, 1.32], color: glow, glow: 2.5 });
    }
    this.trims.push({ center: [r3(x), r3(pivotY + 1.1), r3(z)], size: [span * 2 + 1.2, 1.0, 1.4], color: steel, glow: 0 });
    this.trims.push({ center: [r3(x), r3(pivotY + 0.55), r3(z)], size: [span * 2 + 1.2, 0.12, 1.45], color: glow, glow: 2.5 });
    // Hinge hub.
    this.trims.push({ center: [r3(x), r3(pivotY), r3(z)], size: [1.1, 1.1, 2.0], color: '#2b2b38', glow: 0 });
  }

  sliders(opts: { count?: number; period?: number } = {}): void {
    const { rng } = this;
    const S = this.recipe.tunings.sliders;
    const count = opts.count ?? int(rng, S.countMin, S.countMax);
    const spacing = stepped(rng, S.spacingMin, S.spacingMax, 2);
    const period = opts.period ?? Math.round(range(rng, S.periodMin, S.periodMax) * 100) / 100;
    const length = snapTile(S.entryLength + (count - 1) * spacing + S.exitLength);
    const seg = this.base('sliders', `${HAZARD_LABEL.sliders} ×${count}`, length);
    this.flatDeck(this.z, this.z + length, this.x, S.width, 'hazard', 'yellow');
    const basePhase = rng();
    const halfSpan = S.width / 2;
    const shutters: ShutterSpec[] = [];
    for (let k = 0; k < count; k++) {
      const z = this.z + S.entryLength + k * spacing;
      const phase = basePhase - (k * spacing) / (S.designSpeed * period);
      shutters.push({
        id: `${seg.id}-w${k}`,
        position: [r3(this.x), r3(this.y), r3(z)],
        period,
        phase: ((phase % 1) + 1) % 1,
        halfSpan,
        wallLength: halfSpan + 1.2,
        height: S.wallHeight,
        thickness: S.wallThickness,
      });
      // Guide channels on both deck edges (visual).
      for (const side of [-1, 1]) {
        this.trims.push({
          center: [r3(this.x + side * (halfSpan + 4.6)), r3(this.y - 0.3), r3(z)],
          size: [8.4, 0.6, S.wallThickness + 0.8],
          color: '#1a1a22',
          glow: 0,
        });
        this.trims.push({
          center: [r3(this.x + side * (halfSpan + 4.6)), r3(this.y + 0.02), r3(z)],
          size: [8.4, 0.05, 0.12],
          color: this.glow('yellow'),
          glow: 2,
        });
      }
    }
    this.segments.push({ ...seg, kind: 'sliders', shutters });
    this.advance(length);
  }

  bigJump(): void {
    const J: BigJumpTuning | undefined = this.recipe.bigJump;
    if (!J) throw new Error(`${this.recipe.id}: bigJump() needs recipe.bigJump`);
    const title = J.TITLE ?? 'THE MASSIVE JUMP';
    const cpZ = this.z + CHECKPOINT_INSET;
    const toeZ = cpZ + J.RUNUP_M;
    const shiftEnd = toeZ - J.LANE_SHIFT_END_BEFORE_KICKER_M;
    const shiftStart = shiftEnd - J.LANE_SHIFT_LENGTH_M;
    const fromX = this.x;
    const dir = this.x > 0.5 ? -1 : this.x < -0.5 ? 1 : this.rng() < 0.5 ? -1 : 1;
    const toX = fromX + dir * J.LANE_SHIFT_M;
    const kink = J.LANE_SHIFT_M !== 0;
    const startZ = this.z;

    const cp = this.checkpoint(cpZ, fromX, J.RUNUP_WIDTH, title, 'magenta');
    if (kink) {
      this.flatDeck(startZ, shiftStart, fromX, J.RUNUP_WIDTH, 'deck', 'cyan');
      this.slices(shiftStart, shiftEnd, fromX, toX, J.RUNUP_WIDTH, 'deck', 'yellow');
    } else {
      this.flatDeck(startZ, shiftEnd, fromX, J.RUNUP_WIDTH, 'deck', 'cyan');
    }
    const kick = this.ramp(toeZ, toX, this.y, J.KICKER_PROFILE, J.KICKER_WIDTH, J.KICKER_THICKNESS, 'ramp', 'magenta', true);
    const lipZ = kick.lip[2];
    // Base deck under the kicker ends exactly at the lip.
    this.flatDeck(shiftEnd, lipZ, toX, J.RUNUP_WIDTH, 'deck', 'magenta');
    this.lipKerb(kick.lip, kick.takeoff, J.KICKER_WIDTH, 1.0);
    // Speed-trap timing gantry at the lip: posts + a laser beam high above the take-off line.
    for (const side of [-1, 1]) {
      const px = toX + side * (J.KICKER_WIDTH / 2 + 0.9);
      this.trims.push({ center: [r3(px), r3(kick.lip[1] - 6), r3(lipZ)], size: [0.8, 18, 0.8], color: this.recipe.palette.post, glow: 0 });
      this.trims.push({ center: [r3(px), r3(kick.lip[1] + 3.2), r3(lipZ)], size: [1.0, 0.5, 1.0], color: this.glow('magenta'), glow: 3 });
    }
    this.trims.push({ center: [r3(toX), r3(kick.lip[1] + 3.2), r3(lipZ)], size: [J.KICKER_WIDTH + 1.8, 0.05, 0.05], color: this.glow('cyan'), glow: 4 });

    // Landing hill: knoll edge exactly GAP_M past the lip, eased down-slope, then the run-out.
    const knollZ = lipZ + J.GAP_M;
    const knollY = kick.lip[1] - J.LANDING_DROP_M;
    const land = this.ramp(knollZ, toX, knollY, J.LANDING_PROFILE, J.LANDING_WIDTH, 1.0, 'landing', 'green', true);
    const runoutY = land.lip[1];
    const landingEndZ = land.lip[2];
    // The knoll's front face: a short jump slams into it and drops into the void.
    this.solids.push({ center: [r3(toX), r3(knollY - 1 - 8), r3(knollZ + 1.5)], size: [J.LANDING_WIDTH, 16, 3] });
    for (let i = 0; i < 9; i++) {
      this.trims.push({
        center: [r3(toX), r3(knollY - 1.2 - i * 1.6), r3(knollZ - 0.12)],
        size: [J.LANDING_WIDTH, 0.8, 0.06],
        color: i % 2 === 0 ? '#F5E663' : '#0b0b0f',
        glow: i % 2 === 0 ? 0.6 : 0,
      });
    }
    this.kerbAcross(knollZ + 0.6, toX, J.LANDING_WIDTH, knollY + 0.01, 1.2);

    const runoutEnd = landingEndZ + J.RUNOUT_M;
    this.flatDeck(landingEndZ, runoutEnd, toX, J.LANDING_WIDTH, 'finish', 'green', runoutY);
    const finishZ = landingEndZ + J.FINISH_AT_M;
    // End wall so a hot finish doesn't sail into the void.
    this.solids.push({ center: [r3(toX), r3(runoutY + 3), r3(runoutEnd - 1.5)], size: [J.LANDING_WIDTH + 2, 6, 3] });
    this.trims.push({ center: [r3(toX), r3(runoutY + 6.05), r3(runoutEnd - 1.5)], size: [J.LANDING_WIDTH + 2.1, 0.2, 3.1], color: this.glow('green'), glow: 2.5 });

    const lipHeight = kick.lip[1] - this.y;
    const seg = this.base('bigJump', `${title} (run-up ${J.RUNUP_M} m, lip ${lipHeight.toFixed(1)} m @ ${(kick.takeoff / DEG).toFixed(1)}°, gap ${J.GAP_M} m)`, runoutEnd - startZ, toX);
    this.segments.push({
      ...seg,
      kind: 'bigJump',
      checkpoint: cp,
      checkpointZ: r3(cpZ),
      laneShift: { startZ: r3(shiftStart), endZ: r3(shiftEnd), fromX: r3(fromX), toX: r3(toX) },
      kickerToeZ: r3(toeZ),
      lip: kick.lip,
      lipHeight: r3(lipHeight),
      takeoffDeg: r3(kick.takeoff / DEG),
      gapM: J.GAP_M,
      knoll: [r3(toX), r3(knollY), r3(knollZ)],
      landingEnd: [r3(toX), r3(runoutY), r3(landingEndZ)],
      finishZ: r3(finishZ),
    });

    // Centreline through the kink and over the jump.
    const n = Math.ceil(J.LANE_SHIFT_LENGTH_M / 4);
    this.centerline.push([r3(shiftStart), r3(fromX)]);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      this.centerline.push([r3(shiftStart + t * J.LANE_SHIFT_LENGTH_M), r3(fromX + (toX - fromX) * sCurve(t))]);
    }
    this.centerline.push([r3(shiftEnd), r3(toX)]);

    // Signage: the lip sign with the live speed trap, and the aero-kink warning.
    this.signs.push({
      id: 'lip-sign',
      lines: [`NEED ${J.REQUIRED_KMH} KM/H`, 'NOSE DOWN · FULL SEND'],
      position: [r3(toX - dir * (J.KICKER_WIDTH / 2 + 9)), r3(kick.lip[1] + 6), r3(lipZ - 14)],
      yaw: Math.PI + dir * 0.35,
      width: 16,
      height: 8,
      color: 'magenta',
      live: 'speedTrap',
    });
    if (kink) {
      this.signs.push({
        id: 'kink-sign',
        lines: ['AERO KINK AHEAD', 'NO FRONT GRIP = NO STEERING'],
        position: [r3(fromX + dir * (J.RUNUP_WIDTH / 2 + 8)), r3(this.y + 7), r3(shiftStart - 70)],
        yaw: Math.PI - dir * 0.3,
        width: 14,
        height: 5,
        color: 'yellow',
      });
    }
    this.signs.push({
      id: 'runup-sign',
      lines: [title, J.RUNUP_HINT ?? `${J.RUNUP_M} M RUN-UP · TIER 5 ONLY`],
      position: [r3(fromX - dir * (J.RUNUP_WIDTH / 2 + 9)), r3(this.y + 8), r3(cpZ + 40)],
      yaw: Math.PI + dir * 0.3,
      width: 15,
      height: 5.5,
      color: 'cyan',
    });

    this.gates.push({ kind: 'finish', index: -1, position: [r3(toX), r3(runoutY), r3(finishZ)], width: J.LANDING_WIDTH + 2, height: GATE_HEIGHT, label: 'FINISH', color: 'green' });
    this.y = runoutY;
    this.advance(runoutEnd - startZ, toX);
  }

  /** Flat finish straight: the finish gate `finishAt` m in, an end wall at the far end. */
  finishStraight(length: number, finishAt: number, opts: FinishOptions = {}): void {
    const width = opts.width ?? this.width;
    const seg = this.base('finish', opts.label ?? 'FINISH STRAIGHT', length);
    this.flatDeck(this.z, this.z + length, this.x, width, 'finish', 'green');
    const finishZ = this.z + finishAt;
    const endZ = this.z + length;
    this.solids.push({ center: [r3(this.x), r3(this.y + 3), r3(endZ - 1.5)], size: [width + 2, 6, 3] });
    this.trims.push({ center: [r3(this.x), r3(this.y + 6.05), r3(endZ - 1.5)], size: [width + 2.1, 0.2, 3.1], color: this.glow('green'), glow: 2.5 });
    this.gates.push({ kind: 'finish', index: -1, position: [r3(this.x), r3(this.y), r3(finishZ)], width: width + 2, height: GATE_HEIGHT, label: 'FINISH', color: 'green' });
    this.segments.push({ ...seg, kind: 'finish' });
    this.advance(length);
  }

  /**
   * Floating-island underside (visual): stepped voxel rock tapering away below the deck, with a
   * few glowing crystals. Its own RNG stream, so it never shifts the gameplay layout.
   */
  islandRock(z0: number, z1: number, x: number, width: number, topY: number): void {
    const colors = this.recipe.palette.rock ?? ['#5b4632', '#4a3828', '#3a2c20', '#2b2119'];
    const rng = mulberry32((Math.round(z0 * 131 + x * 17) ^ 0x2545f491) >>> 0);
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    const layers = Math.max(3, Math.min(7, Math.round(Math.min(width * 1.6, len) / 9)));
    let y = topY - DECK.thickness + 0.2;
    for (let k = 0; k < layers; k++) {
      const f = 1 - (k + 0.6) / (layers + 0.6);
      const h = 2.2 + rng() * 1.8;
      const layerLen = Math.max(4, len * f);
      const nz = Math.max(1, Math.round(layerLen / 7));
      const color = colors[Math.min(colors.length - 1, Math.floor((k / layers) * colors.length))] ?? '#3a2c20';
      for (let i = 0; i < nz; i++) {
        const bl = layerLen / nz;
        const cz = zc - layerLen / 2 + (i + 0.5) * bl;
        const w = Math.max(2, width * f * (0.82 + rng() * 0.3));
        const cx = x + (rng() - 0.5) * width * 0.18 * (1 - f);
        this.trims.push({ center: [r3(cx), r3(y - h / 2), r3(cz)], size: [r3(w), r3(h), r3(bl * (0.92 + rng() * 0.16))], color, glow: 0 });
      }
      y -= h * 0.85;
    }
    // Hanging spurs and crystals.
    const spurs = Math.max(2, Math.round(len / 30));
    for (let i = 0; i < spurs; i++) {
      const sz = z0 + len * (0.15 + 0.7 * rng());
      const sx = x + (rng() - 0.5) * width * 0.5;
      const sh = 3 + rng() * 6;
      this.trims.push({ center: [r3(sx), r3(y - sh / 2 + 1), r3(sz)], size: [r3(1.2 + rng() * 1.5), r3(sh), r3(1.2 + rng() * 1.5)], color: colors[colors.length - 1] ?? '#2b2119', glow: 0 });
      this.trims.push({ center: [r3(sx), r3(y - sh + 0.6), r3(sz)], size: [0.7, 1.2, 0.7], color: this.glow(i % 2 === 0 ? 'cyan' : 'magenta'), glow: 2.6 });
    }
  }
}

// ── Generator ────────────────────────────────────────────────────────────────────────────────

/** Build the plan for `recipe` (default: its hand-validated seed). Pure and deterministic. */
export function generateTrack(recipe: TrackRecipe, seed: number = recipe.seed): ChaosTrackPlan {
  const rng = mulberry32(seed);
  const b = new PlanBuilder(recipe, rng, COURSE_START_Z);
  recipe.compose(b, rng);

  const lowestTop = Math.min(
    ...b.decks.map((d) => d.center[1] + d.size[1] / 2),
  );
  const finishGate = b.gates.find((g) => g.kind === 'finish');
  const jump = b.segments.find((s): s is BigJumpSegment => s.kind === 'bigJump');
  if (!finishGate) throw new Error(`${recipe.id}: generator produced no finish`);
  if (recipe.bigJump && !jump) throw new Error(`${recipe.id}: generator produced no big jump`);

  const validated = seed === recipe.seed;
  const id = validated ? recipe.id : `${recipe.id}-${seed}`;
  const startZ = b.segments[0]?.startZ ?? 0;
  const layout: TrackLayout = {
    id,
    name: validated ? recipe.name : `${recipe.name} #${seed}`,
    spawn: { position: b.checkpoints[0]!.position, yaw: 0 },
    checkpoints: b.checkpoints,
    finish: { position: finishGate.position, yaw: 0, size: [finishGate.width, GATE_HEIGHT, GATE_DEPTH] },
    killY: r3(lowestTop - KILL_DEPTH),
    ...(jump && recipe.bigJump
      ? { bigJump: { lipPosition: jump.lip, yaw: 0, requiredKmh: recipe.bigJump.REQUIRED_KMH, halfWidth: recipe.bigJump.KICKER_WIDTH / 2 + 2 } }
      : {}),
    lengthM: r3(finishGate.position[2] - (b.checkpoints[0]?.position[2] ?? 0)),
    ...(recipe.surfaceGrip !== undefined ? { surfaceGrip: recipe.surfaceGrip } : {}),
    ...(recipe.atmosphere ? { atmosphere: recipe.atmosphere } : {}),
  };

  const plan: ChaosTrackPlan = {
    seed,
    id,
    name: layout.name,
    segments: b.segments,
    decks: b.decks,
    trims: b.trims,
    solids: b.solids,
    gates: b.gates,
    signs: b.signs,
    debris: [],
    billboards: [],
    centerline: b.centerline,
    layout,
    lengthM: r3(b.z - startZ),
    recipeId: recipe.id,
    palette: recipe.palette,
    decor: recipe.decor,
  };
  decorate(plan, mulberry32(seed ^ 0x9e3779b9), recipe.decor);
  return plan;
}

/** The GamerFleet Chaos Track (`seed` defaults to the hand-validated 1337). */
export function generateChaosTrack(seed: number = DEFAULT_CHAOS_SEED): ChaosTrackPlan {
  return generateTrack(CHAOS_RECIPE, seed);
}

/** Atmosphere on its own RNG stream so decor tweaks never reshuffle the gameplay layout. */
function decorate(plan: ChaosTrackPlan, rng: Rng, decor: DecorTuning): void {
  const z0 = (plan.segments[0]?.startZ ?? 0) - 80;
  const z1 = (plan.segments[plan.segments.length - 1]?.endZ ?? 1000) + 80;
  const palette = decor.debrisColors;
  const glows = decor.debrisGlows;
  const style = decor.debrisStyle ?? 'voxels';
  for (let i = 0; i < decor.debrisCount; i++) {
    const z = range(rng, z0, z1);
    const side = rng() < 0.5 ? -1 : 1;
    const cx = centerXAt(plan, z);
    if (style === 'voxels') {
      const glowing = rng() < 0.18;
      plan.debris.push({
        position: [r3(cx + side * range(rng, 24, 150)), r3(range(rng, -70, 40)), r3(z)],
        size: r3(glowing ? range(rng, 0.6, 2) : range(rng, 1.2, 7)),
        rotation: [r3(range(rng, 0, Math.PI)), r3(range(rng, 0, Math.PI)), r3(range(rng, 0, Math.PI))],
        color: glowing ? pick(rng, glows) : pick(rng, palette),
        glow: glowing ? r3(range(rng, 1.5, 3)) : 0,
        bob: r3(range(rng, 0.4, 2.2)),
        speed: r3(range(rng, 0.15, 0.5)),
        phase: r3(range(rng, 0, Math.PI * 2)),
      });
    } else if (style === 'clouds') {
      // Flat cloud slabs drifting below and beside the islands (a few right under the course for depth).
      const under = rng() < 0.3;
      const size = range(rng, 10, 26);
      plan.debris.push({
        position: [r3(cx + (under ? range(rng, -30, 30) : side * range(rng, 30, 240))), r3(under ? range(rng, -75, -30) : range(rng, -60, 25)), r3(z)],
        size: r3(size),
        scale: [1, r3(range(rng, 0.18, 0.32)), r3(range(rng, 0.5, 1.1))],
        rotation: [0, r3(range(rng, 0, Math.PI)), 0],
        color: pick(rng, palette),
        // Lit from within a little so they read white against the sky whichever side the sun is on.
        glow: r3(range(rng, 0.45, 0.8)),
        bob: r3(range(rng, 0.3, 1.2)),
        speed: r3(range(rng, 0.05, 0.15)),
        phase: r3(range(rng, 0, Math.PI * 2)),
        spin: 0,
      });
    } else if (style === 'shards') {
      // Ice shards: tall, thin, slowly turning crystals; some glow.
      const glowing = rng() < 0.28;
      plan.debris.push({
        position: [r3(cx + side * range(rng, 26, 170)), r3(range(rng, -60, 30)), r3(z)],
        size: r3(range(rng, 1.4, 5.5)),
        scale: [r3(range(rng, 0.3, 0.5)), r3(range(rng, 1.8, 3.4)), r3(range(rng, 0.3, 0.5))],
        rotation: [r3(range(rng, -0.4, 0.4)), r3(range(rng, 0, Math.PI)), r3(range(rng, -0.4, 0.4))],
        color: glowing ? pick(rng, glows) : pick(rng, palette),
        glow: glowing ? r3(range(rng, 1.2, 2.4)) : 0,
        bob: r3(range(rng, 0.4, 1.6)),
        speed: r3(range(rng, 0.1, 0.3)),
        phase: r3(range(rng, 0, Math.PI * 2)),
        spin: 0.25,
      });
    } else {
      // A far voxel skyline: dark towers rising out of the void, some lit.
      const glowing = rng() < 0.32;
      const size = range(rng, 8, 18);
      const tall = range(rng, 3, 9);
      const baseY = range(rng, -150, -100);
      plan.debris.push({
        position: [r3(cx + side * range(rng, 70, 360)), r3(baseY + (size * tall) / 2), r3(z)],
        size: r3(size),
        scale: [1, r3(tall), r3(range(rng, 0.7, 1.3))],
        rotation: [0, r3(range(rng, 0, Math.PI / 2)), 0],
        color: glowing ? pick(rng, glows) : pick(rng, palette),
        glow: glowing ? r3(range(rng, 0.5, 1.2)) : 0,
        bob: 0,
        speed: 0,
        phase: 0,
        spin: 0,
      });
    }
  }
  let side = 1;
  for (let z = 60; z < z1 - 120; z += decor.billboardEvery + range(rng, -40, 40)) {
    plan.billboards.push({ position: [r3(centerXAt(plan, z) + side * 30), r3(range(rng, 9, 16)), r3(z)], yaw: Math.PI + side * 0.45, width: 22, height: 5.5 });
    side = -side;
  }
}

/** Ideal-line lateral position at z (linear between centreline samples). */
export function centerXAt(plan: Pick<ChaosTrackPlan, 'centerline'>, z: number): number {
  const pts = plan.centerline;
  if (pts.length === 0) return 0;
  const first = pts[0]!;
  if (z <= first[0]) return first[1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const p = pts[i]!;
    if (z <= p[0]) {
      const span = p[0] - a[0];
      return span > 1e-9 ? a[1] + ((p[1] - a[1]) * (z - a[0])) / span : p[1];
    }
  }
  return pts[pts.length - 1]![1];
}

/** Compact, JSON-friendly description (segment list for logs, determinism checks, the debug handle). */
export function describePlan(plan: ChaosTrackPlan) {
  return {
    seed: plan.seed,
    id: plan.id,
    lengthM: plan.lengthM,
    killY: plan.layout.killY,
    checkpoints: plan.layout.checkpoints.map((c) => c.position),
    finish: plan.layout.finish.position,
    bigJump: plan.layout.bigJump,
    segments: plan.segments.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      startZ: s.startZ,
      endZ: s.endZ,
      length: r3(s.endZ - s.startZ),
      x0: s.x0,
      x1: s.x1,
      checkpoint: s.checkpoint,
    })),
  };
}
