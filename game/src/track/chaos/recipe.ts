/**
 * Map recipes: everything that makes one generated map different from another. The plan
 * generator (plan.ts) is shared by every map over the void (the GamerFleet Chaos Track and the
 * maps in `../maps/`); a recipe gives it the deck width, the hazard tunings, the big-jump
 * calibration, the palette, the decor and the section program (`compose`).
 *
 * The chaos recipe uses exactly the constants in config.ts, so its seed-1337 layout is the
 * hand-validated one (README "GamerFleet Chaos Track").
 */
import type { RampSegmentSpec } from '../common/ramp';
import type { TrackAtmosphere } from '../types';
import { BIG_JUMP, COLORS, CONNECTOR, DECK, DECOR, GAP, LEAD_IN, PENDULUM, SLIDERS, TILES } from './config';
import type { Rng } from './rng';
// Type-only: the builder class lives in plan.ts (no runtime import cycle).
import type { DeckStyle, GlowColor, HazardKind, PlanBuilder } from './plan';

// ── Tunings (the chaos values are the config.ts constants) ───────────────────────────────────

export interface ConnectorTuning {
  straightMin: number;
  straightMax: number;
  chicaneMin: number;
  chicaneMax: number;
  shiftMin: number;
  shiftMax: number;
  /** Lateral offset of the centreline never exceeds this, m. */
  maxOffset: number;
  /** Chicane slices are axis-aligned voxel strips of this length, m. */
  sliceLength: number;
}

export interface GapTuning {
  approachDeg: readonly number[];
  pieceLength: number;
  lipAnglesDeg: readonly number[];
  lengths: readonly number[];
  width: number;
  thickness: number;
  landingLength: number;
}

export interface TileTuning {
  size: number;
  thickness: number;
  colsOptions: readonly number[];
  rowsMin: number;
  rowsMax: number;
  exitLength: number;
}

export interface PendulumTuning {
  bobMass: number;
  bobSize: readonly [number, number, number];
  armLength: number;
  clearance: number;
  amplitudeDegMin: number;
  amplitudeDegMax: number;
  designSpeed: number;
  countMin: number;
  countMax: number;
  spacingMin: number;
  spacingMax: number;
  gantryHalfSpan: number;
  width: number;
  entryLength: number;
  exitLength: number;
}

export interface SliderTuning {
  width: number;
  wallHeight: number;
  wallThickness: number;
  periodMin: number;
  periodMax: number;
  designSpeed: number;
  countMin: number;
  countMax: number;
  spacingMin: number;
  spacingMax: number;
  entryLength: number;
  exitLength: number;
}

/** Big-jump geometry + calibration (see config.ts BIG_JUMP for what each number does). */
export interface BigJumpTuning {
  RUNUP_M: number;
  /** 0 = no aero kink (dead-straight run-up). */
  LANE_SHIFT_M: number;
  LANE_SHIFT_LENGTH_M: number;
  LANE_SHIFT_END_BEFORE_KICKER_M: number;
  RUNUP_WIDTH: number;
  KICKER_WIDTH: number;
  KICKER_THICKNESS: number;
  KICKER_PROFILE: readonly RampSegmentSpec[];
  GAP_M: number;
  LANDING_DROP_M: number;
  LANDING_PROFILE: readonly RampSegmentSpec[];
  LANDING_WIDTH: number;
  RUNOUT_M: number;
  FINISH_AT_M: number;
  /** Lip speed that clears the gap (measured in the sim), km/h. Shown on the lip sign and in the layout. */
  REQUIRED_KMH: number;
  /** Gate / sign wording. */
  TITLE?: string;
  RUNUP_HINT?: string;
}

export interface TrackTunings {
  connector: ConnectorTuning;
  leadIn: Record<HazardKind, number>;
  gap: GapTuning;
  tiles: TileTuning;
  pendulum: PendulumTuning;
  sliders: SliderTuning;
}

// ── Look ─────────────────────────────────────────────────────────────────────────────────────

export interface TrackPalette {
  /** Neon colour of each named glow (edges, grout, gates, signs, hazard trims). */
  glow: Record<GlowColor, string>;
  /** Base colour of the voxel tiles per deck style. */
  tile: Record<DeckStyle, string>;
  /** The odd accent tile (4 %), and its ramp variant. */
  tileAccent: string;
  tileAccentRamp: string;
  /** Dark slab under the tiles. */
  slab: string;
  /** Pylons and sign posts. */
  steel: string;
  /** Solid blocks (ramp fills, knoll face, end wall). */
  solid: string;
  /** Sign / billboard backing panels. */
  panel: string;
  /** Gate posts and timing-gantry posts. */
  post: string;
  /** Pendulum gantries. */
  gantry: string;
  /** Hazard bodies (collapsing tiles, pendulum bob + studs + arm, shutter walls). */
  hazard: { tile: string; bob: string; stud: string; arm: string; wall: string };
  /** Deck material response (ice is glossier). */
  surface: { roughness: number; metalness: number };
  /** Island underside rock / earth voxels (sky maps), lightest → darkest. */
  rock?: readonly string[];
}

