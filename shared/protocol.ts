/**
 * SquadHQ ⇄ Racer wire protocol — v1
 * ==================================
 *
 * Single source of truth shared by all three apps in this repo:
 *
 *   dashboard/  (React Native + Expo, bundled by Metro)   ── broadcasts slider values
 *   server/     (Node + ws, run with tsx)                 ── relays + remembers last state
 *   game/       (React Three Fiber + Rapier, Vite)        ── listens, updates car physics
 *
 * Rules for this file:
 *   - ZERO runtime dependencies (it is imported from three different toolchains).
 *   - Erasable TypeScript only: no `enum`, no `namespace`, no parameter properties,
 *     so it works with Vite's `erasableSyntaxOnly`, Metro/Babel and tsx alike.
 *   - Every message that crosses the wire goes through `parseMessage`, which
 *     validates, clamps and quantizes. Never trust raw JSON from a socket.
 *
 * Transport: JSON text frames over a plain WebSocket, default `ws://<host>:8787`.
 * Every frame is one object with a string `type` and `v: 1`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = 1 as const;

/** Default TCP port of the local relay server. */
export const DEFAULT_SERVER_PORT = 8787;

/** Hard cap on a single frame. The server rejects anything larger. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** Recommended minimum gap between `squad:controls` frames while dragging (~30 Hz). */
export const CONTROLS_SEND_INTERVAL_MS = 33;

/** Recommended gap between `game:telemetry` frames (10 Hz). */
export const TELEMETRY_INTERVAL_MS = 100;

/** Server → client WebSocket ping interval; a client missing one pong is dropped. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Client reconnect backoff bounds. */
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 8_000;

export type ClientRole = 'game' | 'dashboard' | 'observer';
export const CLIENT_ROLES: readonly ClientRole[] = ['game', 'dashboard', 'observer'];

