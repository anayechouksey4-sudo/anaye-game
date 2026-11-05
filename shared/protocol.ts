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
 *   Balance    Shifts the centre of mass (see balanceToFrontWeightFraction) AND re-splits suspension stiffness
 *              between the axles (see balanceToSuspensionStiffness).
 *   Traction   Tyre friction coefficient (wheel friction slip / side stiffness).
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
export const FRONT_BODY_LIFT = 3.0;
/** Fixed rear-wing downforce at the rear axle, N per (m/s)². */
export const REAR_DOWNFORCE = 2.5;
/** Neutral per-wheel suspension stiffness (Rapier raycast-vehicle units, mass-normalised). */
export const SUSPENSION_STIFFNESS_BASE = 30;
/** How far balance re-splits stiffness: ±1 balance moves each axle by ±this fraction. */
export const SUSPENSION_BALANCE_SPLIT = 0.4;
/** Speed (km/h) the car must carry off the lip of the big jump to clear its gap. */
export const BIG_JUMP_LIP_KMH = 185;

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
    default: 4,
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

/**
 * THE mapping from dashboard sliders to car physics. Pure and deterministic, so
 * the dashboard can preview exactly what the game will apply.
 *
 *   Front Wing Aero (a = 0…1): frontDownforce 0→6.5 (body lift is 3.0, so < ~46 % nets lift), drag 2.0→6.0
 *   Engine Tier     (t = 1…5): rear-axle torque 1000→3200 N·m, mass +60 kg per tier
 *   Chassis Balance (b = −1…1): balance passthrough → centre of mass + suspension stiffness split
 *
 * At the default sliders (50 / 3 / 0) this yields DEFAULT_CAR_PHYSICS.
 */
export function mapSquadControlsToPhysics(input: SquadControls): CarPhysicsParams {
  const c = clampSquadControls(input);
  const a = c.frontWingAero / 100;
  const tierSteps = c.engineTier - 1;
  const b = c.chassisBalance / 50;
  return clampPhysics({
    mass: round(1050 + 60 * tierSteps, 1),
    traction: BASE_TRACTION,
    drag: round(2 + 4 * a, 3),
    frontDownforce: round(6.5 * a, 3),
    engineTorque: round(1000 + 550 * tierSteps, 1),
    balance: round(b, 3),
  });
}

export const DEFAULT_CAR_PHYSICS: Readonly<CarPhysicsParams> = Object.freeze(
  mapSquadControlsToPhysics(DEFAULT_SQUAD_CONTROLS),
);

/**
 * Fraction of static weight carried by the front axle for a balance value.
 * −1 → 0.70 (70 % front), 0 → 0.50, +1 → 0.30 (70 % rear).
 * The game derives its centre-of-mass shift from this so every UI agrees.
 */
export function balanceToFrontWeightFraction(balance: number): number {
  return 0.5 - 0.2 * clamp(balance, -1, 1);
}

/** Display helper: chassisBalance (−50…50) → e.g. { front: 60, rear: 40 } in percent. */
export function describeChassisBalance(chassisBalance: number): { front: number; rear: number } {
  const front = Math.round(balanceToFrontWeightFraction(chassisBalance / 50) * 100);
  return { front, rear: 100 - front };
}

/**
 * Per-wheel suspension stiffness for a balance value: the heavier end gets stiffer springs.
 * −1 → front ×1.4 / rear ×0.6, +1 → front ×0.6 / rear ×1.4 (with SUSPENSION_BALANCE_SPLIT = 0.4).
 */
export function balanceToSuspensionStiffness(balance: number): { front: number; rear: number } {
  const b = clamp(balance, -1, 1);
  return {
    front: SUSPENSION_STIFFNESS_BASE * (1 - SUSPENSION_BALANCE_SPLIT * b),
    rear: SUSPENSION_STIFFNESS_BASE * (1 + SUSPENSION_BALANCE_SPLIT * b),
  };
}

/** Rear-axle contact-patch drive force in N. */
export function driveForceN(p: CarPhysicsParams): number {
  return p.engineTorque / DRIVE_WHEEL_RADIUS;
}

/** Net vertical aero force at the front axle in N (+ = downforce, − = lift) at a forward speed in m/s. */
export function frontAeroForceN(p: CarPhysicsParams, forwardSpeedMs: number): number {
  return (p.frontDownforce - FRONT_BODY_LIFT) * forwardSpeedMs * forwardSpeedMs;
}

/**
 * Rough steady-state top speed: driveForce = drag·v² + Crr·m·g.
 * Preview only — the real number emerges from the game's simulation.
 */
export function estimateTopSpeedKmh(p: CarPhysicsParams): number {
  const resist = ROLLING_RESISTANCE * p.mass * GRAVITY;
  const net = Math.max(0, driveForceN(p) - resist);
  if (p.drag <= 1e-6) return Infinity;
  return Math.sqrt(net / p.drag) * 3.6;
}

/**
 * Speed (km/h) above which net front lift exceeds the static front-axle load, i.e. the
 * nose leaves the ground. null if the front wing out-pulls body lift (never lifts).
 * Static estimate — ignores drag pitch moment and load transfer.
 */
export function estimateFrontLiftOffKmh(p: CarPhysicsParams): number | null {
  const netLift = FRONT_BODY_LIFT - p.frontDownforce;
  if (netLift <= 1e-6) return null;
  const frontLoad = p.mass * GRAVITY * balanceToFrontWeightFraction(p.balance);
  return Math.sqrt(frontLoad / netLift) * 3.6;
}

export interface BigJumpAssessment {
  /** True when the estimate says the car can carry BIG_JUMP_LIP_KMH to the lip with its nose down. */
  ready: boolean;
  topSpeedKmh: number;
  liftOffKmh: number | null;
  requiredKmh: number;
  /** Human-readable verdict, e.g. 'TOO SLOW', 'NOSE LIFT', 'READY'. */
  verdict: 'READY' | 'TOO SLOW' | 'NOSE LIFT';
}

/** Will this setup clear the big jump? Estimate only (the game is the source of truth). */
export function assessBigJump(p: CarPhysicsParams): BigJumpAssessment {
  const topSpeedKmh = estimateTopSpeedKmh(p);
  const liftOffKmh = estimateFrontLiftOffKmh(p);
  const requiredKmh = BIG_JUMP_LIP_KMH;
  let verdict: BigJumpAssessment['verdict'] = 'READY';
  if (liftOffKmh !== null && liftOffKmh < requiredKmh) verdict = 'NOSE LIFT';
  else if (topSpeedKmh < requiredKmh) verdict = 'TOO SLOW';
  return { ready: verdict === 'READY', topSpeedKmh, liftOffKmh, requiredKmh, verdict };
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
  // ── F1-style channels (optional on the wire; parseMessage fills the defaults shown) ──
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

/** Game → dashboards: the physics params the car is actually running right now. */
export interface GameStateMessage extends Envelope {
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
 *   game:state      → stored as snapshot.physics; relayed to every non-game client
 *   game:telemetry  → stored as snapshot.telemetry; relayed to every non-game client
 *   ping            → `pong` to sender only
 *   server:*, pong  → never accepted from clients (answered with `server:error` code `forbidden`)
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
      return { ...env, type: 'game:state', physics, controls };
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