export interface DecorTuning {
  debrisCount: number;
  billboardEvery: number;
  /** Matte debris colours and the glowing ones. */
  debrisColors: readonly string[];
  debrisGlows: readonly string[];
  /** 'voxels' = tumbling blocks (chaos); 'clouds' = flat drifting cloud slabs; 'shards' = tall ice shards; 'towers' = a far voxel skyline. */
  debrisStyle?: 'voxels' | 'clouds' | 'shards' | 'towers';
  /** Billboard texts (cycled along the track). */
  billboardText: readonly string[];
  /** Named glow used for billboards. */
  billboardGlow: GlowColor;
}

export interface TrackRecipe {
  /** Stable map id (TRACKS / TRACK_CATALOG key, best-time key). */
  id: string;
  name: string;
  /** Hand-validated seed; other seeds get `${id}-${seed}` ids. */
  seed: number;
  /** Label on the start gate. */
  title: string;
  /** Standard deck width, m. */
  width: number;
  tunings: TrackTunings;
  /** Present when the map ends in a calibrated big jump. */
  bigJump?: BigJumpTuning;
  palette: TrackPalette;
  decor: DecorTuning;
  /** Tyre-grip multiplier of every deck (TrackLayout.surfaceGrip). */
  surfaceGrip?: number;
  /** Sky, fog and light (TrackLayout.atmosphere); omitted = the default neon night. */
  atmosphere?: TrackAtmosphere;
  /** The section program: lays out start → … → finish with the builder. */
  compose(b: PlanBuilder, rng: Rng): void;
}

// ── The chaos defaults ───────────────────────────────────────────────────────────────────────

export const HAZARD_LABEL: Record<HazardKind, string> = {
  gap: 'SKY GAP',
  tiles: 'COLLAPSE ZONE',
  pendulums: 'PENDULUM ALLEY',
  sliders: 'SHUTTER GATES',
};

export const CHAOS_TUNINGS: TrackTunings = {
  connector: CONNECTOR,
  leadIn: LEAD_IN,
  gap: GAP,
  tiles: TILES,
  pendulum: PENDULUM,
  sliders: SLIDERS,
};

export const CHAOS_BIG_JUMP: BigJumpTuning = BIG_JUMP;

export const CHAOS_PALETTE: TrackPalette = {
  glow: { cyan: COLORS.cyan, magenta: COLORS.magenta, yellow: COLORS.yellow, green: COLORS.green, orange: COLORS.orange },
  tile: {
    start: COLORS.startDeck,
    deck: COLORS.deck,
    stripes: COLORS.deck,
    hazard: COLORS.hazardDeck,
    ramp: COLORS.ramp,
    landing: COLORS.landing,
    finish: COLORS.startDeck,
  },
  tileAccent: COLORS.deckAlt,
  tileAccentRamp: '#5a2a63',
  slab: COLORS.slab,
  steel: COLORS.steel,
  solid: '#120d1d',
  panel: '#0c0e16',
  post: '#141826',
  gantry: '#1d1530',
  hazard: { tile: '#2a2238', bob: '#2a1030', stud: '#3a1640', arm: '#1d1a26', wall: '#1b1724' },
  surface: { roughness: 0.72, metalness: 0.18 },
};

export const CHAOS_DECOR: DecorTuning = {
  debrisCount: DECOR.debrisCount,
  billboardEvery: DECOR.billboardEvery,
  debrisColors: ['#1b2440', '#241a33', '#2a1532', '#132b30', '#1a1f2c'],
  debrisGlows: ['#00F0FF', '#FF2A6D', '#F5E663', '#39FF14'],
  debrisStyle: 'voxels',
  billboardText: ['GAMERFLEET'],
  billboardGlow: 'cyan',
};

/** Standard deck width of the chaos track (every hazard deck matches it). */
export const CHAOS_WIDTH = DECK.width;

/**
 * Per-map tunings: the chaos values with `overrides` merged in. Every hazard deck (gap kicker,
 * pendulum deck, shutter span) defaults to the map's deck `width`.
 */
export function tunings(width: number, overrides: { [K in keyof TrackTunings]?: Partial<TrackTunings[K]> } = {}): TrackTunings {
  return {
    connector: { ...CHAOS_TUNINGS.connector, ...overrides.connector },
    leadIn: { ...CHAOS_TUNINGS.leadIn, ...overrides.leadIn },
    gap: { ...CHAOS_TUNINGS.gap, width, ...overrides.gap },
    tiles: { ...CHAOS_TUNINGS.tiles, ...overrides.tiles },
    pendulum: { ...CHAOS_TUNINGS.pendulum, width, ...overrides.pendulum },
    sliders: { ...CHAOS_TUNINGS.sliders, width, ...overrides.sliders },
  };
}