export function isClientRole(value: unknown): value is ClientRole {
  return typeof value === 'string' && (CLIENT_ROLES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Range specs (drive both UI generation and validation)
// ─────────────────────────────────────────────────────────────────────────────

export interface RangeSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Short unit suffix for display, may be ''. */
  unit: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Squad controls — the dashboard's three sliders, sent verbatim
// ─────────────────────────────────────────────────────────────────────────────

export interface SquadControls {
  /** "Front Wing Aero" — percent, 0…100, step 1. */
  frontWingAero: number;
  /** "Engine Tier" — integer, 1…5. */
  engineTier: number;
  /** "Chassis Balance" — −50 (front-biased) … +50 (rear-biased), 0 = neutral, step 1. */
  chassisBalance: number;
}

export type SquadControlKey = keyof SquadControls;

export const SQUAD_CONTROL_KEYS: readonly SquadControlKey[] = [
  'frontWingAero',
  'engineTier',
  'chassisBalance',
];

export const SQUAD_CONTROL_SPECS: { readonly [K in SquadControlKey]: RangeSpec } = {
  frontWingAero: {
    label: 'Front Wing Aero',
    min: 0,
    max: 100,
    step: 1,
    default: 50,
    unit: '%',
    description: 'More wing = more downforce and grip in corners, but more drag on the straights.',
  },
  engineTier: {
    label: 'Engine Tier',
    min: 1,
    max: 5,
    step: 1,
    default: 3,
    unit: '',
    description: 'Higher tiers push more drive force but add weight.',
  },
  chassisBalance: {
    label: 'Chassis Balance',
    min: -50,
    max: 50,
    step: 1,
    default: 0,
    unit: '',
    description: 'Shifts weight front (−) or rear (+). Front = sharp turn-in, rear = stable traction out of corners.',
  },
};

export const DEFAULT_SQUAD_CONTROLS: Readonly<SquadControls> = Object.freeze({
  frontWingAero: SQUAD_CONTROL_SPECS.frontWingAero.default,
  engineTier: SQUAD_CONTROL_SPECS.engineTier.default,
  chassisBalance: SQUAD_CONTROL_SPECS.chassisBalance.default,
});

// ─────────────────────────────────────────────────────────────────────────────
// Car physics parameters — what the game's car controller actually consumes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Physics model (implemented by game/, previewed by dashboard/):
 *
 *   Drive      Rear-wheel drive. Base torque `engineTorque` (N·m, whole rear axle) is split across the two
 *              rear wheels; contact-patch force = engineTorque / DRIVE_WHEEL_RADIUS.
 *   Front aero The front wing's downforce acts AT THE FRONT AXLE and scales with forward speed squared,
 *              fighting a fixed body lift at the same point:
 *                  F_front = (frontDownforce − FRONT_BODY_LIFT) · v_fwd²     (+ = pushes down, − = lifts)
 *              With too little wing the net force goes negative and, at high speed, the nose physically lifts.
 *   Rear aero  Fixed rear wing: F_rear = REAR_DOWNFORCE · v_fwd², applied at the rear axle.
 *   Drag       F_drag = −drag · v · |v| at the centre of mass.
 *   Load shift Drive force acts at the rear contact patch, CG_HEIGHT below the centre of mass, so under
 *              power it moves driveForce·CG_HEIGHT/WHEELBASE of load off the front axle.
 *   Balance    Shifts the centre of mass (see balanceToFrontWeightFraction) AND re-splits suspension stiffness
 *              between the axles (see balanceToSuspensionStiffness).
 *   Traction   Tyre friction coefficient (wheel friction slip / side stiffness).
 *
 *   The constants below are the original car's (the hypercar). Each car class in the garage (CAR_CLASSES)
 *   has its own set; every helper takes an optional car and defaults to the hypercar.
 *
 *   In game/ the two vertical aero terms are ground-effect forces: full strength while an axle's tyres are on
 *   (or within ~1 m of) the ground, fading with height in flight (game/src/car/carController.ts). The preview
 *   formulas here are the on-ground values, which is all the estimates below need.
 */
export interface CarPhysicsParams {
  /** Chassis mass in kg. */
  mass: number;
  /** Tyre grip coefficient (μ-like). Maps to wheel friction slip / side stiffness. */
  traction: number;
  /** Aerodynamic drag factor k, in N per (m/s)²: F_drag = −k · v · |v|. */
  drag: number;
  /** Front-wing downforce factor k at the FRONT AXLE, in N per (m/s)². Net front aero = (k − FRONT_BODY_LIFT)·v². */
  frontDownforce: number;
  /** Base drive torque in N·m for the whole rear axle (rear-wheel drive). */
  engineTorque: number;
  /** Weight bias, −1 (front-heavy) … +1 (rear-heavy). Drives centre of mass and suspension split. */
  balance: number;
}

export type CarPhysicsKey = keyof CarPhysicsParams;

export const CAR_PHYSICS_KEYS: readonly CarPhysicsKey[] = [
  'mass',
  'traction',
  'drag',
  'frontDownforce',
  'engineTorque',
  'balance',
];

// ── Tuning constants ────────────────────────────────────────────────────────
// The game calibrates these against its simulation; the dashboard uses them for previews.
// Values may be re-tuned, names and meanings may not.

/** Rear (driven) wheel radius in metres. */
export const DRIVE_WHEEL_RADIUS = 0.36;
/** Body/underfloor lift at the front axle, N per (m/s)². The front wing must beat this to keep the nose down. */
export const FRONT_BODY_LIFT = 2.7;
/** Fixed rear-wing downforce at the rear axle, N per (m/s)². */
export const REAR_DOWNFORCE = 2.5;
/** Neutral per-wheel suspension stiffness (Rapier raycast-vehicle units, mass-normalised). */
export const SUSPENSION_STIFFNESS_BASE = 50;
/** How far balance re-splits stiffness: ±1 balance moves each axle by ±this fraction. */
export const SUSPENSION_BALANCE_SPLIT = 0.4;
/** Speed (km/h) the car must carry off the lip of the big jump to clear its gap. */
export const BIG_JUMP_LIP_KMH = 183;
/** Front-wing downforce factor at 100 % Front Wing Aero (the mapping is linear from 0). */
export const FRONT_WING_DOWNFORCE_MAX = 6.5;
/** Centre-of-mass height above the ground, metres. */
export const CG_HEIGHT = 0.45;
/** Distance between front and rear axles, metres. */
export const WHEELBASE = 2.7;

export const CAR_PHYSICS_SPECS: { readonly [K in CarPhysicsKey]: RangeSpec } = {
  mass: {
    label: 'Mass',
    min: 400,
    max: 3000,
    step: 10,
    default: 1170,
    unit: 'kg',
    description: 'Heavier cars accelerate slower and resist being shoved by obstacles.',
  },
  traction: {
    label: 'Traction',
    min: 0.2,
    max: 4,
    step: 0.01,
    default: 1.45,
    unit: 'μ',
    description: 'Tyre grip. Low values slide, high values stick.',
  },
  drag: {
    label: 'Aero Drag',
    min: 0,
    max: 12,
    step: 0.05,
    default: 3.88,
    unit: 'k',
    description: 'Air resistance, grows with the square of speed. Caps top speed.',
  },
  frontDownforce: {
    label: 'Front Downforce',
    min: 0,
    max: 15,
    step: 0.05,
    default: 3.25,
    unit: 'k',
    description: 'Front-wing load on the front axle, grows with speed². Below body lift the nose rises.',
  },
  engineTorque: {
    label: 'Engine Torque',
    min: 200,
    max: 8000,
    step: 10,
    default: 2100,
    unit: 'N·m',
    description: 'Base torque delivered to the rear wheels.',
  },
  balance: {
    label: 'Balance',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0,
    unit: '',
    description: 'Weight and spring bias front (−1) to rear (+1).',
  },
};

/** Gravity used by the game world (m/s², positive magnitude). */
export const GRAVITY = 9.81;

/** Rolling-resistance coefficient used only by `estimateTopSpeedKmh`. */
export const ROLLING_RESISTANCE = 0.015;

/** Base tyre grip — no slider changes it; aero adds grip physically via axle load. */
export const BASE_TRACTION = 1.45;

// ─────────────────────────────────────────────────────────────────────────────
// Car classes — the garage. Every class maps the same three sliders onto its own car.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A car class: how the dashboard's three sliders map onto this car's physics params, plus the
 * fixed aero / drivetrain / geometry constants the estimates below need. The game builds each
 * class's chassis, wheels and suspension from these same numbers (game/src/car/vehicleSpec.ts),
 * so the dashboard's previews and the simulation agree for every car.
 *
 * `hypercar` is the original car: its numbers ARE the legacy constants above (DRIVE_WHEEL_RADIUS,
 * FRONT_BODY_LIFT, CG_HEIGHT, …). Every helper called without a car, or with an unknown id, uses
 * it, so pre-garage callers get exactly the results they always did.
 *
 * Physics per class (same model as above, with the class's constants):
 *   drive       engineTorque / driveWheelRadius at the contact patches, split front/rear by
 *               frontDriveShare (0 = RWD), × a low-speed "grunt" multiplier (launchBoost, fading out
 *               by launchFadeKmh) that lights the tyres up off the line but does not change top speed
 *   front aero  (frontDownforce − frontBodyLift) · v²  at the front axle
 *   rear aero   rearDownforce · v²  at the rear axle
 *   balance     static front-axle load = frontWeightNeutral − frontWeightRange · balance; springs split
 *               in proportion (suspensionBalanceSplit = 2 · frontWeightRange keeps the ride height
 *               the same at every balance)
 */
export interface CarClass {
  id: string;
  /** Short display name (the game's garage card adds a tagline and stat bars). */
  name: string;
  /** Share of the drive torque sent to the front axle: 0 = rear-wheel drive, 0.4 = 40/60 all-wheel drive. */
  frontDriveShare: number;
  // ── Slider mapping (a = Front Wing Aero / 100, t = Engine Tier − 1, b = Chassis Balance / 50) ──
  /** mass = massBase + massPerTier · t, kg. */
  massBase: number;
  massPerTier: number;
  /** engineTorque = torqueBase + torquePerTier · t, N·m (whole car). */
  torqueBase: number;
  torquePerTier: number;
  /** drag = dragBase + dragPerAero · a. */
  dragBase: number;
  dragPerAero: number;
  /** frontDownforce = frontWingMax · a. */
  frontWingMax: number;
  /** Tyre grip μ (no slider changes it). */
  traction: number;
  // ── Fixed aero ──
  /** Body lift at the front axle, N per (m/s)²: the front wing has to beat it to keep the nose down. */
  frontBodyLift: number;
  /** Fixed rear downforce at the rear axle, N per (m/s)². */
  rearDownforce: number;
  // ── Drivetrain ──
  /** Driven-wheel radius, m: drive force = engineTorque / driveWheelRadius (every driven wheel has it). */
  driveWheelRadius: number;
  /** Drive force × (1 + (launchBoost − 1) · max(0, 1 − v / launchFadeKmh)); 1 = flat torque. */
  launchBoost: number;
  launchFadeKmh: number;
  /** Rolling-resistance coefficient (top-speed estimate and the game's rolling drag). */
  rollingResistance: number;
  // ── Geometry ──
  /** Axle-to-axle distance, m. */
  wheelbase: number;
  /** Centre-of-mass height above the ground at rest, m. */
  cgHeight: number;
  /** Static front-axle load fraction at balance 0, and how far balance ±1 moves it. */
  frontWeightNeutral: number;
  frontWeightRange: number;
  /** Mean per-wheel spring stiffness (Rapier raycast-vehicle units, mass-normalised). */
  suspensionStiffnessBase: number;
  /** Balance ±1 moves each axle's springs by ±this fraction of the base. */
  suspensionBalanceSplit: number;
  // ── Big jumps (assessBigJump) ──
  /**
   * A map's jump speed (TrackBigJump.requiredKmh, BIG_JUMP_LIP_KMH) is calibrated on the hypercar.
   * This class needs requiredKmh × jumpSpeedScale of ESTIMATED top speed to clear the same jump:
   * it folds in how the class flies (drag-to-mass ratio, downforce pinning it through the lip) and
   * how far below its top speed it reaches the lip from a standing start (wheelspin, front scrub).
   * Measured on the chaos track's 95 m jump. 1 = the hypercar.
   */
  jumpSpeedScale: number;
  /**
   * For a car that is fast enough (estimated top speed ≥ the required speed), the jump verdict is
   * NOSE LIFT when the estimated lift-off speed is below
   * min(top speed + noseLiftReserveKmh, required + noseLiftMarginKmh). Every class uses a large
   * margin (a long run-up brings a car to within a few km/h of its top speed, so any lift-off below
   * it happens) plus a reserve: with lift-off only a little above top speed the nose is so light
   * that the car can't steer through the run-up's kink either. A car that is too slow gets no
   * reserve: NOSE LIFT only when lift-off is below its top speed, otherwise TOO SLOW (same rule as
   * before the garage). The hypercar's physics and estimates are unchanged from before the garage;
   * only its fast-enough verdict changed: it used to call NOSE LIFT only for a lift-off below the
   * required speed, until the integration pass measured its nose lifting at 14–18 % wing / balance 0
   * and 4–9 % / −40, all then estimated READY (see game/README.md "Big jump honesty").
   */
  noseLiftMarginKmh: number;
  noseLiftReserveKmh: number;
}

export type CarClassId = 'hypercar' | 'rally' | 'muscle' | 'formula' | 'buggy' | 'coupe' | 'drift' | 'electric' | 'kart';

/** Garage order. Ids are stable: they are persisted and sent in `game:state.carId`. */
export const CAR_CLASS_IDS: readonly CarClassId[] = ['hypercar', 'rally', 'muscle', 'formula', 'buggy', 'coupe', 'drift', 'electric', 'kart'];

export const DEFAULT_CAR_CLASS_ID: CarClassId = 'hypercar';

export const CAR_CLASSES: { readonly [K in CarClassId]: Readonly<CarClass> } = {
  /**
   * The original wedge-nosed hypercar. Its physics are calibrated against the chaos track's big jump —
   * do not retune them. Its nose-lift rule (12 km/h reserve) was measured on the chaos jump: every
   * setting whose lift-off was less than 10.4 km/h above top speed lifted its nose and ran off.
   */
  hypercar: {
    id: 'hypercar',
    name: 'Neon Hypercar',
    frontDriveShare: 0,
    massBase: 1050,
    massPerTier: 60,
    torqueBase: 700,
    torquePerTier: 700,
    dragBase: 2.98,
    dragPerAero: 1.8,
    frontWingMax: FRONT_WING_DOWNFORCE_MAX,
    traction: BASE_TRACTION,
    frontBodyLift: FRONT_BODY_LIFT,
    rearDownforce: REAR_DOWNFORCE,
    driveWheelRadius: DRIVE_WHEEL_RADIUS,
    launchBoost: 1,
    launchFadeKmh: 0,
    rollingResistance: ROLLING_RESISTANCE,
    wheelbase: WHEELBASE,
    cgHeight: CG_HEIGHT,
    frontWeightNeutral: 0.5,
    frontWeightRange: 0.2,
    suspensionStiffnessBase: SUSPENSION_STIFFNESS_BASE,
    suspensionBalanceSplit: SUSPENSION_BALANCE_SPLIT,
    jumpSpeedScale: 1,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 12,
  },
  /** Light short-wheelbase all-wheel-drive hatch: grippy and nimble, short-geared (lower top speed). */
  rally: {
    id: 'rally',
    name: 'Glitch Rally',
    frontDriveShare: 0.45,
    massBase: 860,
    massPerTier: 40,
    torqueBase: 520,
    torquePerTier: 530,
    dragBase: 2.9,
    dragPerAero: 1.4,
    frontWingMax: 5,
    traction: 1.7,
    frontBodyLift: 1.6,
    rearDownforce: 1.8,
    driveWheelRadius: 0.32,
    launchBoost: 1,
    launchFadeKmh: 0,
    rollingResistance: 0.016,
    wheelbase: 2.45,
    cgHeight: 0.5,
    frontWeightNeutral: 0.56,
    frontWeightRange: 0.18,
    suspensionStiffnessBase: 60,
    suspensionBalanceSplit: 0.36,
    jumpSpeedScale: 1.027,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 10,
  },
  /** Heavy front-engined coupe: huge low-end torque (wheelspin and smoke at any tier), brick-like drag and nose lift. */
  muscle: {
    id: 'muscle',
    name: 'Bruiser V8',
    frontDriveShare: 0,
    massBase: 1400,
    massPerTier: 70,
    torqueBase: 1100,
    torquePerTier: 850,
    dragBase: 4.3,
    dragPerAero: 1.4,
    frontWingMax: 6,
    traction: 1.35,
    frontBodyLift: 3.2,
    rearDownforce: 1.8,
    driveWheelRadius: 0.36,
    launchBoost: 1.8,
    launchFadeKmh: 90,
    rollingResistance: 0.015,
    wheelbase: 2.85,
    cgHeight: 0.52,
    frontWeightNeutral: 0.54,
    frontWeightRange: 0.15,
    suspensionStiffnessBase: 42,
    suspensionBalanceSplit: 0.3,
    jumpSpeedScale: 1.014,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 12,
  },
  /** Featherweight open-wheeler: huge wings, low ride, very stable at speed, twitchy everywhere else. */
  formula: {
    id: 'formula',
    name: 'Razorwing',
    frontDriveShare: 0,
    massBase: 600,
    massPerTier: 35,
    torqueBase: 420,
    torquePerTier: 420,
    dragBase: 1.75,
    dragPerAero: 2.4,
    frontWingMax: 11,
    traction: 1.75,
    frontBodyLift: 1.4,
    rearDownforce: 4.2,
    driveWheelRadius: 0.33,
    launchBoost: 1,
    launchFadeKmh: 0,
    rollingResistance: 0.014,
    wheelbase: 3.0,
    cgHeight: 0.3,
    frontWeightNeutral: 0.45,
    frontWeightRange: 0.2,
    suspensionStiffnessBase: 120,
    suspensionBalanceSplit: 0.4,
    jumpSpeedScale: 1.048,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 8,
  },
  /** Big-wheeled all-wheel-drive desert buggy: long soft suspension, high centre of mass, lands anything, slow. */
  buggy: {
    id: 'buggy',
    name: 'Dune Goblin',
    frontDriveShare: 0.4,
    massBase: 1150,
    massPerTier: 50,
    torqueBase: 800,
    torquePerTier: 420,
    dragBase: 3.6,
    dragPerAero: 1.2,
    frontWingMax: 3,
    traction: 1.3,
    frontBodyLift: 1.2,
    rearDownforce: 1,
    driveWheelRadius: 0.48,
    launchBoost: 1.3,
    launchFadeKmh: 70,
    rollingResistance: 0.02,
    wheelbase: 2.75,
    cgHeight: 0.78,
    frontWeightNeutral: 0.48,
    frontWeightRange: 0.2,
    suspensionStiffnessBase: 26,
    suspensionBalanceSplit: 0.4,
    jumpSpeedScale: 1,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 10,
  },
  /**
   * Red rear-engined road coupe: 60 % of its weight on the back axle, so it hooks up off the line
   * where the hypercar lights its tyres, its nose goes light early at speed (body lift 2.2 against a
   * 5.5 wing: below 40 % wing the front is net-lifting) and its rear slides more than the hypercar's
   * for the same steering (2.4× the rear slip near the limit). Same mass band as the hypercar with a
   * little less torque and drag.
   */
  coupe: {
    id: 'coupe',
    name: 'Ember Swallowtail',
    frontDriveShare: 0,
    massBase: 1160,
    massPerTier: 50,
    torqueBase: 760,
    torquePerTier: 620,
    dragBase: 2.8,
    dragPerAero: 1.5,
    frontWingMax: 5.5,
    traction: 1.5,
    frontBodyLift: 2.2,
    rearDownforce: 2.3,
    driveWheelRadius: 0.35,
    launchBoost: 1,
    launchFadeKmh: 0,
    rollingResistance: 0.015,
    wheelbase: 2.5,
    cgHeight: 0.47,
    frontWeightNeutral: 0.4,
    frontWeightRange: 0.15,
    suspensionStiffnessBase: 55,
    suspensionBalanceSplit: 0.3,
    // Chaos jump, tier 5 (sim): 40 % wing fell at 182.0 at the lip, 36 % cleared at 183.4 → scale 1.02;
    // 20 % / balance 0 (lift-off 11.2 km/h above top speed) ran off before the lip, 24 % cleared → reserve 12.
    jumpSpeedScale: 1.02,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 12,
  },
  /**
   * Long-nosed front-engined drift coupe: low grip (traction 1.28) under a torquey turbo lump with a
   * launch boost, so the rears light up at every tier and keep sliding; a big steering lock and the
   * handbrake (game tuning) hold the slide. Built for the DRIFT button.
   */
  drift: {
    id: 'drift',
    name: 'Smoke Lantern',
    frontDriveShare: 0,
    massBase: 1250,
    massPerTier: 55,
    torqueBase: 900,
    torquePerTier: 650,
    dragBase: 3.1,
    dragPerAero: 1.5,
    frontWingMax: 5,
    traction: 1.28,
    frontBodyLift: 2.6,
    rearDownforce: 1.6,
    driveWheelRadius: 0.34,
    launchBoost: 1.25,
    launchFadeKmh: 60,
    rollingResistance: 0.015,
    wheelbase: 2.65,
    cgHeight: 0.46,
    frontWeightNeutral: 0.53,
    frontWeightRange: 0.18,
    suspensionStiffnessBase: 48,
    suspensionBalanceSplit: 0.36,
    // Chaos jump, tier 5 (sim): 42 % wing (estimated top 187.1) still cleared at 183.0 at the lip → 1.02.
    // Balance −40 is the exception the estimate can't see: with a third of the weight on the rears the
    // drift car spins its tyres all the way up the run-up and reaches the lip at ~165 km/h (short).
    jumpSpeedScale: 1.02,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 12,
  },
  /**
   * Heavy, low, dual-motor all-wheel-drive electric saloon: instant shove from a standstill (launch
   * boost 1.8 fading by 100 km/h, inside the all-wheel grip budget), a flat battery floor (lowest
   * centre of mass of the road cars), slippery, 1.9 t. The easiest car to get to the big jump at
   * tier 5 (tier 4 stays just below the chaos lip speed) and the hardest to stop.
   */
  electric: {
    id: 'electric',
    name: 'Ion Dragonfly',
    frontDriveShare: 0.5,
    massBase: 1900,
    massPerTier: 40,
    torqueBase: 1000,
    torquePerTier: 600,
    dragBase: 2.95,
    dragPerAero: 1.6,
    frontWingMax: 5,
    traction: 1.5,
    frontBodyLift: 1.8,
    rearDownforce: 2.0,
    driveWheelRadius: 0.36,
    launchBoost: 1.8,
    launchFadeKmh: 100,
    rollingResistance: 0.013,
    wheelbase: 2.95,
    cgHeight: 0.36,
    frontWeightNeutral: 0.5,
    frontWeightRange: 0.15,
    suspensionStiffnessBase: 60,
    suspensionBalanceSplit: 0.3,
    // 1.9 t lands the chaos jump from 175 km/h (flies flatter), but on the Isles' short run-up it is
    // the car furthest below its estimated top speed: 95 % wing (estimated 163.2) fell at 152.3 at the
    // lip, 60 % cleared at 160.5 → 1.03 keeps READY inside what the sim lands on both maps.
    jumpSpeedScale: 1.03,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 10,
  },
  /**
   * Tiny single-speed kart: 430 kg, stiff springs (no suspension to speak of), sticky, darts anywhere
   * and tops out around 175 km/h at tier 5 — it can make the Isles leap and never the chaos jump
   * (the garage shows JUMP OUT OF REACH there, like the buggy).
   */
  kart: {
    id: 'kart',
    name: 'Pixel Gnat',
    frontDriveShare: 0,
    massBase: 430,
    massPerTier: 15,
    torqueBase: 260,
    torquePerTier: 250,
    dragBase: 2.0,
    dragPerAero: 1.0,
    frontWingMax: 2.5,
    traction: 1.6,
    frontBodyLift: 0.6,
    rearDownforce: 0.6,
    driveWheelRadius: 0.26,
    launchBoost: 1,
    launchFadeKmh: 0,
    rollingResistance: 0.018,
    wheelbase: 1.5,
    cgHeight: 0.3,
    frontWeightNeutral: 0.42,
    frontWeightRange: 0.15,
    suspensionStiffnessBase: 90,
    suspensionBalanceSplit: 0.3,
    // Isles leap, tier 5 (sim): 18 % wing (estimated top 168.2) fell at 162.5 at the lip, 12 % cleared at
    // 166.2 (a light car slows more in the air) → 1.04. Chaos stays out of reach (max 175.6 vs 190.3).
    jumpSpeedScale: 1.04,
    noseLiftMarginKmh: 1000,
    noseLiftReserveKmh: 8,
  },
};

/** A car for the helpers below: a class id (unknown ids → hypercar), a class object, or nothing (→ hypercar). */
export type CarClassRef = string | Readonly<CarClass> | null | undefined;

export function isCarClassId(value: unknown): value is CarClassId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CAR_CLASSES, value);
}

/** The class for a car ref; anything unknown (old clients, typos, a newer game's car) is the hypercar. */
export function getCarClass(car?: CarClassRef): Readonly<CarClass> {
  if (typeof car === 'object' && car !== null) return car;
  return isCarClassId(car) ? CAR_CLASSES[car] : CAR_CLASSES[DEFAULT_CAR_CLASS_ID];
}

/**
 * THE mapping from dashboard sliders to car physics. Pure and deterministic, so
 * the dashboard can preview exactly what the game will apply.
 *
 * For the default car (hypercar):
 *   Front Wing Aero (a = 0…1): frontDownforce 0→6.5 (body lift is 2.7, so < ~42 % nets lift), drag 2.98→4.78
 *   Engine Tier     (t = 1…5): rear-axle torque 700→3500 N·m, mass +60 kg per tier
 *   Chassis Balance (b = −1…1): balance passthrough → centre of mass + suspension stiffness split
 * Other classes use the same formulas with their own CarClass coefficients.
 *
 * At the default sliders (50 / 3 / 0) the hypercar yields DEFAULT_CAR_PHYSICS.
 */
export function mapSquadControlsToPhysics(input: SquadControls, car?: CarClassRef): CarPhysicsParams {
  const k = getCarClass(car);
  const c = clampSquadControls(input);
  const a = c.frontWingAero / 100;
  const tierSteps = c.engineTier - 1;
  const b = c.chassisBalance / 50;
  return clampPhysics({
    mass: round(k.massBase + k.massPerTier * tierSteps, 1),
    traction: k.traction,
    drag: round(k.dragBase + k.dragPerAero * a, 3),
    frontDownforce: round(k.frontWingMax * a, 3),
    engineTorque: round(k.torqueBase + k.torquePerTier * tierSteps, 1),
    balance: round(b, 3),
  });
}

/** The hypercar at the default sliders. */
export const DEFAULT_CAR_PHYSICS: Readonly<CarPhysicsParams> = Object.freeze(
  mapSquadControlsToPhysics(DEFAULT_SQUAD_CONTROLS),
);

/** A car's physics at the default sliders (50 / 3 / 0). */
export function defaultPhysicsFor(car?: CarClassRef): CarPhysicsParams {
  return mapSquadControlsToPhysics(DEFAULT_SQUAD_CONTROLS, car);
}

/**
 * Fraction of static weight carried by the front axle for a balance value.
 * Hypercar: −1 → 0.70 (70 % front), 0 → 0.50, +1 → 0.30 (70 % rear).
 * The game derives its centre-of-mass shift from this so every UI agrees.
 */
export function balanceToFrontWeightFraction(balance: number, car?: CarClassRef): number {
  const k = getCarClass(car);
  return k.frontWeightNeutral - k.frontWeightRange * clamp(balance, -1, 1);
}

/** Display helper: chassisBalance (−50…50) → e.g. { front: 60, rear: 40 } in percent. */
export function describeChassisBalance(chassisBalance: number, car?: CarClassRef): { front: number; rear: number } {
  const front = Math.round(balanceToFrontWeightFraction(chassisBalance / 50, car) * 100);
  return { front, rear: 100 - front };
}

/**
 * Per-wheel suspension stiffness for a balance value: the heavier end gets stiffer springs.
 * Hypercar: −1 → front ×1.4 / rear ×0.6, +1 → front ×0.6 / rear ×1.4 (SUSPENSION_BALANCE_SPLIT = 0.4).
 * A class whose neutral weight is not 50/50 starts from springs split in proportion to that.
 */
export function balanceToSuspensionStiffness(balance: number, car?: CarClassRef): { front: number; rear: number } {
  const k = getCarClass(car);
  const b = clamp(balance, -1, 1);
  const bias = 2 * k.frontWeightNeutral - 1;
  return {
    front: k.suspensionStiffnessBase * (1 + bias - k.suspensionBalanceSplit * b),
    rear: k.suspensionStiffnessBase * (1 - bias + k.suspensionBalanceSplit * b),
  };
}

/** Contact-patch drive force in N at top-end torque (all driven wheels together). */
export function driveForceN(p: CarPhysicsParams, car?: CarClassRef): number {
  return p.engineTorque / getCarClass(car).driveWheelRadius;
}

/** Drive force in N at a forward speed (m/s), including the class's low-speed launch boost. */
export function driveForceAtSpeedN(p: CarPhysicsParams, forwardSpeedMs: number, car?: CarClassRef): number {
  const k = getCarClass(car);
  const force = driveForceN(p, k);
  if (k.launchBoost <= 1 || k.launchFadeKmh <= 0) return force;
  const fade = Math.max(0, 1 - (Math.abs(forwardSpeedMs) * 3.6) / k.launchFadeKmh);
  return force * (1 + (k.launchBoost - 1) * fade);
}

/** Net vertical aero force at the front axle in N (+ = downforce, − = lift) at a forward speed in m/s. */
export function frontAeroForceN(p: CarPhysicsParams, forwardSpeedMs: number, car?: CarClassRef): number {
  return (p.frontDownforce - getCarClass(car).frontBodyLift) * forwardSpeedMs * forwardSpeedMs;
}

/** Rear downforce at the rear axle in N at a forward speed in m/s. */
export function rearAeroForceN(forwardSpeedMs: number, car?: CarClassRef): number {
  return getCarClass(car).rearDownforce * forwardSpeedMs * forwardSpeedMs;
}

/**
 * Rough steady-state top speed: driveForce = drag·v² + Crr·m·g.
 * Preview only — the real number emerges from the game's simulation.
 */
export function estimateTopSpeedKmh(p: CarPhysicsParams, car?: CarClassRef): number {
  const k = getCarClass(car);
  const resist = k.rollingResistance * p.mass * GRAVITY;
  const net = Math.max(0, driveForceN(p, k) - resist);
  if (p.drag <= 1e-6) return Infinity;
  const v = Math.sqrt(net / p.drag);
  if (k.launchBoost <= 1 || k.launchFadeKmh <= 0 || v * 3.6 >= k.launchFadeKmh) return v * 3.6;
  // Tops out inside the boosted band: drag·v² = F·(1 + (B − 1)(1 − v/vf)) − R, a quadratic in v.
  const force = driveForceN(p, k);
  const vf = k.launchFadeKmh / 3.6;
  const beta = (force * (k.launchBoost - 1)) / vf;
  const c = force * k.launchBoost - resist;
  if (c <= 0) return 0;
  return ((-beta + Math.sqrt(beta * beta + 4 * p.drag * c)) / (2 * p.drag)) * 3.6;
}

/**
 * Speed (km/h) above which net front lift exceeds the front-axle load at full throttle, i.e. the
 * nose leaves the ground. null if the front wing out-pulls body lift (never lifts); 0 if the
 * drive torque alone unloads the front axle. Estimate — ignores the drag pitch moment.
 */
export function estimateFrontLiftOffKmh(p: CarPhysicsParams, car?: CarClassRef): number | null {
  const k = getCarClass(car);
  const netLift = k.frontBodyLift - p.frontDownforce;
  if (netLift <= 1e-6) return null;
  const staticFrontLoad = p.mass * GRAVITY * balanceToFrontWeightFraction(p.balance, k);
  const frontLoad = staticFrontLoad - (driveForceN(p, k) * k.cgHeight) / k.wheelbase;
  if (frontLoad <= 0) return 0;
  const v = Math.sqrt(frontLoad / netLift);
  if (k.launchBoost <= 1 || k.launchFadeKmh <= 0 || v * 3.6 >= k.launchFadeKmh) return v * 3.6;
  // Lifts inside the boosted band, where the extra drive force moves more load off the nose:
  // netLift·v² = staticFrontLoad − F(v)·h/L with F linear in v — a quadratic with one positive root.
  const lever = k.cgHeight / k.wheelbase;
  const force = driveForceN(p, k);
  const c = lever * force * k.launchBoost - staticFrontLoad;
  if (c >= 0) return 0;
  const beta = (lever * force * (k.launchBoost - 1)) / (k.launchFadeKmh / 3.6);
  return ((beta + Math.sqrt(beta * beta - 4 * netLift * c)) / (2 * netLift)) * 3.6;
}

/**
 * Estimated top speed this car needs for a map's big jump: the map's requirement (calibrated on
 * the hypercar; default BIG_JUMP_LIP_KMH) × the class's jumpSpeedScale. For the hypercar it is the
 * map's number unchanged.
 */
export function requiredJumpKmh(mapRequiredKmh?: number | null, car?: CarClassRef): number {
  const base = isFiniteNumber(mapRequiredKmh) && mapRequiredKmh > 0 ? mapRequiredKmh : BIG_JUMP_LIP_KMH;
  return base * getCarClass(car).jumpSpeedScale;
}

export interface BigJumpAssessment {
  /** True when the estimate says the car can carry `requiredKmh` to the lip with its nose down. */
  ready: boolean;
  topSpeedKmh: number;
  liftOffKmh: number | null;
  /** What this car needs (requiredJumpKmh: the map's requirement × the class's jumpSpeedScale). */
  requiredKmh: number;
  /** Human-readable verdict, e.g. 'TOO SLOW', 'NOSE LIFT', 'READY'. */
  verdict: 'READY' | 'TOO SLOW' | 'NOSE LIFT';
}

/**
 * Will this setup clear a big jump? Estimate only (the game is the source of truth).
 * `car` defaults to the hypercar; `requiredKmh` is the MAP's jump speed (default BIG_JUMP_LIP_KMH,
 * the chaos track's jump — a map reports its own in `game:state.bigJumpKmh`), scaled for the car by
 * requiredJumpKmh.
 */
export function assessBigJump(
  p: CarPhysicsParams,
  car?: CarClassRef,
  requiredKmh: number | null = BIG_JUMP_LIP_KMH,
): BigJumpAssessment {
  const k = getCarClass(car);
  const topSpeedKmh = estimateTopSpeedKmh(p, k);
  const liftOffKmh = estimateFrontLiftOffKmh(p, k);
  const required = requiredJumpKmh(requiredKmh, k);
  // The nose can only lift if the car actually reaches lift-off speed on the run-up.
  //   - Fast enough (top ≥ required): the long run-up brings the car to within a few km/h of its top
  //     speed, so a lift-off below top speed + the class's reserve counts (with lift-off only a little
  //     above top speed the nose is too light to steer through the run-up's kink).
  //   - Too slow (top < required): no reserve. Only a lift-off below top speed (which the car does
  //     reach) is NOSE LIFT; a car that tops out below both speeds is simply TOO SLOW (more wing,
  //     the NOSE LIFT advice, would only make it slower).
  const noseLiftBelowKmh = topSpeedKmh >= required
    ? Math.min(topSpeedKmh + k.noseLiftReserveKmh, required + k.noseLiftMarginKmh)
    : Math.min(topSpeedKmh, required);
  let verdict: BigJumpAssessment['verdict'] = 'READY';
  if (liftOffKmh !== null && liftOffKmh < noseLiftBelowKmh) verdict = 'NOSE LIFT';
  else if (topSpeedKmh < required) verdict = 'TOO SLOW';
  return { ready: verdict === 'READY', topSpeedKmh, liftOffKmh, requiredKmh: required, verdict };
}

// ─────────────────────────────────────────────────────────────────────────────
// Game → dashboard telemetry
// ─────────────────────────────────────────────────────────────────────────────

export interface GameTelemetry {
  /** Forward speed, km/h (≥ 0). */
  speedKmh: number;
  /** Number of wheels touching ground (0…4). */
  wheelsGrounded: number;
  /** Index of the last checkpoint reached (0 = start). */
  checkpoint: number;
  /** Total checkpoints including the finish line. */
  totalCheckpoints: number;
  /** Elapsed run time in ms (0 before the first throttle input). */
  elapsedMs: number;
  /** Times the car fell into the pit this run. */
  falls: number;
  /** True once the finish line was crossed. */
  finished: boolean;
  /** Best finish time in ms, or null if none yet. */
  bestMs: number | null;
  // ── Race telemetry channels (optional on the wire; parseMessage fills the defaults shown) ──
  /** Throttle pedal 0…1 (default 0). */
  throttle: number;
  /** Brake pedal 0…1 (default 0). */
  brake: number;
  /** Net vertical aero force at the front axle, N: + downforce, − lift (default 0). */
  frontAeroN: number;
  /** Vertical aero force at the rear axle, N (default 0). */
  rearAeroN: number;
  /** True while aero lift has the front wheels off the ground (default false). */
  noseLift: boolean;
  /** Rear tyre slip intensity 0…1 — tyre smoke when high (default 0). */
  rearSlip: number;
  /** Speed at the big-jump lip on the latest attempt, km/h, or null (default null). */
  speedTrapKmh: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

export interface Envelope {
  v: typeof PROTOCOL_VERSION;
  /** Sender-local monotonically increasing counter (optional). */
  seq?: number;
  /** Sender wall-clock, epoch ms (optional). */
  sentAt?: number;
  /** Set by the server on relayed frames: the originating client's id. */
  from?: string;
}

// Client → server ------------------------------------------------------------

/** First frame a client should send. Role may also be given as `?role=` in the URL. */
export interface HelloMessage extends Envelope {
  type: 'hello';
  role: ClientRole;
  /** Free-form display name, ≤ 40 chars. */
  name?: string;
}

/** Dashboard → everyone: the full, exact slider values. Always all three keys. */
export interface SquadControlsMessage extends Envelope {
  type: 'squad:controls';
  controls: SquadControls;
}

/** Anyone → games: directly patch one or more physics params (debug / scripting). */
export interface PhysicsSetMessage extends Envelope {
  type: 'physics:set';
  params: Partial<CarPhysicsParams>;
}

/**
 * What the game is playing. Optional on the wire: games from before the garage send none of it
 * (treat a missing `carId` as DEFAULT_CAR_CLASS_ID and a missing `bigJumpKmh` as BIG_JUMP_LIP_KMH).
 */
export interface GameSessionInfo {
  /** Car class id (CAR_CLASSES key). A valid id this protocol version doesn't know is passed through: use getCarClass(). */
  carId?: string;
  /** Map id (the game's track catalog). */
  trackId?: string;
  /** Lip speed the current map's big jump needs, km/h; null = this map has no big jump. */
  bigJumpKmh?: number | null;
  /** Name of the driver at the wheel (the game's DRIVERS tab), ≤ MAX_DISPLAY_TEXT code points; absent = not reported. */
  driverName?: string;
  /** Name of the mounted custom car (MY RIDE), ≤ MAX_DISPLAY_TEXT; absent = the stock car of `carId`. */
  rideName?: string;
}

/** Game → dashboards: the physics params the car is actually running right now (+ which car, on which map). */
export interface GameStateMessage extends Envelope, GameSessionInfo {
  type: 'game:state';
  physics: CarPhysicsParams;
  /** The squad controls the game last applied, or null if never. */
  controls: SquadControls | null;
}

/** Game → dashboards: live telemetry, ~10 Hz. */
export interface GameTelemetryMessage extends Envelope {
  type: 'game:telemetry';
  telemetry: GameTelemetry;
}

/** Anyone → server: latency probe. Server answers the sender only with `pong`. */
export interface PingMessage extends Envelope {
  type: 'ping';
  nonce: number;
}

export type ClientMessage =
  | HelloMessage
  | SquadControlsMessage
  | PhysicsSetMessage
  | GameStateMessage
  | GameTelemetryMessage
  | PingMessage
  | RoomClientMessage;

// Server → client ------------------------------------------------------------

export interface PeerCounts {
  game: number;
  dashboard: number;
  observer: number;
}

export interface ServerSnapshot {
  /** Last `squad:controls` any client sent, or null. */
  controls: SquadControls | null;
  /** Last `game:state.physics` a game reported, or null. */
  physics: CarPhysicsParams | null;
  /** Last `game:telemetry` a game reported, or null. */
  telemetry: GameTelemetry | null;
  /**
   * carId / trackId / bigJumpKmh from the last `game:state` that carried any of them. Absent until
   * then (and from relays older than the garage).
   */
  session?: GameSessionInfo;
}

/** Sent once, immediately after the socket opens (and again after a `hello` changes role). */
export interface WelcomeMessage extends Envelope {
  type: 'server:welcome';
  clientId: string;
  role: ClientRole;
  protocolVersion: typeof PROTOCOL_VERSION;
  snapshot: ServerSnapshot;
  peers: PeerCounts;
}

/** Broadcast to everyone whenever a client joins, leaves or changes role. */
export interface PresenceMessage extends Envelope {
  type: 'server:presence';
  peers: PeerCounts;
}

export interface ErrorMessage extends Envelope {
  type: 'server:error';
  code: 'bad_message' | 'too_large' | 'rate_limited' | 'forbidden';
  message: string;
}

export interface PongMessage extends Envelope {
  type: 'pong';
  nonce: number;
  serverTime: number;
}

export type ServerMessage = WelcomeMessage | PresenceMessage | ErrorMessage | PongMessage | RoomServerMessage;

/** Anything that can appear on the wire (server relays client frames with `from` set). */
export type ProtocolMessage = ClientMessage | ServerMessage;
export type MessageType = ProtocolMessage['type'];

/** Distributive Omit so `encodeMessage({ type: 'squad:controls', controls })` type-checks per variant. */
export type OutgoingMessage<M extends ProtocolMessage = ProtocolMessage> = M extends ProtocolMessage
  ? Omit<M, 'v'> & { v?: typeof PROTOCOL_VERSION }
  : never;

// ─────────────────────────────────────────────────────────────────────────────
// Rooms (room.v1) — "play with friends" over the same relay
// ─────────────────────────────────────────────────────────────────────────────
//
// Additive to protocol v1: a relay or client that predates rooms ignores these frames (parseMessage
// returns null for an unknown type, and the old relay answers `bad_message`). A game joins a room
// on the socket it already keeps open for the dashboard; `game:state` / `squad:controls` keep
// working unchanged, so the dashboard still tunes every car in the room.
//
//   room:create {name, carId, look, plate, avatar}  → room:joined {code, you, players, race, serverNow}
//   room:join   {code, …same identity}              → room:joined, and room:players to the others
//   room:update {…identity}                         → room:players to everyone in the room
//   room:ready  {ready}                             → room:players to everyone in the room
//   room:pose   {t, p, q, s, st, g, pm}             → fanned out to the OTHER members (id + from stamped),
//                                                     dropped above ROOM_POSE_MAX_HZ per sender
//   room:race   {phase, track, startAt, results}    → host only; the relay owns `results` (see below)
//   room:finish {finishMs, falls}                   → recorded in race.results; room:race to everyone
//   room:ping   {t, rtt?}                           → room:pong {t, serverNow} to the sender only
//   room:leave                                      → room:left to the sender, room:players to the rest
//   relay → room:error {code, message} to the offender; room:left {reason} when a room ends.
//
// Host = the creator; when the host leaves, the member who joined earliest becomes host (the relay
// broadcasts room:players with the new isHost flags). Results are owned by the relay so every
// member shows the same table: a host's `room:race` with phase 'countdown' resets them to every
// present member with finishMs null; each `room:finish` fills one row; rows of members who leave
// stay. Room codes: ROOM_CODE_LENGTH letters from ROOM_CODE_ALPHABET (no vowels, no I/O, no digits).

export const ROOM_PROTOCOL = 'room.v1' as const;
/** 20 letters: no vowels (no accidental words), no I / O (look like 1 / 0). */
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_MAX_PLAYERS = 8;
/** The relay keeps at most this many rooms alive (memory bound). */
export const ROOM_MAX_ROOMS = 64;
/** A room nobody has talked in for this long is deleted. */
export const ROOM_IDLE_EXPIRY_MS = 2 * 60 * 60 * 1000;
/** Pose cadence a client should use (~15 Hz) and the ceiling the relay enforces per sender. */
export const ROOM_POSE_INTERVAL_MS = 66;
export const ROOM_POSE_MAX_HZ = 30;
/** START → lights: the host sets startAt = serverNow + this. */
export const ROOM_COUNTDOWN_LEAD_MS = 4000;
/** The host closes a race this long after the first finisher if someone is still driving. */
export const ROOM_RESULTS_GRACE_MS = 60_000;
/** Longest share code accepted as a look / avatar on the wire. */
export const ROOM_MAX_CODE_LENGTH = 200;
/** Longest plate text on the wire (A–Z, 0–9, space). */
export const ROOM_MAX_PLATE = 14;

export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'results';
export const ROOM_PHASES: readonly RoomPhase[] = ['lobby', 'countdown', 'racing', 'results'];

export function isRoomPhase(value: unknown): value is RoomPhase {
  return typeof value === 'string' && (ROOM_PHASES as readonly string[]).includes(value);
}

/** What a player looks like to the others (cosmetic; physics stays local to each game). */
export interface RoomIdentity {
  /** Display name (sanitizeDisplayText; the relay substitutes a default for an empty one). */
  name: string;
  /** Car class id (sanitizeId). */
  carId: string;
  /** MY RIDE share code (`RIDE1-…`, game/src/ride/shareCode.ts) worn by the car, or null for the stock look. */
  look: string | null;
  /** Number plate text, ≤ ROOM_MAX_PLATE of A–Z 0–9 space; '' = the car's default plate. */
  plate: string;
  /** Driver share code (`DRV1-…`, game/src/drivers/shareCode.ts) for the avatar, or null. */
  avatar: string | null;
}

export interface RoomPlayer extends RoomIdentity {
  /** The relay client id of this player (also the `id` on its poses). */
  id: string;
  ready: boolean;
  isHost: boolean;
  /** Round trip to the relay in ms as the player last reported it (room:ping.rtt), or null. */
  ping: number | null;
}

export interface RoomResult {
  id: string;
  name: string;
  /** Run time in ms, or null while still driving (or never finished). */
  finishMs: number | null;
  falls: number;
}

export interface RoomRace {
  phase: RoomPhase;
  /** Track id everyone drives (the host's selection), or null before the host picked one. */
  track: string | null;
  /** Relay-clock ms of GO; null outside 'countdown' / 'racing' / 'results'. */
  startAt: number | null;
  results: RoomResult[];
}

/** One car pose, ~15 Hz. Quantized on the wire (parseMessage): p 1 cm, q 1e-4, s 0.1 km/h, st 0.01, pm 0.1 m. */
export interface RoomPose {
  /** Sender's player id. Stamped by the relay on fan-out; ignored when a client sets it. */
  id: string;
  /** Sender's relay-clock time of the sample, ms. */
  t: number;
  p: [number, number, number];
  q: [number, number, number, number];
  /** Speed, km/h. */
  s: number;
  /** Steer −1…1. */
  st: number;
  /** Index of the last gate passed. */
  g: number;
  /** Progress along the race route, m. */
  pm: number;
}

// Client → relay
export interface RoomCreateMessage extends Envelope, RoomIdentity {
  type: 'room:create';
}
export interface RoomJoinMessage extends Envelope, RoomIdentity {
  type: 'room:join';
  code: string;
}
export interface RoomUpdateMessage extends Envelope, RoomIdentity {
  type: 'room:update';
}
export interface RoomLeaveMessage extends Envelope {
  type: 'room:leave';
}
export interface RoomReadyMessage extends Envelope {
  type: 'room:ready';
  ready: boolean;
}
/** A client sends a pose without `id`; the relay fans it out with `id` (and `from`) = the sender. */
export interface RoomPoseMessage extends Envelope, Omit<RoomPose, 'id'> {
  type: 'room:pose';
  id?: string;
}
/** Host → relay → everyone. The relay overwrites `results` with its own (see the section comment). */
export interface RoomRaceMessage extends Envelope, RoomRace {
  type: 'room:race';
}
export interface RoomFinishMessage extends Envelope {
  type: 'room:finish';
  finishMs: number;
  falls: number;
}
export interface RoomPingMessage extends Envelope {
  type: 'room:ping';
  /** Sender's local clock (performance.now() or Date.now()), echoed back. */
  t: number;
  /** The sender's last measured round trip, ms (shown to the others as `ping`). */
  rtt?: number;
}

export type RoomClientMessage =
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomUpdateMessage
  | RoomLeaveMessage
  | RoomReadyMessage
  | RoomPoseMessage
  | RoomRaceMessage
  | RoomFinishMessage
  | RoomPingMessage;

// Relay → client
export interface RoomJoinedMessage extends Envelope {
  type: 'room:joined';
  code: string;
  /** The receiver's own player id. */
  you: string;
  players: RoomPlayer[];
  race: RoomRace;
  /** Relay clock (Date.now()) when this frame was sent. */
  serverNow: number;
}
export interface RoomPlayersMessage extends Envelope {
  type: 'room:players';
  players: RoomPlayer[];
}
export type RoomLeftReason = 'left' | 'expired' | 'closed';
export interface RoomLeftMessage extends Envelope {
  type: 'room:left';
  reason: RoomLeftReason;
}
export type RoomErrorCode =
  | 'bad_code'
  | 'not_found'
  | 'full'
  | 'rooms_full'
  | 'already_in_room'
  | 'not_in_room'
  | 'not_host'
  | 'bad_state';
export const ROOM_ERROR_CODES: readonly RoomErrorCode[] = ['bad_code', 'not_found', 'full', 'rooms_full', 'already_in_room', 'not_in_room', 'not_host', 'bad_state'];
export interface RoomErrorMessage extends Envelope {
  type: 'room:error';
  code: RoomErrorCode;
  message: string;
}
export interface RoomPongMessage extends Envelope {
  type: 'room:pong';
  t: number;
  serverNow: number;
}

export type RoomServerMessage =
  | RoomJoinedMessage
  | RoomPlayersMessage
  | RoomLeftMessage
  | RoomErrorMessage
  | RoomPongMessage
  // The relay also sends room:pose (fan-out) and room:race (broadcast) — the client shapes above.
  | RoomPoseMessage
  | RoomRaceMessage;

export const ROOM_CLIENT_TYPES: readonly RoomClientMessage['type'][] = [
  'room:create',
  'room:join',
  'room:update',
  'room:leave',
  'room:ready',
  'room:pose',
  'room:race',
  'room:finish',
  'room:ping',
];

/**
 * Server routing table (implemented in server/, documented here so clients agree):
 *
 *   hello           → updates sender role; server re-sends `server:welcome` to sender, broadcasts presence
 *   squad:controls  → stored as snapshot.controls; relayed to every OTHER client
 *   physics:set     → relayed to every OTHER client (games apply it, others may display it)
 *   game:state      → stored as snapshot.physics (+ snapshot.session); relayed to every non-game client
 *   game:telemetry  → stored as snapshot.telemetry; relayed to every non-game client
 *   ping            → `pong` to sender only
 *   server:*, pong  → never accepted from clients (answered with `server:error` code `forbidden`)
 *
 * A relayed frame never goes back to its own sender, whichever rule applies.
 */
export const RELAY_RULES = {
  'squad:controls': 'others',
  'physics:set': 'others',
  'game:state': 'non-game',
  'game:telemetry': 'non-game',
} as const satisfies Partial<Record<MessageType, 'others' | 'non-game'>>;

// ─────────────────────────────────────────────────────────────────────────────
// Numeric helpers
// ─────────────────────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Snap to the spec's step grid (anchored at min) and clamp into range. */
export function snapToSpec(value: number, spec: RangeSpec): number {
  const clamped = clamp(value, spec.min, spec.max);
  const steps = Math.round((clamped - spec.min) / spec.step);
  const decimals = Math.max(0, -Math.floor(Math.log10(spec.step)) + 1);
  return clamp(round(spec.min + steps * spec.step, decimals), spec.min, spec.max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clampSquadControls(c: SquadControls): SquadControls {
  return {
    frontWingAero: snapToSpec(c.frontWingAero, SQUAD_CONTROL_SPECS.frontWingAero),
    engineTier: snapToSpec(c.engineTier, SQUAD_CONTROL_SPECS.engineTier),
    chassisBalance: snapToSpec(c.chassisBalance, SQUAD_CONTROL_SPECS.chassisBalance),
  };
}

/** Clamp (not snap) — physics params are continuous; the step is a UI hint. */
export function clampPhysics(p: CarPhysicsParams): CarPhysicsParams {
  const out = {} as CarPhysicsParams;
  for (const key of CAR_PHYSICS_KEYS) {
    const spec = CAR_PHYSICS_SPECS[key];
    out[key] = clamp(p[key], spec.min, spec.max);
  }
  return out;
}

export function squadControlsEqual(a: SquadControls | null, b: SquadControls | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return SQUAD_CONTROL_KEYS.every((k) => a[k] === b[k]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validators — return a clean copy or null. Unknown keys are dropped.
// ─────────────────────────────────────────────────────────────────────────────

/** All three keys required (the dashboard always sends a full snapshot). */
export function sanitizeSquadControls(input: unknown): SquadControls | null {
  if (!isRecord(input)) return null;
  const out = {} as SquadControls;
  for (const key of SQUAD_CONTROL_KEYS) {
    const value = input[key];
    if (!isFiniteNumber(value)) return null;
    out[key] = snapToSpec(value, SQUAD_CONTROL_SPECS[key]);
  }
  return out;
}

/** At least one valid key required. Values are clamped into CAR_PHYSICS_SPECS ranges. */
export function sanitizePhysicsPatch(input: unknown): Partial<CarPhysicsParams> | null {
  if (!isRecord(input)) return null;
  const out: Partial<CarPhysicsParams> = {};
  let any = false;
  for (const key of CAR_PHYSICS_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value)) return null;
    const spec = CAR_PHYSICS_SPECS[key];
    out[key] = clamp(value, spec.min, spec.max);
    any = true;
  }
  return any ? out : null;
}

/** All keys required. */
export function sanitizePhysics(input: unknown): CarPhysicsParams | null {
  const patch = sanitizePhysicsPatch(input);
  if (!patch) return null;
  for (const key of CAR_PHYSICS_KEYS) if (patch[key] === undefined) return null;
  return patch as CarPhysicsParams;
}

export function sanitizeTelemetry(input: unknown): GameTelemetry | null {
  if (!isRecord(input)) return null;
  const { speedKmh, wheelsGrounded, checkpoint, totalCheckpoints, elapsedMs, falls, finished, bestMs } = input;
  if (
    !isFiniteNumber(speedKmh) ||
    !isFiniteNumber(wheelsGrounded) ||
    !isFiniteNumber(checkpoint) ||
    !isFiniteNumber(totalCheckpoints) ||
    !isFiniteNumber(elapsedMs) ||
    !isFiniteNumber(falls) ||
    typeof finished !== 'boolean' ||
    !(bestMs === null || isFiniteNumber(bestMs))
  ) {
    return null;
  }
  const optNumber = (value: unknown, min: number, max: number, fallback: number): number =>
    isFiniteNumber(value) ? clamp(value, min, max) : fallback;
  return {
    speedKmh: clamp(speedKmh, 0, 2000),
    wheelsGrounded: clamp(Math.round(wheelsGrounded), 0, 4),
    checkpoint: clamp(Math.round(checkpoint), 0, 10_000),
    totalCheckpoints: clamp(Math.round(totalCheckpoints), 0, 10_000),
    elapsedMs: clamp(elapsedMs, 0, 1e9),
    falls: clamp(Math.round(falls), 0, 1e6),
    finished,
    bestMs: bestMs === null ? null : clamp(bestMs, 0, 1e9),
    throttle: optNumber(input.throttle, 0, 1, 0),
    brake: optNumber(input.brake, 0, 1, 0),
    frontAeroN: optNumber(input.frontAeroN, -1e6, 1e6, 0),
    rearAeroN: optNumber(input.rearAeroN, -1e6, 1e6, 0),
    noseLift: input.noseLift === true,
    rearSlip: optNumber(input.rearSlip, 0, 1, 0),
    speedTrapKmh: isFiniteNumber(input.speedTrapKmh) ? clamp(input.speedTrapKmh, 0, 2000) : null,
  };
}

/** Longest id accepted in carId / trackId. */
export const MAX_ID_LENGTH = 32;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** A car / track id: 1–32 characters of letters, digits, `_`, `.` and `-` (starting with a letter or digit). */
export function sanitizeId(input: unknown): string | null {
  return typeof input === 'string' && input.length <= MAX_ID_LENGTH && ID_PATTERN.test(input) ? input : null;
}

/**
 * The optional session fields of a `game:state` (or `snapshot.session`). Missing fields stay
 * missing; a field that is present but malformed makes the whole thing invalid (null).
 */
export function sanitizeGameSession(input: unknown): GameSessionInfo | null {
  if (!isRecord(input)) return null;
  const out: GameSessionInfo = {};
  if (input.carId !== undefined) {
    const carId = sanitizeId(input.carId);
    if (carId === null) return null;
    out.carId = carId;
  }
  if (input.trackId !== undefined) {
    const trackId = sanitizeId(input.trackId);
    if (trackId === null) return null;
    out.trackId = trackId;
  }
  if (input.bigJumpKmh !== undefined) {
    if (input.bigJumpKmh === null) out.bigJumpKmh = null;
    else if (isFiniteNumber(input.bigJumpKmh) && input.bigJumpKmh > 0) out.bigJumpKmh = clamp(input.bigJumpKmh, 1, 2000);
    else return null;
  }
  // Driver / ride names: a non-string invalidates (like a bad id); a string is cleaned, and an
  // empty result is simply left out.
  if (input.driverName !== undefined) {
    const driverName = sanitizeDisplayText(input.driverName);
    if (driverName === null) return null;
    if (driverName) out.driverName = driverName;
  }
  if (input.rideName !== undefined) {
    const rideName = sanitizeDisplayText(input.rideName);
    if (rideName === null) return null;
    if (rideName) out.rideName = rideName;
  }
  return out;
}

/** Longest driver / ride name on the wire (code points, not UTF-16 units). */
export const MAX_DISPLAY_TEXT = 14;
// Controls, format (bidi overrides, zero-width), surrogates, private-use and unassigned code points, markup characters.
const DISPLAY_TEXT_BAD = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}<>&"'`\\]/gu;

/**
 * A driver / ride name for display: any script, no control / format / markup characters, runs of
 * spaces collapsed, cut to MAX_DISPLAY_TEXT code points. '' when nothing survives; null for a
 * non-string (the caller treats that as a malformed message).
 */
export function sanitizeDisplayText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.normalize('NFKC').replace(DISPLAY_TEXT_BAD, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_DISPLAY_TEXT).join('').trim();
}

function sanitizePeers(input: unknown): PeerCounts | null {
  if (!isRecord(input)) return null;
  const out = {} as PeerCounts;
  for (const role of CLIENT_ROLES) {
    const n = input[role];
    if (!isFiniteNumber(n) || n < 0) return null;
    out[role] = Math.round(n);
  }
  return out;
}

function sanitizeEnvelope(input: Record<string, unknown>): Envelope {
  const env: Envelope = { v: PROTOCOL_VERSION };
  if (isFiniteNumber(input.seq)) env.seq = input.seq;
  if (isFiniteNumber(input.sentAt)) env.sentAt = input.sentAt;
  if (typeof input.from === 'string' && input.from.length <= 64) env.from = input.from;
  return env;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encode / decode
// ─────────────────────────────────────────────────────────────────────────────

/** Serialize a message, stamping `v`. */
export function encodeMessage(message: OutgoingMessage): string {
  return JSON.stringify({ ...message, v: PROTOCOL_VERSION });
}

/**
 * Parse + validate one frame. Returns a sanitized message (values clamped and
 * snapped, unknown fields dropped) or null if the frame is not a valid v1 message.
 * Frames whose `v` is present and not 1 are rejected.
 */
export function parseMessage(raw: unknown): ProtocolMessage | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || typeof data.type !== 'string') return null;
  if (data.v !== undefined && data.v !== PROTOCOL_VERSION) return null;
  const env = sanitizeEnvelope(data);

  switch (data.type) {
    case 'hello': {
      if (!isClientRole(data.role)) return null;
      const msg: HelloMessage = { ...env, type: 'hello', role: data.role };
      if (typeof data.name === 'string') msg.name = data.name.slice(0, 40);
      return msg;
    }
    case 'squad:controls': {
      const controls = sanitizeSquadControls(data.controls);
      return controls ? { ...env, type: 'squad:controls', controls } : null;
    }
    case 'physics:set': {
      const params = sanitizePhysicsPatch(data.params);
      return params ? { ...env, type: 'physics:set', params } : null;
    }
    case 'game:state': {
      const physics = sanitizePhysics(data.physics);
      if (!physics) return null;
      let controls: SquadControls | null = null;
      if (data.controls !== null && data.controls !== undefined) {
        controls = sanitizeSquadControls(data.controls);
        if (!controls) return null;
      }
      const session = sanitizeGameSession(data);
      if (!session) return null;
      return { ...env, type: 'game:state', physics, controls, ...session };
    }
    case 'game:telemetry': {
      const telemetry = sanitizeTelemetry(data.telemetry);
      return telemetry ? { ...env, type: 'game:telemetry', telemetry } : null;
    }
    case 'ping': {
      return isFiniteNumber(data.nonce) ? { ...env, type: 'ping', nonce: data.nonce } : null;
    }
    case 'pong': {
      if (!isFiniteNumber(data.nonce) || !isFiniteNumber(data.serverTime)) return null;
      return { ...env, type: 'pong', nonce: data.nonce, serverTime: data.serverTime };
    }
    case 'server:welcome': {
      if (typeof data.clientId !== 'string' || !isClientRole(data.role)) return null;
      if (data.protocolVersion !== PROTOCOL_VERSION) return null;
      const peers = sanitizePeers(data.peers);
      if (!peers || !isRecord(data.snapshot)) return null;
      const s = data.snapshot;
      const snapshot: ServerSnapshot = {
        controls: s.controls == null ? null : sanitizeSquadControls(s.controls),
        physics: s.physics == null ? null : sanitizePhysics(s.physics),
        telemetry: s.telemetry == null ? null : sanitizeTelemetry(s.telemetry),
      };
      if (s.session != null) {
        const session = sanitizeGameSession(s.session);
        if (session && Object.keys(session).length > 0) snapshot.session = session;
      }
      return {
        ...env,
        type: 'server:welcome',
        clientId: data.clientId,
        role: data.role,
        protocolVersion: PROTOCOL_VERSION,
        snapshot,
        peers,
      };
    }
    case 'server:presence': {
      const peers = sanitizePeers(data.peers);
      return peers ? { ...env, type: 'server:presence', peers } : null;
    }
    case 'server:error': {
      const codes: readonly ErrorMessage['code'][] = ['bad_message', 'too_large', 'rate_limited', 'forbidden'];
      const code = codes.find((c) => c === data.code);
      if (!code) return null;
      const message = typeof data.message === 'string' ? data.message.slice(0, 200) : '';
      return { ...env, type: 'server:error', code, message };
    }
    default:
      return parseRoomMessage(data, env);
  }
}

/** Type guard for the subset a client is allowed to send. */
export function isClientMessage(msg: ProtocolMessage): msg is ClientMessage {
  return (
    msg.type === 'hello' ||
    msg.type === 'squad:controls' ||
    msg.type === 'physics:set' ||
    msg.type === 'game:state' ||
    msg.type === 'game:telemetry' ||
    msg.type === 'ping' ||
    (ROOM_CLIENT_TYPES as readonly string[]).includes(msg.type)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rooms: sanitizers and the parser (room.v1)
// ─────────────────────────────────────────────────────────────────────────────

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const SHARE_CODE_PATTERN = /^(RIDE1|DRV1)-[A-Za-z0-9_-]{1,200}$/;

/** A room code typed by a player: trimmed, upper-cased, ROOM_CODE_LENGTH letters of the alphabet; else null. */
export function sanitizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

/** Deterministic code generation shared by the relay and its tests: `random()` in [0, 1). */
export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(random() * ROOM_CODE_ALPHABET.length))];
  }
  return code;
}

