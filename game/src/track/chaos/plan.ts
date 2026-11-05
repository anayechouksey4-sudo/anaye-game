/**
 * Procedural generator for the GamerFleet Chaos Track. Pure data: no three.js, no React, no
 * Rapier — `generateChaosTrack(seed)` returns the same plan for the same seed, every time.
 *
 * The course runs along +Z (yaw 0) over a bottomless void. Its macro structure is fixed so every
 * seed is a complete track — start → four hazards (seeded order, each behind its own checkpoint,
 * joined by straights / staircase chicanes) → the massive-jump run-up → jump → finish — while the
 * seed decides the order, lengths, chicanes, tile grid, pendulum/shutter counts, phases and decor.
 */
import { buildRamp, type RampSegmentSpec } from '../common/ramp';
import type { TrackCheckpoint, TrackLayout, Vec3 } from '../types';
import {
  BIG_JUMP,
  CHAOS_TRACK_ID,
  CHECKPOINT_INSET,
  CONNECTOR,
  DECK,
  DECOR,
  DEFAULT_CHAOS_SEED,
  GAP,
  GATE_DEPTH,
  GATE_HEIGHT,
  KILL_DEPTH,
  LEAD_IN,
  PENDULUM,
  SLIDERS,
  TILES,
} from './config';
import { int, mulberry32, pick, range, shuffle, stepped, type Rng } from './rng';

// ── Plan types ───────────────────────────────────────────────────────────────────────────────

export type HazardKind = 'gap' | 'tiles' | 'pendulums' | 'sliders';
export type SegmentKind = 'start' | 'straight' | 'chicane' | 'leadIn' | HazardKind | 'bigJump' | 'finish';
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
  kind: 'start' | 'straight' | 'leadIn' | 'finish';
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
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const snapTile = (v: number) => Math.round(v / DECK.tile) * DECK.tile;
const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** ω of a box bob on a massless arm swinging about the hinge axis, with the large-amplitude correction. */
export function pendulumOmega(armLength: number, bobSize: readonly [number, number, number], amplitude: number, gravity = 9.81): number {
  const [a, b] = bobSize;
  const inertiaCm = (a * a + b * b) / 12; // per unit mass, about the hinge axis (along the track)
  const omega0 = Math.sqrt((gravity * armLength) / (inertiaCm + armLength * armLength));
  const A2 = amplitude * amplitude;
  return omega0 / (1 + A2 / 16 + (11 * A2 * A2) / 3072);
}

const HAZARD_LABEL: Record<HazardKind, string> = {
  gap: 'SKY GAP',
  tiles: 'COLLAPSE ZONE',
  pendulums: 'PENDULUM ALLEY',
  sliders: 'SHUTTER GATES',
};

// ── Builder ──────────────────────────────────────────────────────────────────────────────────

class PlanBuilder {
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

  constructor(rng: Rng, startZ: number) {
    this.rng = rng;
    this.z = startZ;
    this.centerline.push([startZ, 0]);
  }

