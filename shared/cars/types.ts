/**
 * The car-class model shared by the game, the relay and the dashboard: the `CarClass` shape every
 * class module in this folder fills in (shared/cars/<id>.ts, one file per class so classes can be
 * tuned independently), and the hypercar's constants, which are the legacy pre-garage numbers.
 * Zero dependencies, erasable TypeScript only (see shared/protocol.ts, which re-exports all of this).
 */

// ── The hypercar's constants (the legacy single-car numbers; its class module uses them) ──
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
/** Front-wing downforce factor at 100 % Front Wing Aero (the mapping is linear from 0). */
export const FRONT_WING_DOWNFORCE_MAX = 6.5;
/** Centre-of-mass height above the ground, metres. */
export const CG_HEIGHT = 0.45;
/** Distance between front and rear axles, metres. */
export const WHEELBASE = 2.7;
/** Rolling-resistance coefficient used only by `estimateTopSpeedKmh`. */
export const ROLLING_RESISTANCE = 0.015;
/** Base tyre grip — no slider changes it; aero adds grip physically via axle load. */
export const BASE_TRACTION = 1.45;

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
