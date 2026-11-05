/**
 * Single source of truth for the car's geometry — used by the physics controller AND the
 * visual model so the wheels, body and colliders always line up.
 *
 * Chassis (body) frame, metres:
 *   +Z = forward (nose), +Y = up, +X = the driver's LEFT (right-handed: right = forward × up = −X).
 *   Origin = rigid-body origin, ≈ RIDE_HEIGHT above the ground at rest, midway between the axles.
 * Rapier vehicle: indexUpAxis = 1 (Y), indexForwardAxis = 2 (Z).
 */
import {
  DRIVE_WHEEL_RADIUS,
  GRAVITY,
  SUSPENSION_STIFFNESS_BASE,
  balanceToFrontWeightFraction,
} from '@shared/protocol';

export type Tuple3 = [number, number, number];

export const UP_AXIS_INDEX = 1;
export const FORWARD_AXIS_INDEX = 2;
export const FORWARD_LOCAL: Tuple3 = [0, 0, 1];
export const UP_LOCAL: Tuple3 = [0, 1, 0];
/** Driver's right in the chassis frame. */
export const RIGHT_LOCAL: Tuple3 = [-1, 0, 0];

/** Visual envelope of the body (the model should fit roughly inside this). */
export const BODY = {
  length: 4.6,
  width: 2.0,
  /** Roof height above the ground at rest. */
  height: 1.15,
  /** Underbody height above the ground at rest. */
  groundClearance: 0.12,
} as const;

export const WHEELBASE = 2.7;
export const FRONT_AXLE_Z = WHEELBASE / 2;
export const REAR_AXLE_Z = -WHEELBASE / 2;

export const FRONT_WHEEL_RADIUS = 0.34;
/** Must equal the protocol's DRIVE_WHEEL_RADIUS: drive force = torque / this. */
export const REAR_WHEEL_RADIUS = DRIVE_WHEEL_RADIUS;
export const FRONT_WHEEL_WIDTH = 0.3;
export const REAR_WHEEL_WIDTH = 0.38;
export const FRONT_TRACK_HALF = 0.84;
export const REAR_TRACK_HALF = 0.86;

export const SUSPENSION_REST_LENGTH = 0.35;
export const MAX_SUSPENSION_TRAVEL = 0.3;
/** Rapier caps each wheel's suspension force at this (N). High so aero load is never clipped. */
export const MAX_SUSPENSION_FORCE = 1e5;

/** Static spring compression with a 50/50 split at the base stiffness (Rapier normalises by mass). */
export const STATIC_COMPRESSION = (0.5 * GRAVITY) / (2 * SUSPENSION_STIFFNESS_BASE);
/** Body origin height above flat ground at rest. Spawns place the origin this high. */
export const RIDE_HEIGHT = SUSPENSION_REST_LENGTH - STATIC_COMPRESSION + REAR_WHEEL_RADIUS;

/** Physics collider for the body (a single cuboid), in the chassis frame. */
export const CHASSIS_COLLIDER = {
  halfExtents: [0.9, 0.3, 2.2] as Tuple3,
  offset: [0, -0.04, 0.05] as Tuple3,
  friction: 0.35,
  restitution: 0.05,
} as const;

/** Centre-of-mass height in the chassis frame (≈ 0.45 m above the ground at rest). */
export const COM_HEIGHT = -0.18;
/** Box used for the principal inertia (w × h × l): not the collider, a closer match to a car's mass spread. */
export const INERTIA_BOX: Tuple3 = [1.9, 0.9, 4.4];

export type AxleId = 'front' | 'rear';
export type WheelId = 'FL' | 'FR' | 'RL' | 'RR';

export interface WheelSpec {
  index: number;
  id: WheelId;
  axle: AxleId;
  side: 'left' | 'right';
  /** Suspension attachment point (top of the ray) in the chassis frame. */
  connection: Tuple3;
  radius: number;
  width: number;
  steered: boolean;
  driven: boolean;
}

// Front attachment sits lower by the radius difference so both axles share the same ground plane at rest.
const frontConnY = FRONT_WHEEL_RADIUS - REAR_WHEEL_RADIUS;

/** Order matters: Rapier's skid scaling keys off the LAST wheel, which is a driven rear wheel. */
export const WHEELS: readonly WheelSpec[] = [
  { index: 0, id: 'FL', axle: 'front', side: 'left', connection: [FRONT_TRACK_HALF, frontConnY, FRONT_AXLE_Z], radius: FRONT_WHEEL_RADIUS, width: FRONT_WHEEL_WIDTH, steered: true, driven: false },
  { index: 1, id: 'FR', axle: 'front', side: 'right', connection: [-FRONT_TRACK_HALF, frontConnY, FRONT_AXLE_Z], radius: FRONT_WHEEL_RADIUS, width: FRONT_WHEEL_WIDTH, steered: true, driven: false },
  { index: 2, id: 'RL', axle: 'rear', side: 'left', connection: [REAR_TRACK_HALF, 0, REAR_AXLE_Z], radius: REAR_WHEEL_RADIUS, width: REAR_WHEEL_WIDTH, steered: false, driven: true },
  { index: 3, id: 'RR', axle: 'rear', side: 'right', connection: [-REAR_TRACK_HALF, 0, REAR_AXLE_Z], radius: REAR_WHEEL_RADIUS, width: REAR_WHEEL_WIDTH, steered: false, driven: true },
];

export const WHEEL_COUNT = WHEELS.length;
export const FRONT_WHEELS = [0, 1] as const;
export const REAR_WHEELS = [2, 3] as const;

/** Suspension ray direction and wheel axle in the chassis frame. Axle = −X so Rapier's forward (normal × axle) is +Z. */
export const SUSPENSION_DIRECTION: Tuple3 = [0, -1, 0];
export const WHEEL_AXLE: Tuple3 = [-1, 0, 0];

/** Wheel centre height in the chassis frame at rest (for models and spawn previews). */
export function wheelRestCenterY(wheel: WheelSpec): number {
  return wheel.connection[1] - (SUSPENSION_REST_LENGTH - STATIC_COMPRESSION);
}

/**
 * Centre of mass (chassis frame) for a balance value: placed along the car axis so the static
 * front-axle load fraction equals the protocol's balanceToFrontWeightFraction(balance).
 */
export function centerOfMassForBalance(balance: number): Tuple3 {
  const frontFraction = balanceToFrontWeightFraction(balance);
  return [0, COM_HEIGHT, REAR_AXLE_Z + frontFraction * WHEELBASE];
}

/** Principal inertia (about chassis X/Y/Z through the COM) of a solid box of the given mass. */
export function chassisInertia(mass: number): Tuple3 {
  const [w, h, l] = INERTIA_BOX;
  return [(mass / 12) * (h * h + l * l), (mass / 12) * (w * w + l * l), (mass / 12) * (w * w + h * h)];
}