  get currentCheckpoint(): number {
    return Math.max(0, this.checkpointCount - 1);
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

  flatDeck(z0: number, z1: number, x: number, width: number, style: DeckStyle, edge: GlowColor, y = this.y, pylons = true): void {
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
      // Solid-looking voxel mass under the plates (visual only): one column per plate down to the base.
      let zPrev = z0;
      let yPrev = y0;
      for (const seg of build.segments) {
        const angle = -seg.rotationX;
        const zEnd = zPrev + seg.length * Math.cos(angle);
        const yEnd = yPrev + seg.length * Math.sin(angle);
        const top = Math.min(yPrev, yEnd) - thickness * Math.cos(angle);
        const bottom = Math.min(y0, build.lip[1]) - DECK.thickness;
        if (top - bottom > 0.05) {
          this.trims.push({
            center: [r3(x), r3((top + bottom) / 2), r3((zPrev + zEnd) / 2)],
            size: [width - 0.6, r3(top - bottom), r3(zEnd - zPrev + 0.02)],
            color: '#120c1c',
            glow: 0,
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

  checkpoint(z: number, x: number, width: number, label: string, color: GlowColor = 'yellow'): number {
    const index = this.checkpointCount++;
    const position: Vec3 = [r3(x), r3(this.y), r3(z)];
    this.checkpoints.push({ index, position, yaw: 0, size: [width + 2, GATE_HEIGHT, GATE_DEPTH] });
    this.gates.push({ kind: index === 0 ? 'start' : 'checkpoint', index, position, width: width + 2, height: GATE_HEIGHT, label, color });
    return index;
  }

  // ── Segments ───────────────────────────────────────────────────────────────────────────────

  start(length: number, spawnZ: number): void {
    const seg = this.base('start', 'START GRID', length);
    this.flatDeck(this.z, this.z + length, this.x, DECK.width, 'start', 'cyan');
    // Start gate doubles as checkpoint 0 (the spawn).
    this.segments.push({ ...seg, kind: 'start', checkpoint: 0 });
    this.checkpoint(spawnZ, this.x, DECK.width, 'GAMERFLEET CHAOS TRACK', 'cyan');
    this.kerbAcross(spawnZ + 4, this.x, DECK.width);
    this.advance(length);
  }

  straight(length: number): void {
    const seg = this.base('straight', 'STRAIGHT', length);
    this.flatDeck(this.z, this.z + length, this.x, DECK.width, 'deck', 'cyan');
    this.segments.push({ ...seg, kind: 'straight' });
    this.advance(length);
  }

  /** Lateral S-bend built from axis-aligned voxel slices (a staircase in plan view, seamless to drive). */
  chicane(length: number, shift: number): void {
    const x0 = this.x;
    const x1 = x0 + shift;
    const seg = this.base('chicane', `CHICANE ${shift > 0 ? 'L' : 'R'}${Math.abs(shift)}`, length, x1);
    this.slices(this.z, this.z + length, x0, x1, DECK.width, 'deck', 'cyan');
    this.segments.push({ ...seg, kind: 'chicane', shift });
    // Centreline: sample the smooth curve for autopilots / decor.
    const n = Math.ceil(length / 4);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      this.centerline.push([r3(this.z + t * length), r3(x0 + shift * smoothstep(t))]);
    }
    this.advance(length, x1);
  }

  private slices(z0: number, z1: number, x0: number, x1: number, width: number, style: DeckStyle, edge: GlowColor): void {
    const n = Math.max(1, Math.round((z1 - z0) / CONNECTOR.sliceLength));
    const len = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const xc = x0 + (x1 - x0) * smoothstep(t);
      this.flatDeck(z0 + i * len, z0 + (i + 1) * len, xc, width, style, edge, this.y, i % 3 === 0);
    }
  }

  /** Straight with a checkpoint near its start; the last 8 m are hazard stripes. */
  leadIn(length: number, label: string): number {
    const seg = this.base('leadIn', `CHECKPOINT → ${label}`, length);
    const cp = this.checkpoint(this.z + CHECKPOINT_INSET, this.x, DECK.width, label);
    const stripeLen = 8;
    this.flatDeck(this.z, this.z + length - stripeLen, this.x, DECK.width, 'deck', 'cyan');
    this.flatDeck(this.z + length - stripeLen, this.z + length, this.x, DECK.width, 'stripes', 'yellow');
    this.segments.push({ ...seg, kind: 'leadIn', checkpoint: cp });
    this.advance(length);
    return cp;
  }

  gap(): void {
    const { rng } = this;
    const lipAngle = pick(rng, GAP.lipAnglesDeg);
    const gapM = pick(rng, GAP.lengths);
    const profile: RampSegmentSpec[] = [...GAP.approachDeg, lipAngle].map((angleDeg) => ({ angleDeg, length: GAP.pieceLength }));
    const toe = this.z;
    const kick = this.ramp(toe, this.x, this.y, profile, GAP.width, GAP.thickness, 'ramp', 'magenta', false);
    const lipZ = kick.lip[2];
    // Base deck under the kicker ends exactly at the lip.
    this.flatDeck(toe, lipZ, this.x, DECK.width, 'hazard', 'magenta');
    this.kerbAcross(lipZ - 0.5, this.x, GAP.width, kick.lip[1] + 0.01, 0.9);
    const landingZ = lipZ + gapM;
    const end = landingZ + GAP.landingLength;
    this.flatDeck(landingZ, end, this.x, DECK.width, 'landing', 'green');
    this.kerbAcross(landingZ + 0.6, this.x, DECK.width, this.y, 1.2);
    const length = end - this.z;
    const seg = this.base('gap', `${HAZARD_LABEL.gap} ${gapM} m (lip ${lipAngle}°)`, length);
    this.segments.push({ ...seg, kind: 'gap', lip: kick.lip, lipAngleDeg: lipAngle, gapM, landingZ: r3(landingZ) });
    this.advance(length);
  }

  tiles(): void {
    const { rng } = this;
    const cols = pick(rng, TILES.colsOptions);
    const rows = int(rng, TILES.rowsMin, TILES.rowsMax);
    const size = TILES.size;
    const fieldStart = this.z;
    const fieldEnd = fieldStart + rows * size;
    const tiles: TileSpec[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        tiles.push({
          index: tiles.length,
          col,
          row,
          center: [r3(this.x + (col - (cols - 1) / 2) * size), r3(this.y - TILES.thickness / 2), r3(fieldStart + (row + 0.5) * size)],
        });
      }
    }
    // Floating orange guide rails along the field (visual only: no walls over the void).
    const width = cols * size;
    for (const side of [-1, 1]) {
      this.trims.push({
        center: [r3(this.x + side * (width / 2 + 0.6)), r3(this.y - 0.2), r3((fieldStart + fieldEnd) / 2)],
        size: [0.25, 0.25, rows * size],
        color: '#FF8A1F',
        glow: 2.2,
      });
    }
    const exitEnd = fieldEnd + TILES.exitLength;
    this.flatDeck(fieldEnd, exitEnd, this.x, DECK.width, 'deck', 'cyan');
    this.kerbAcross(fieldEnd + 0.6, this.x, DECK.width, this.y, 1.2);
    const length = exitEnd - this.z;
    const seg = this.base('tiles', `${HAZARD_LABEL.tiles} ${cols}×${rows}`, length);
    this.segments.push({
      ...seg,
      kind: 'tiles',
      cols,
      rows,
      size,
      thickness: TILES.thickness,
      fieldStartZ: r3(fieldStart),
      fieldEndZ: r3(fieldEnd),
      tiles,
    });
    this.advance(length);
  }

  pendulums(): void {
    const { rng } = this;
    const count = int(rng, PENDULUM.countMin, PENDULUM.countMax);
    const spacing = stepped(rng, PENDULUM.spacingMin, PENDULUM.spacingMax, 2);
    const length = snapTile(PENDULUM.entryLength + (count - 1) * spacing + PENDULUM.exitLength);
    const seg = this.base('pendulums', `${HAZARD_LABEL.pendulums} ×${count}`, length);
    this.flatDeck(this.z, this.z + length, this.x, PENDULUM.width, 'hazard', 'magenta');
    const [, bobH] = PENDULUM.bobSize;
    const pivotY = this.y + PENDULUM.clearance + bobH / 2 + PENDULUM.armLength;
    const basePhase = range(rng, 0, Math.PI * 2);
    const pendulums: PendulumSpec[] = [];
    for (let k = 0; k < count; k++) {
      const z = this.z + PENDULUM.entryLength + k * spacing;
      const amplitude = range(rng, PENDULUM.amplitudeDegMin, PENDULUM.amplitudeDegMax) * DEG;
      const omega = pendulumOmega(PENDULUM.armLength, PENDULUM.bobSize, amplitude);
      // Green wave: a car holding designSpeed meets every pendulum at the same point of its swing.
      const phase = basePhase - (k * omega * spacing) / PENDULUM.designSpeed + range(rng, -0.25, 0.25);
      pendulums.push({
        id: `${seg.id}-p${k}`,
        pivot: [r3(this.x), r3(pivotY), r3(z)],
        armLength: PENDULUM.armLength,
        bobSize: PENDULUM.bobSize,
        mass: PENDULUM.bobMass,
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
    const span = PENDULUM.gantryHalfSpan;
    const steel = '#1d1530';
    for (const side of [-1, 1]) {
      const px = x + side * span;
      this.trims.push({ center: [r3(px), r3((pivotY + 1.2 - 70) / 2), r3(z)], size: [1.2, r3(pivotY + 1.2 + 70), 1.2], color: steel, glow: 0 });
      this.trims.push({ center: [r3(px), r3(pivotY - 2), r3(z)], size: [1.32, 0.3, 1.32], color: '#FF2A6D', glow: 2.5 });
    }
    this.trims.push({ center: [r3(x), r3(pivotY + 1.1), r3(z)], size: [span * 2 + 1.2, 1.0, 1.4], color: steel, glow: 0 });
    this.trims.push({ center: [r3(x), r3(pivotY + 0.55), r3(z)], size: [span * 2 + 1.2, 0.12, 1.45], color: '#FF2A6D', glow: 2.5 });
    // Hinge hub.
    this.trims.push({ center: [r3(x), r3(pivotY), r3(z)], size: [1.1, 1.1, 2.0], color: '#2b2b38', glow: 0 });
  }

  sliders(): void {
    const { rng } = this;
    const count = int(rng, SLIDERS.countMin, SLIDERS.countMax);
    const spacing = stepped(rng, SLIDERS.spacingMin, SLIDERS.spacingMax, 2);
    const period = Math.round(range(rng, SLIDERS.periodMin, SLIDERS.periodMax) * 100) / 100;
    const length = snapTile(SLIDERS.entryLength + (count - 1) * spacing + SLIDERS.exitLength);
    const seg = this.base('sliders', `${HAZARD_LABEL.sliders} ×${count}`, length);
    this.flatDeck(this.z, this.z + length, this.x, SLIDERS.width, 'hazard', 'yellow');
    const basePhase = rng();
    const halfSpan = SLIDERS.width / 2;
    const shutters: ShutterSpec[] = [];
    for (let k = 0; k < count; k++) {
      const z = this.z + SLIDERS.entryLength + k * spacing;
      const phase = basePhase - (k * spacing) / (SLIDERS.designSpeed * period);
      shutters.push({
        id: `${seg.id}-w${k}`,
        position: [r3(this.x), r3(this.y), r3(z)],
        period,
        phase: ((phase % 1) + 1) % 1,
        halfSpan,
        wallLength: halfSpan + 1.2,
        height: SLIDERS.wallHeight,
        thickness: SLIDERS.wallThickness,
      });
      // Guide channels on both deck edges (visual).
      for (const side of [-1, 1]) {
        this.trims.push({
          center: [r3(this.x + side * (halfSpan + 4.6)), r3(this.y - 0.3), r3(z)],
          size: [8.4, 0.6, SLIDERS.wallThickness + 0.8],
          color: '#1a1a22',
          glow: 0,
        });
        this.trims.push({
          center: [r3(this.x + side * (halfSpan + 4.6)), r3(this.y + 0.02), r3(z)],
          size: [8.4, 0.05, 0.12],
          color: '#F5E663',
          glow: 2,
        });
      }
    }
    this.segments.push({ ...seg, kind: 'sliders', shutters });
    this.advance(length);
  }

  bigJump(): void {
    const J = BIG_JUMP;
    const cpZ = this.z + CHECKPOINT_INSET;
    const toeZ = cpZ + J.RUNUP_M;
    const shiftEnd = toeZ - J.LANE_SHIFT_END_BEFORE_KICKER_M;
    const shiftStart = shiftEnd - J.LANE_SHIFT_LENGTH_M;
    const fromX = this.x;
    const dir = this.x > 0.5 ? -1 : this.x < -0.5 ? 1 : this.rng() < 0.5 ? -1 : 1;
    const toX = fromX + dir * J.LANE_SHIFT_M;
    const startZ = this.z;

    const cp = this.checkpoint(cpZ, fromX, J.RUNUP_WIDTH, 'THE MASSIVE JUMP', 'magenta');
    this.flatDeck(startZ, shiftStart, fromX, J.RUNUP_WIDTH, 'deck', 'cyan');
    this.slices(shiftStart, shiftEnd, fromX, toX, J.RUNUP_WIDTH, 'deck', 'yellow');
    const kick = this.ramp(toeZ, toX, this.y, J.KICKER_PROFILE, J.KICKER_WIDTH, J.KICKER_THICKNESS, 'ramp', 'magenta', true);
    const lipZ = kick.lip[2];
    this.flatDeck(shiftEnd, lipZ, toX, J.RUNUP_WIDTH, 'deck', 'magenta');
    this.kerbAcross(lipZ - 0.6, toX, J.KICKER_WIDTH, kick.lip[1] + 0.01, 1.0);

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
    this.trims.push({ center: [r3(toX), r3(runoutY + 6.05), r3(runoutEnd - 1.5)], size: [J.LANDING_WIDTH + 2.1, 0.2, 3.1], color: '#39FF14', glow: 2.5 });

    const lipHeight = kick.lip[1] - this.y;
    const seg = this.base('bigJump', `THE MASSIVE JUMP (run-up ${J.RUNUP_M} m, lip ${lipHeight.toFixed(1)} m @ ${(kick.takeoff / DEG).toFixed(1)}°, gap ${J.GAP_M} m)`, runoutEnd - startZ, toX);
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
      this.centerline.push([r3(shiftStart + t * J.LANE_SHIFT_LENGTH_M), r3(fromX + (toX - fromX) * smoothstep(t))]);
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
    this.signs.push({
      id: 'kink-sign',
      lines: ['AERO KINK AHEAD', 'NO FRONT GRIP = NO STEERING'],
      position: [r3(fromX + dir * (J.RUNUP_WIDTH / 2 + 8)), 7, r3(shiftStart - 70)],
      yaw: Math.PI - dir * 0.3,
      width: 14,
      height: 5,
      color: 'yellow',
    });
    this.signs.push({
      id: 'runup-sign',
      lines: ['THE MASSIVE JUMP', `${J.RUNUP_M} M RUN-UP · TIER 5 ONLY`],
      position: [r3(fromX - dir * (J.RUNUP_WIDTH / 2 + 9)), 8, r3(cpZ + 40)],
      yaw: Math.PI + dir * 0.3,
      width: 15,
      height: 5.5,
      color: 'cyan',
    });

    this.gates.push({ kind: 'finish', index: -1, position: [r3(toX), r3(runoutY), r3(finishZ)], width: J.LANDING_WIDTH + 2, height: GATE_HEIGHT, label: 'FINISH', color: 'green' });
    this.y = runoutY;
    this.advance(runoutEnd - startZ, toX);
  }
}

// ── Generator ────────────────────────────────────────────────────────────────────────────────

const HAZARDS: readonly HazardKind[] = ['gap', 'tiles', 'pendulums', 'sliders'];

export function generateChaosTrack(seed: number = DEFAULT_CHAOS_SEED): ChaosTrackPlan {
  const rng = mulberry32(seed);
  const b = new PlanBuilder(rng, -32);
  b.start(80, 0);

  const order = shuffle(rng, HAZARDS);
  // At least one chicane per layout; which connector gets it is seeded.
  const forcedChicane = int(rng, 1, order.length);
  order.forEach((hazard, i) => {
    const connector = i === 0 ? rng() < 0.5 : true;
    if (connector || i === forcedChicane) {
      const chicane = i === forcedChicane || rng() < 0.45;
      if (chicane) {
        let shift = stepped(rng, CONNECTOR.shiftMin, CONNECTOR.shiftMax, 1) * (rng() < 0.5 ? -1 : 1);
        if (Math.abs(b.x + shift) > CONNECTOR.maxOffset) shift = -shift;
        b.chicane(stepped(rng, CONNECTOR.chicaneMin, CONNECTOR.chicaneMax, DECK.tile), shift);
      } else {
        b.straight(stepped(rng, CONNECTOR.straightMin, CONNECTOR.straightMax, DECK.tile));
      }
    }
    b.leadIn(LEAD_IN[hazard], HAZARD_LABEL[hazard]);
    b[hazard]();
  });

  b.straight(stepped(rng, CONNECTOR.straightMin, CONNECTOR.straightMax, DECK.tile));
  b.bigJump();

  const lowestTop = Math.min(
    ...b.decks.map((d) => d.center[1] + d.size[1] / 2),
  );
  const finishGate = b.gates.find((g) => g.kind === 'finish');
  const jump = b.segments.find((s): s is BigJumpSegment => s.kind === 'bigJump');
  if (!finishGate || !jump) throw new Error('chaos track: generator produced no finish / big jump');

  const id = seed === DEFAULT_CHAOS_SEED ? CHAOS_TRACK_ID : `${CHAOS_TRACK_ID}-${seed}`;
  const startZ = b.segments[0]?.startZ ?? 0;
  const layout: TrackLayout = {
    id,
    name: seed === DEFAULT_CHAOS_SEED ? 'GamerFleet Chaos Track' : `GamerFleet Chaos Track #${seed}`,
    spawn: { position: b.checkpoints[0]!.position, yaw: 0 },
    checkpoints: b.checkpoints,
    finish: { position: finishGate.position, yaw: 0, size: [finishGate.width, GATE_HEIGHT, GATE_DEPTH] },
    killY: r3(lowestTop - KILL_DEPTH),
    bigJump: { lipPosition: jump.lip, yaw: 0, requiredKmh: BIG_JUMP.REQUIRED_KMH, halfWidth: BIG_JUMP.KICKER_WIDTH / 2 + 2 },
    lengthM: r3(finishGate.position[2] - (b.checkpoints[0]?.position[2] ?? 0)),
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
  };
  decorate(plan, mulberry32(seed ^ 0x9e3779b9));
  return plan;
}

/** Atmosphere on its own RNG stream so decor tweaks never reshuffle the gameplay layout. */
function decorate(plan: ChaosTrackPlan, rng: Rng): void {
  const z0 = (plan.segments[0]?.startZ ?? 0) - 80;
  const z1 = (plan.segments[plan.segments.length - 1]?.endZ ?? 1000) + 80;
  const palette = ['#1b2440', '#241a33', '#2a1532', '#132b30', '#1a1f2c'];
  const glows = ['#00F0FF', '#FF2A6D', '#F5E663', '#39FF14'];
  for (let i = 0; i < DECOR.debrisCount; i++) {
    const z = range(rng, z0, z1);
    const side = rng() < 0.5 ? -1 : 1;
    const glowing = rng() < 0.18;
    plan.debris.push({
      position: [r3(centerXAt(plan, z) + side * range(rng, 24, 150)), r3(range(rng, -70, 40)), r3(z)],
      size: r3(glowing ? range(rng, 0.6, 2) : range(rng, 1.2, 7)),
      rotation: [r3(range(rng, 0, Math.PI)), r3(range(rng, 0, Math.PI)), r3(range(rng, 0, Math.PI))],
      color: glowing ? pick(rng, glows) : pick(rng, palette),
      glow: glowing ? r3(range(rng, 1.5, 3)) : 0,
      bob: r3(range(rng, 0.4, 2.2)),
      speed: r3(range(rng, 0.15, 0.5)),
      phase: r3(range(rng, 0, Math.PI * 2)),
    });
  }
  let side = 1;
  for (let z = 60; z < z1 - 120; z += DECOR.billboardEvery + range(rng, -40, 40)) {
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
