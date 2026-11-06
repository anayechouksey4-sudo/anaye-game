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
import type { CarClass, CarClassId, EngineModel } from './cars/types';
import { engineDriveForceN } from './cars/engine';
import { HYPERCAR } from './cars/hypercar';
import { RALLY } from './cars/rally';
import { MUSCLE } from './cars/muscle';
import { FORMULA } from './cars/formula';
import { BUGGY } from './cars/buggy';
import { COUPE } from './cars/coupe';
import { DRIFT } from './cars/drift';
import { ELECTRIC } from './cars/electric';
import { KART } from './cars/kart';

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

// The hypercar's constants live with its class module (shared/cars/types.ts) and are re-exported here.
export { DRIVE_WHEEL_RADIUS, FRONT_BODY_LIFT, REAR_DOWNFORCE, SUSPENSION_STIFFNESS_BASE, SUSPENSION_BALANCE_SPLIT, FRONT_WING_DOWNFORCE_MAX, CG_HEIGHT, WHEELBASE, ROLLING_RESISTANCE, BASE_TRACTION } from './cars/types';

/** Speed (km/h) the car must carry off the lip of the big jump to clear its gap. */
export const BIG_JUMP_LIP_KMH = 183;

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

// ─────────────────────────────────────────────────────────────────────────────
// Car classes — the garage. Every class maps the same three sliders onto its own car.
// ─────────────────────────────────────────────────────────────────────────────

export type { CarClass, EngineModel } from './cars/types';
// Handling v2 engine math (gears + torque curve), the same functions the game's controller steps.
export {
  LAUNCH_RPM_FRAC,
  TOP_GEAR_RPM_FRAC,
  engineDriveForceN,
  engineRpmFrac,
  engineWheelTorqueNm,
  gearCount,
  gearForSpeed,
  gearRatioToTop,
  redlineSpeedMs,
  torqueCurveAt,
  torqueShape,
} from './cars/engine';

export type { CarClassId } from './cars/types';

/** Garage order. Ids are stable: they are persisted and sent in `game:state.carId`. */
export const CAR_CLASS_IDS: readonly CarClassId[] = ['hypercar', 'rally', 'muscle', 'formula', 'buggy', 'coupe', 'drift', 'electric', 'kart'];

export const DEFAULT_CAR_CLASS_ID: CarClassId = 'hypercar';

export const CAR_CLASSES: { readonly [K in CarClassId]: Readonly<CarClass> } = {
  hypercar: HYPERCAR,
  rally: RALLY,
  muscle: MUSCLE,
  formula: FORMULA,
  buggy: BUGGY,
  coupe: COUPE,
  drift: DRIFT,
  electric: ELECTRIC,
  kart: KART,
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
  // Handling v2: the gear a full-throttle automatic holds at this speed, its rpm on the torque curve.
  if (k.engine) return engineDriveForceN(k.engine, p.engineTorque, k.driveWheelRadius, forwardSpeedMs, estimateTopSpeedKmh(p, k) / 3.6);
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
  // Handling v2 engines are fitted so top gear at top speed delivers exactly driveForceN: no boost band.
  if (k.engine || k.launchBoost <= 1 || k.launchFadeKmh <= 0 || v * 3.6 >= k.launchFadeKmh) return v * 3.6;
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
  if (k.engine) return liftOffWithEngine(p, k, k.engine, netLift, staticFrontLoad);
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
 * Handling v2 lift-off: the drive force depends on the gear held at each speed, so the balance
 * netLift·v² = staticFrontLoad − F(v)·h/L is found by bisection on v (F steps down at every upshift,
 * so the left side of the first crossing is what the run-up meets). km/h, 0 when the drive alone
 * unloads the nose at a standstill.
 */
function liftOffWithEngine(p: CarPhysicsParams, k: Readonly<CarClass>, engine: Readonly<EngineModel>, netLift: number, staticFrontLoad: number): number {
  const lever = k.cgHeight / k.wheelbase;
  const topMs = estimateTopSpeedKmh(p, k) / 3.6;
  // The tyres, not the gearbox, decide what reaches the road in the low gears: the rear axle can
  // transmit at most traction × its load (static share + rear downforce + what the drive itself
  // shifts onto it), the same budget the game's wheelspin model applies.
  const rearStatic = p.mass * GRAVITY - staticFrontLoad;
  const driveForce = (v: number) => {
    const engineF = engineDriveForceN(engine, p.engineTorque, k.driveWheelRadius, v, topMs);
    const gripF = (p.traction * (rearStatic + rearAeroForceN(v, k))) / Math.max(0.2, 1 - p.traction * lever);
    return Math.min(engineF, gripF);
  };
  const margin = (v: number) => staticFrontLoad - driveForce(v) * lever - netLift * v * v;
  if (margin(0) <= 0) return 0;
  let lo = 0;
  let hi = 200;
  if (margin(hi) > 0) return hi * 3.6;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (margin(mid) > 0) lo = mid;
    else hi = mid;
  }
  return hi * 3.6;
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
  | PingMessage;

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

export type ServerMessage = WelcomeMessage | PresenceMessage | ErrorMessage | PongMessage;

/** Anything that can appear on the wire (server relays client frames with `from` set). */
export type ProtocolMessage = ClientMessage | ServerMessage;
export type MessageType = ProtocolMessage['type'];

/** Distributive Omit so `encodeMessage({ type: 'squad:controls', controls })` type-checks per variant. */
export type OutgoingMessage<M extends ProtocolMessage = ProtocolMessage> = M extends ProtocolMessage
  ? Omit<M, 'v'> & { v?: typeof PROTOCOL_VERSION }
  : never;

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
      return null;
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
    msg.type === 'ping'
  );
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