/** A share code as a look / avatar: `RIDE1-…` or `DRV1-…`, ≤ ROOM_MAX_CODE_LENGTH; `prefix` narrows it. */
export function sanitizeShareCode(input: unknown, prefix: 'RIDE1' | 'DRV1'): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim();
  if (code.length > ROOM_MAX_CODE_LENGTH || !SHARE_CODE_PATTERN.test(code) || !code.startsWith(`${prefix}-`)) return null;
  return code;
}

/** Plate text for the wire: upper-cased, A–Z 0–9 space only, ≤ ROOM_MAX_PLATE; '' when nothing survives. */
export function sanitizeRoomPlate(input: unknown): string {
  if (typeof input !== 'string') return '';
  const text = input.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, ROOM_MAX_PLATE).trim();
}

/**
 * The identity fields of room:create / room:join / room:update. Name and carId are required (a
 * malformed one invalidates the frame); look / plate / avatar fall back to stock / '' / null.
 */
export function sanitizeRoomIdentity(input: unknown): RoomIdentity | null {
  if (!isRecord(input)) return null;
  const name = sanitizeDisplayText(input.name ?? '');
  const carId = sanitizeId(input.carId);
  if (name === null || carId === null) return null;
  return {
    name,
    carId,
    look: sanitizeShareCode(input.look, 'RIDE1'),
    plate: sanitizeRoomPlate(input.plate),
    avatar: sanitizeShareCode(input.avatar, 'DRV1'),
  };
}

