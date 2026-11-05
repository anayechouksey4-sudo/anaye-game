/**
 * GamerFleet Chaos Track: every tunable number in one place. The generator (plan.ts) and the
 * segment components read only these, so calibration never has to touch geometry code.
 */
import { BIG_JUMP_LIP_KMH } from '@shared/protocol';
import type { RampSegmentSpec } from '../common/ramp';

/** Hand-validated default layout (see README "GamerFleet Chaos Track"). */
export const DEFAULT_CHAOS_SEED = 1337;

/** Track ids: the default seed keeps the plain id so its best time survives seed changes elsewhere. */
export const CHAOS_TRACK_ID = 'chaos';

// ── Decks ────────────────────────────────────────────────────────────────────────────────────

export const DECK = {
  /** Standard driving width, m. */
  width: 14,
  /** Collider/slab thickness under the driving surface, m. */
  thickness: 1.4,
  /** Visual voxel tile pitch, m; segment lengths are snapped to it. */
  tile: 4,
  /** Visual gap between voxel tiles (the glowing grout), m. */
  grout: 0.14,
  /** Visual voxel tile thickness (top is flush with the collider top), m. */
  tileDepth: 0.32,
  /** How far the dark slab top sits below the tiles so the grout reads as lines, m. */
  slabInset: 0.05,
} as const;

/** Respawn plane: this far below the lowest driving surface (the big jump's run-out). */
export const KILL_DEPTH = 18;

/** Gate trigger volumes: [width across, height, depth]. Depth ≥ 2 m so a 60 Hz step at 200 km/h can't skip it. */
export const GATE_HEIGHT = 9;
export const GATE_DEPTH = 4;
/** Checkpoints sit this far into the lead-in deck of the hazard they guard. */
export const CHECKPOINT_INSET = 8;

/** Lead-in deck length after a checkpoint, per hazard (enough to reach ~70 km/h at default settings). */
export const LEAD_IN = {
  gap: 56,
  tiles: 56,
  pendulums: 40,
  sliders: 40,
} as const;

// ── Collision groups (Rapier interaction groups: membership << 16 | filter) ───────────────────
// Falling tiles must not snag on their neighbours or the deck they were part of, but every
// group still collides with the car (default groups) and the wheel raycasts (default filter).

export const GROUP_DECK = 1 << 1;
export const GROUP_TILE = 1 << 2;
export const DECK_COLLISION_GROUPS = (GROUP_DECK << 16) | (0xffff & ~GROUP_TILE);
export const TILE_COLLISION_GROUPS = (GROUP_TILE << 16) | (0xffff & ~(GROUP_TILE | GROUP_DECK));

// ── Small ramp + gap ─────────────────────────────────────────────────────────────────────────

export const GAP = {
  /** Eased kicker; the last angle is picked per seed from `lipAnglesDeg`. */
  approachDeg: [2, 4] as const,
  pieceLength: 5,
  lipAnglesDeg: [6, 7, 8] as const,
  /** Gap lengths a seed may pick (≈ 50–60 km/h needed at default settings), m. */
  lengths: [8, 9, 10] as const,
  width: 14,
  thickness: 0.6,
  /** Long enough that a tier-5 car at full speed (≈70 m flights) still lands on straight deck. */
  landingLength: 48,
} as const;

// ── Collapsing tiles ─────────────────────────────────────────────────────────────────────────

export const TILES = {
  /** Tile edge length, m (the physics bodies are flush; the visual has a small gap). */
  size: 4,
  thickness: 0.8,
  /** Countdown from the first touch to the tile turning dynamic, s. */
  collapseDelayS: 1.0,
  /** Visual shake amplitude during the countdown, m. */
  shake: 0.07,
  /** Fallen tiles are disabled once this far below their home position, m. */
  disableDepth: 60,
  colsOptions: [3, 4] as const,
  rowsMin: 11,
  rowsMax: 15,
  exitLength: 16,
  /** Tumble given when a tile lets go, rad/s. */
  tumble: 0.9,
} as const;

// ── Pendulums ────────────────────────────────────────────────────────────────────────────────

export const PENDULUM = {
  /** ≥ 10× the car's mass, so a hit barely slows the bob and throws the car. */
  bobMass: 15000,
  /** Bob block [across the track, height, along the track], m. */
  bobSize: [3.6, 3.0, 3.2] as const,
  /** Pivot → bob centre, m. */
  armLength: 11,
  /**
   * Bob bottom above the deck at the lowest point of the swing, m. Below the chassis box's floor
   * (0.28 m at ride height) so a car can never be driven in underneath and pinned.
   */
  clearance: 0.15,
  /** A car stopped under a bob for this long is respawned (a crushed car can't free itself), s. */
  pinnedRespawnS: 1.5,
  amplitudeDegMin: 48,
  amplitudeDegMax: 54,
  /**
   * Hinge drive tracking the free-swing trajectory θ*(t): angular acceleration (about the hinge)
   * = clamp(stiffness·(θ*−θ) + damping·(θ̇*−θ̇), ±maxAccel). In steady state it adds almost no
   * torque — gravity does the work; it only pulls the bob back into amplitude/phase after hits.
   * maxAccel stays well below gravity's own restoring acceleration at full swing (≈0.67 rad/s²).
   */
  drive: { stiffness: 0.5, damping: 0.6, maxAccel: 0.25 },
  /** Car speed the phase stagger is designed around ("green wave"), m/s. */
  designSpeed: 26,
  countMin: 2,
  countMax: 4,
  spacingMin: 20,
  spacingMax: 26,
  /** Gantry pillars sit outside the swing envelope, m from the centreline. */
  gantryHalfSpan: 13,
  width: 14,
  entryLength: 14,
  exitLength: 18,
  restitution: 0.25,
  friction: 0.6,
} as const;