function sanitizeRoomPlayer(input: unknown): RoomPlayer | null {
  if (!isRecord(input)) return null;
  const identity = sanitizeRoomIdentity(input);
  if (!identity || typeof input.id !== 'string' || input.id.length === 0 || input.id.length > 64) return null;
  return {
    id: input.id,
    ...identity,
    ready: input.ready === true,
    isHost: input.isHost === true,
    ping: isFiniteNumber(input.ping) && input.ping >= 0 ? Math.round(clamp(input.ping, 0, 60_000)) : null,
  };
}

export function sanitizeRoomPlayers(input: unknown): RoomPlayer[] | null {
  if (!Array.isArray(input) || input.length > ROOM_MAX_PLAYERS) return null;
  const out: RoomPlayer[] = [];
  for (const entry of input) {
    const player = sanitizeRoomPlayer(entry);
    if (!player) return null;
    out.push(player);
  }
  return out;
}

function sanitizeRoomResult(input: unknown): RoomResult | null {
  if (!isRecord(input) || typeof input.id !== 'string' || input.id.length === 0 || input.id.length > 64) return null;
  const name = sanitizeDisplayText(input.name ?? '');
  if (name === null) return null;
  let finishMs: number | null = null;
  if (input.finishMs !== null && input.finishMs !== undefined) {
    if (!isFiniteNumber(input.finishMs) || input.finishMs < 0) return null;
    finishMs = Math.round(clamp(input.finishMs, 0, 86_400_000));
  }
  const falls = isFiniteNumber(input.falls) ? Math.round(clamp(input.falls, 0, 999)) : 0;
  return { id: input.id, name, finishMs, falls };
}

export function sanitizeRoomRace(input: unknown): RoomRace | null {
  if (!isRecord(input) || !isRoomPhase(input.phase)) return null;
  let track: string | null = null;
  if (input.track !== null && input.track !== undefined) {
    track = sanitizeId(input.track);
    if (track === null) return null;
  }
  let startAt: number | null = null;
  if (input.startAt !== null && input.startAt !== undefined) {
    if (!isFiniteNumber(input.startAt) || input.startAt < 0) return null;
    startAt = Math.round(input.startAt);
  }
  const rawResults = input.results === undefined ? [] : input.results;
  if (!Array.isArray(rawResults) || rawResults.length > ROOM_MAX_PLAYERS * 4) return null;
  const results: RoomResult[] = [];
  for (const entry of rawResults) {
    const result = sanitizeRoomResult(entry);
    if (!result) return null;
    results.push(result);
  }
  return { phase: input.phase, track, startAt, results };
}

function roundTo(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

/** A pose (without the type): quantized and clamped; null when any field is malformed. */
export function sanitizeRoomPose(input: unknown): RoomPose | null {
  if (!isRecord(input)) return null;
  const { t, p, q, s, st, g, pm } = input;
  if (!isFiniteNumber(t) || t < 0) return null;
  if (!Array.isArray(p) || p.length !== 3 || !p.every(isFiniteNumber)) return null;
  if (!Array.isArray(q) || q.length !== 4 || !q.every(isFiniteNumber)) return null;
  if (!isFiniteNumber(s) || !isFiniteNumber(st) || !isFiniteNumber(g) || !isFiniteNumber(pm)) return null;
  const pos = p as number[];
  const quat = q as number[];
  return {
    id: typeof input.id === 'string' && input.id.length <= 64 ? input.id : '',
    t: Math.round(t),
    p: [roundTo(clamp(pos[0]!, -1e5, 1e5), 2), roundTo(clamp(pos[1]!, -1e5, 1e5), 2), roundTo(clamp(pos[2]!, -1e5, 1e5), 2)],
    q: [roundTo(clamp(quat[0]!, -1, 1), 4), roundTo(clamp(quat[1]!, -1, 1), 4), roundTo(clamp(quat[2]!, -1, 1), 4), roundTo(clamp(quat[3]!, -1, 1), 4)],
    s: roundTo(clamp(s, 0, 2000), 1),
    st: roundTo(clamp(st, -1, 1), 2),
    g: Math.round(clamp(g, 0, 9999)),
    pm: roundTo(clamp(pm, -1e6, 1e6), 1),
  };
}

function parseRoomMessage(data: Record<string, unknown>, env: Envelope): ProtocolMessage | null {
  switch (data.type) {
    case 'room:create': {
      const identity = sanitizeRoomIdentity(data);
      return identity ? { ...env, type: 'room:create', ...identity } : null;
    }
    case 'room:join': {
      const identity = sanitizeRoomIdentity(data);
      const code = sanitizeRoomCode(data.code);
      return identity && code ? { ...env, type: 'room:join', code, ...identity } : null;
    }
    case 'room:update': {
      const identity = sanitizeRoomIdentity(data);
      return identity ? { ...env, type: 'room:update', ...identity } : null;
    }
    case 'room:leave':
      return { ...env, type: 'room:leave' };
    case 'room:ready':
      return typeof data.ready === 'boolean' ? { ...env, type: 'room:ready', ready: data.ready } : null;
    case 'room:pose': {
      const pose = sanitizeRoomPose(data);
      return pose ? { ...env, type: 'room:pose', ...pose } : null;
    }
    case 'room:race': {
      const race = sanitizeRoomRace(data);
      return race ? { ...env, type: 'room:race', ...race } : null;
    }
    case 'room:finish': {
      if (!isFiniteNumber(data.finishMs) || data.finishMs < 0) return null;
      const falls = isFiniteNumber(data.falls) ? Math.round(clamp(data.falls, 0, 999)) : 0;
      return { ...env, type: 'room:finish', finishMs: Math.round(clamp(data.finishMs, 0, 86_400_000)), falls };
    }
    case 'room:ping': {
      if (!isFiniteNumber(data.t)) return null;
      const msg: RoomPingMessage = { ...env, type: 'room:ping', t: data.t };
      if (isFiniteNumber(data.rtt) && data.rtt >= 0) msg.rtt = Math.round(clamp(data.rtt, 0, 60_000));
      return msg;
    }
    case 'room:joined': {
      const code = sanitizeRoomCode(data.code);
      const players = sanitizeRoomPlayers(data.players);
      const race = sanitizeRoomRace(data.race);
      if (!code || !players || !race || typeof data.you !== 'string' || !isFiniteNumber(data.serverNow)) return null;
      return { ...env, type: 'room:joined', code, you: data.you, players, race, serverNow: data.serverNow };
    }
    case 'room:players': {
      const players = sanitizeRoomPlayers(data.players);
      return players ? { ...env, type: 'room:players', players } : null;
    }
    case 'room:left': {
      const reasons: readonly RoomLeftReason[] = ['left', 'expired', 'closed'];
      const reason = reasons.find((r) => r === data.reason);
      return reason ? { ...env, type: 'room:left', reason } : null;
    }
    case 'room:error': {
      const code = ROOM_ERROR_CODES.find((c) => c === data.code);
      if (!code) return null;
      const message = typeof data.message === 'string' ? data.message.slice(0, 200) : '';
      return { ...env, type: 'room:error', code, message };
    }
    case 'room:pong': {
      if (!isFiniteNumber(data.t) || !isFiniteNumber(data.serverNow)) return null;
      return { ...env, type: 'room:pong', t: data.t, serverNow: data.serverNow };
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────────────────────────────────────

/** `ws://host:port` from a bare host (or host:port). Leaves full ws:// / wss:// URLs alone. */
export function normalizeServerUrl(input: string, port: number = DEFAULT_SERVER_PORT): string {
  const trimmed = input.trim();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  const hostPart = trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /:\d+$/.test(hostPart) ? `ws://${hostPart}` : `ws://${hostPart}:${port}`;
}

/** Append/replace `?role=` on a ws URL. */
export function withRole(url: string, role: ClientRole): string {
  const [base, query = ''] = url.split('?');
  const params = query
    .split('&')
    .filter((p) => p && !p.startsWith('role='));
  params.push(`role=${role}`);
  return `${base}?${params.join('&')}`;
}