// ── Sliding shutters (kinematic walls) ───────────────────────────────────────────────────────

export const SLIDERS = {
  width: 14,
  wallHeight: 3,
  wallThickness: 1.6,
  /** Fractions of the cycle: closing, closed hold, opening (the rest is fully open). */
  closingFraction: 0.2,
  closedFraction: 0.14,
  openingFraction: 0.2,
  periodMin: 3.4,
  periodMax: 4.2,
  designSpeed: 24,
  countMin: 2,
  countMax: 4,
  spacingMin: 16,
  spacingMax: 22,
  entryLength: 14,
  exitLength: 18,
} as const;

// ── Connectors ───────────────────────────────────────────────────────────────────────────────

export const CONNECTOR = {
  straightMin: 16,
  straightMax: 32,
  chicaneMin: 40,
  chicaneMax: 60,
  shiftMin: 4,
  shiftMax: 8,
  /** Lateral offset of the centreline never exceeds this, m. */
  maxOffset: 12,
  /** Chicane slices are axis-aligned voxel strips of this length (a "staircase" S-bend), m. */
  sliceLength: 4,
} as const;

// ── THE MASSIVE JUMP (calibration constants) ─────────────────────────────────────────────────
// Clearing it means carrying BIG_JUMP_LIP_KMH off the lip with the nose down, and the dashboard's
// assessBigJump() (top speed vs BIG_JUMP_LIP_KMH, lift-off speed) must agree with the sim:
//   * the run-up is long enough that a car reaches the kicker within ~1 % of its top speed even
//     from a standstill (respawns put you at the run-up checkpoint, stopped), so "top speed ≥
//     required" in the estimate really means "fast enough at the lip";
//   * the run-up is dead flat: at top speed a front-light car has only ~5 % of its weight on the
//     front axle, so any crest would lift the nose of setups the estimate rightly calls READY;
//   * the kicker is short and low (2.3 m): climbing it at top speed costs ≈ 2·g·h of v², so a
//     tall kicker would put the lip speed well below the top speed the estimate works with;
//   * the "aero kink" (a lateral S-bend wider than the deck's slack, so there is no straight line
//     through it) needs steering at speed: a car whose nose has lifted can't steer and runs off;
//   * the gap is sized so BIG_JUMP_LIP_KMH at the lip is what it takes to reach the knoll.
// Measured calibration grid: game/README.md → "The massive jump".

export const BIG_JUMP = {
  /** Checkpoint gate → kicker toe, m. */
  RUNUP_M: 825,
  /** Lateral offset of the aero kink, m. > 2 × (deck half-width − car half-width) = 12, so a car that can't steer runs off. */
  LANE_SHIFT_M: 16,
  LANE_SHIFT_LENGTH_M: 240,
  /** Distance from the end of the kink to the kicker toe, m (time to straighten up). */
  LANE_SHIFT_END_BEFORE_KICKER_M: 185,
  RUNUP_WIDTH: 14,
  KICKER_WIDTH: 14,
  KICKER_THICKNESS: 0.8,
  /** Eased in 2.5° steps over 6 m (≈2 g on the springs at 190 km/h): lip only 2.3 m above the toe, 10° take-off. */
  KICKER_PROFILE: [
    { angleDeg: 2.5, length: 6 },
    { angleDeg: 5, length: 6 },
    { angleDeg: 7.5, length: 6 },
    { angleDeg: 10, length: 10 },
  ] as readonly RampSegmentSpec[],
  /** Horizontal distance lip → knoll (start of the landing deck), m. */
  GAP_M: 95,
  /** Knoll top below the lip, m. */
  LANDING_DROP_M: 3,
  /** Landing hill below the knoll (eased down-slope), local ramp profile. */
  LANDING_PROFILE: [
    { angleDeg: -3, length: 8 },
    { angleDeg: -7, length: 10 },
    { angleDeg: -12, length: 12 },
    { angleDeg: -14, length: 20 },
    { angleDeg: -10, length: 10 },
    { angleDeg: -6, length: 10 },
    { angleDeg: -2, length: 8 },
  ] as readonly RampSegmentSpec[],
  LANDING_WIDTH: 18,
  /** Flat run-out after the landing hill; the finish line sits FINISH_AT_M into it. */
  RUNOUT_M: 100,
  FINISH_AT_M: 36,
  /** The speed the lip sign asks for. */
  REQUIRED_KMH: BIG_JUMP_LIP_KMH,
} as const;

// ── Atmosphere ───────────────────────────────────────────────────────────────────────────────

export const DECOR = {
  debrisCount: 150,
  billboardEvery: 260,
} as const;

/** Track palette (matches the dashboard and src/scene/Environment.tsx PALETTE). */
export const COLORS = {
  bg: '#05060A',
  cyan: '#00F0FF',
  magenta: '#FF2A6D',
  yellow: '#F5E663',
  green: '#39FF14',
  orange: '#FF8A1F',
  red: '#FF2A2A',
  deck: '#2a3454',
  deckAlt: '#3b4a7a',
  slab: '#0a0d18',
  hazardDeck: '#3a2850',
  ramp: '#43204e',
  landing: '#1d4248',
  startDeck: '#2a3043',
  steel: '#1a1f2c',
  black: '#0b0b0f',
} as const;
