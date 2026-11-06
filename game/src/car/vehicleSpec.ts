/**
 * Single source of truth for each car's geometry — used by the physics controller AND the
 * visual model so the wheels, body and colliders always line up.
 *
 * Every car class (shared/protocol.ts → CAR_CLASSES) gets a `VehicleSpec` from `getVehicleSpec(id)`:
 * the protocol class supplies everything the dashboard's estimates depend on (wheelbase, driven
 * wheel radius, centre-of-mass height, spring base/split, weight distribution), this file adds the
 * game-only parts (track widths, front wheels, suspension travel, collider, inertia, handling
 * tuning, camera framing). The module-level constants (WHEELS, RIDE_HEIGHT, CHASSIS_COLLIDER, …)
 * are the hypercar's, kept for code that predates the garage.
 *
 * Chassis (body) frame, metres:
 *   +Z = forward (nose), +Y = up, +X = the driver's LEFT (right-handed: right = forward × up = −X).
 *   Origin = rigid-body origin, ≈ rideHeight above the ground at rest, midway between the axles.
 * Rapier vehicle: indexUpAxis = 1 (Y), indexForwardAxis = 2 (Z).
 */
import {
  CAR_CLASSES,
  DEFAULT_CAR_CLASS_ID,
  GRAVITY,
  balanceToFrontWeightFraction,
  isCarClassId,
  type CarClass,
  type CarClassId,
} from '@shared/protocol';
import { CAR_TUNING, type CarTuning } from './tuning';

export type Tuple3 = [number, number, number];

export const UP_AXIS_INDEX = 1;
export const FORWARD_AXIS_INDEX = 2;
export const FORWARD_LOCAL: Tuple3 = [0, 0, 1];
export const UP_LOCAL: Tuple3 = [0, 1, 0];
/** Driver's right in the chassis frame. */
export const RIGHT_LOCAL: Tuple3 = [-1, 0, 0];

/** Suspension ray direction and wheel axle in the chassis frame. Axle = −X so Rapier's forward (normal × axle) is +Z. */
export const SUSPENSION_DIRECTION: Tuple3 = [0, -1, 0];
export const WHEEL_AXLE: Tuple3 = [-1, 0, 0];
/** Rapier caps each wheel's suspension force at this (N). High so aero load is never clipped. */
export const MAX_SUSPENSION_FORCE = 1e5;

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
  /** Receives drive torque (driveShare > 0). */
  driven: boolean;
  /** Fraction of the engine torque delivered to this wheel (0.5 per rear wheel on a RWD car). */
  driveShare: number;
}

export interface BodyEnvelope {
  length: number;
  width: number;
  /** Roof height above the ground at rest. */
  height: number;
  /** Underbody height above the ground at rest. */
  groundClearance: number;
}

export interface ChassisColliderSpec {
  halfExtents: Tuple3;
  offset: Tuple3;
  friction: number;
  restitution: number;
}

export interface VehicleSpec {
  id: CarClassId;
  /** The protocol class (slider mapping, aero constants, geometry the estimates use). */
  car: Readonly<CarClass>;
  /** Visual envelope of the body (the model fits roughly inside this). */
  body: BodyEnvelope;
  wheelbase: number;
  frontAxleZ: number;
  rearAxleZ: number;
  /** FL, FR, RL, RR. Order matters: Rapier's skid scaling keys off the LAST wheel, a driven rear wheel. */
  wheels: readonly WheelSpec[];
  suspensionRestLength: number;
  maxSuspensionTravel: number;
  /** Static spring compression (Rapier normalises spring force by mass, and the springs split like the weight). */
  staticCompression: number;
  /** Body origin height above flat ground at rest. Spawns place the origin this high. */
  rideHeight: number;
  /** Physics collider for the body (a single cuboid), in the chassis frame. */
  chassisCollider: ChassisColliderSpec;
  /** Centre-of-mass height in the chassis frame: exactly the class's cgHeight above the ground at rest. */
  comHeight: number;
  /** Box used for the principal inertia (w × h × l): not the collider, a closer match to the car's mass spread. */
  inertiaBox: Tuple3;
  tuning: CarTuning;
  /** Camera framing relative to the hypercar (distance/height multipliers) and the onboard cam (chassis frame). */
  camera: { distanceScale: number; heightScale: number; onboardY: number; onboardZ: number };
}

/** Game-only geometry of a class; everything else comes from its protocol CarClass. */
interface ClassGeometry {
  body: BodyEnvelope;
  /** Front wheel radius; an all-wheel-drive class must use its driveWheelRadius (drive force = torque / radius). */
  frontWheelRadius: number;
  frontWheelWidth: number;
  rearWheelWidth: number;
  frontTrackHalf: number;
  rearTrackHalf: number;
  suspensionRestLength: number;
  maxSuspensionTravel: number;
  /** Chassis cuboid in ground-relative terms: [bottom, top] heights, half width, [rear, front] z. Ignored when `collider` is set. */
  colliderBox?: { bottom: number; top: number; halfWidth: number; rear: number; front: number };
  collider?: ChassisColliderSpec;
  colliderFriction?: number;
  colliderRestitution?: number;
  inertiaBox: Tuple3;
  tuning?: Partial<CarTuning>;
  camera: { distanceScale: number; heightScale: number; onboardZ: number; onboardAboveRoof?: number };
}

const GEOMETRY: Record<CarClassId, ClassGeometry> = {
  hypercar: {
    body: { length: 4.6, width: 2.0, height: 1.15, groundClearance: 0.12 },
    frontWheelRadius: 0.34,
    frontWheelWidth: 0.3,
    rearWheelWidth: 0.38,
    frontTrackHalf: 0.84,
    rearTrackHalf: 0.86,
    suspensionRestLength: 0.35,
    maxSuspensionTravel: 0.3,
    collider: { halfExtents: [0.9, 0.3, 2.2], offset: [0, -0.04, 0.05], friction: 0.35, restitution: 0.05 },
    inertiaBox: [1.9, 0.9, 4.4],
    camera: { distanceScale: 1, heightScale: 1, onboardZ: -0.35 },
  },
  rally: {
    body: { length: 3.9, width: 1.86, height: 1.42, groundClearance: 0.16 },
    frontWheelRadius: 0.32,
    frontWheelWidth: 0.27,
    rearWheelWidth: 0.27,
    frontTrackHalf: 0.79,
    rearTrackHalf: 0.79,
    suspensionRestLength: 0.32,
    maxSuspensionTravel: 0.28,
    colliderBox: { bottom: 0.3, top: 1.05, halfWidth: 0.86, rear: -1.86, front: 1.9 },
    inertiaBox: [1.75, 1.0, 3.6],
    tuning: {
      aeroNormalToFlow: 1,
      longitudinalGripRatio: 0.82,
      sideStiffnessBase: 0.45,
      steerMax: 0.62,
      steerSpeedFalloff: 17,
      steerRate: 3.6,
      steerReturnRate: 5.5,
      brakeForceG: 1.35,
      handbrakeForceN: 7000,
      handbrakeRearFriction: 0.3,
      handbrakeRearSideStiffness: 0.45,
      airPitchStiffness: 45,
      airPitchDamping: 45,
      airPitchDampingBase: 240,
      airRollDamping: 380,
    },
    camera: { distanceScale: 0.92, heightScale: 1.06, onboardZ: -0.45 },
  },
  muscle: {
    body: { length: 4.8, width: 2.0, height: 1.3, groundClearance: 0.14 },
    frontWheelRadius: 0.35,
    frontWheelWidth: 0.3,
    rearWheelWidth: 0.42,
    frontTrackHalf: 0.82,
    rearTrackHalf: 0.84,
    suspensionRestLength: 0.34,
    maxSuspensionTravel: 0.3,
    colliderBox: { bottom: 0.3, top: 0.95, halfWidth: 0.93, rear: -2.32, front: 2.36 },
    inertiaBox: [1.9, 0.95, 4.7],
    tuning: {
      aeroNormalToFlow: 1,
      longitudinalGripRatio: 0.95,
      spinGripLoss: 0.6,
      steerMax: 0.52,
      steerSpeedFalloff: 12,
      steerRate: 2.3,
      steerReturnRate: 4,
      brakeForceG: 1.05,
      burnoutRearGrip: 0.3,
      handbrakeForceN: 11000,
      airPitchStiffness: 80,
      airPitchDamping: 70,
      airPitchDampingBase: 400,
      airRollDamping: 650,
    },
    camera: { distanceScale: 1.05, heightScale: 1.03, onboardZ: -0.6 },
  },
  formula: {
    body: { length: 4.7, width: 1.9, height: 0.95, groundClearance: 0.07 },
    frontWheelRadius: 0.32,
    frontWheelWidth: 0.32,
    rearWheelWidth: 0.42,
    frontTrackHalf: 0.84,
    rearTrackHalf: 0.82,
    suspensionRestLength: 0.22,
    maxSuspensionTravel: 0.16,
    colliderBox: { bottom: 0.16, top: 0.72, halfWidth: 0.56, rear: -2.0, front: 2.3 },
    inertiaBox: [1.3, 0.55, 4.2],
    tuning: {
      aeroNormalToFlow: 1,
      longitudinalGripRatio: 0.75,
      sideStiffnessBase: 0.5,
      steerMax: 0.5,
      steerSpeedFalloff: 10,
      steerMin: 0.06,
      steerRate: 3.8,
      steerReturnRate: 7,
      brakeForceG: 2,
      airPitchStiffness: 32,
      airPitchDamping: 30,
      airPitchDampingBase: 150,
      airRollDamping: 250,
    },
    camera: { distanceScale: 1, heightScale: 0.9, onboardZ: -0.55, onboardAboveRoof: 0.3 },
  },
  buggy: {
    body: { length: 3.9, width: 2.1, height: 1.75, groundClearance: 0.5 },
    frontWheelRadius: 0.48,
    frontWheelWidth: 0.4,
    rearWheelWidth: 0.42,
    frontTrackHalf: 0.95,
    rearTrackHalf: 0.95,
    suspensionRestLength: 0.55,
    maxSuspensionTravel: 0.45,
    colliderBox: { bottom: 0.55, top: 1.4, halfWidth: 0.85, rear: -1.8, front: 1.95 },
    inertiaBox: [1.9, 1.3, 3.8],
    tuning: {
      aeroNormalToFlow: 1,
      longitudinalGripRatio: 0.8,
      sideStiffnessBase: 0.3,
      sideStiffnessPerTraction: 0.35,
      steerMax: 0.6,
      steerSpeedFalloff: 14,
      steerRate: 2.8,
      brakeForceG: 1.0,
      dampingCompressionRatio: 0.45,
      dampingRelaxationRatio: 0.6,
      airPitchStiffness: 140,
      airPitchDamping: 90,
      airPitchDampingBase: 520,
      airRollDamping: 900,
    },
    camera: { distanceScale: 1.05, heightScale: 1.2, onboardZ: -0.4 },
  },
};

function buildSpec(id: CarClassId): VehicleSpec {
  const car = CAR_CLASSES[id];
  const g = GEOMETRY[id];
  const rearRadius = car.driveWheelRadius;
  const frontDrive = car.frontDriveShare > 0;
  if (frontDrive && Math.abs(g.frontWheelRadius - rearRadius) > 1e-9) {
    throw new Error(`vehicleSpec ${id}: an all-wheel-drive class needs equal front/rear wheel radii`);
  }
  const wheelbase = car.wheelbase;
  const frontAxleZ = wheelbase / 2;
  const rearAxleZ = -wheelbase / 2;
  // Same expression as the hypercar's original constant, so its ride height is bit-for-bit unchanged.
  const staticCompression = (0.5 * GRAVITY) / (2 * car.suspensionStiffnessBase);
  const rideHeight = g.suspensionRestLength - staticCompression + rearRadius;
  // Front attachment sits lower by the radius difference so both axles share the same ground plane at rest.
  const frontConnY = g.frontWheelRadius - rearRadius;
  const frontShare = car.frontDriveShare / 2;
  const rearShare = (1 - car.frontDriveShare) / 2;
  const wheels: WheelSpec[] = [
    { index: 0, id: 'FL', axle: 'front', side: 'left', connection: [g.frontTrackHalf, frontConnY, frontAxleZ], radius: g.frontWheelRadius, width: g.frontWheelWidth, steered: true, driven: frontDrive, driveShare: frontShare },
    { index: 1, id: 'FR', axle: 'front', side: 'right', connection: [-g.frontTrackHalf, frontConnY, frontAxleZ], radius: g.frontWheelRadius, width: g.frontWheelWidth, steered: true, driven: frontDrive, driveShare: frontShare },
    { index: 2, id: 'RL', axle: 'rear', side: 'left', connection: [g.rearTrackHalf, 0, rearAxleZ], radius: rearRadius, width: g.rearWheelWidth, steered: false, driven: true, driveShare: rearShare },
    { index: 3, id: 'RR', axle: 'rear', side: 'right', connection: [-g.rearTrackHalf, 0, rearAxleZ], radius: rearRadius, width: g.rearWheelWidth, steered: false, driven: true, driveShare: rearShare },
  ];
  let chassisCollider: ChassisColliderSpec;
  if (g.collider) chassisCollider = g.collider;
  else {
    const b = g.colliderBox ?? { bottom: 0.3, top: 0.9, halfWidth: g.body.width / 2 - 0.1, rear: -g.body.length / 2, front: g.body.length / 2 };
    chassisCollider = {
      halfExtents: [b.halfWidth, (b.top - b.bottom) / 2, (b.front - b.rear) / 2],
      offset: [0, (b.top + b.bottom) / 2 - rideHeight, (b.front + b.rear) / 2],
      friction: g.colliderFriction ?? 0.35,
      restitution: g.colliderRestitution ?? 0.05,
    };
  }
  return {
    id,
    car,
    body: g.body,
    wheelbase,
    frontAxleZ,
    rearAxleZ,
    wheels,
    suspensionRestLength: g.suspensionRestLength,
    maxSuspensionTravel: g.maxSuspensionTravel,
    staticCompression,
    rideHeight,
    chassisCollider,
    comHeight: car.cgHeight - rideHeight,
    inertiaBox: g.inertiaBox,
    tuning: { ...CAR_TUNING, ...g.tuning },
    camera: {
      distanceScale: g.camera.distanceScale,
      heightScale: g.camera.heightScale,
      onboardY: g.body.height - rideHeight + (g.camera.onboardAboveRoof ?? 0.16),
      onboardZ: g.camera.onboardZ,
    },
  };
}

const SPECS: Record<CarClassId, VehicleSpec> = {
  hypercar: buildSpec('hypercar'),
  rally: buildSpec('rally'),
  muscle: buildSpec('muscle'),
  formula: buildSpec('formula'),
  buggy: buildSpec('buggy'),
};

/** The spec of a car class; unknown ids get the default car (the hypercar). */
export function getVehicleSpec(carId?: string | null): VehicleSpec {
  return SPECS[isCarClassId(carId) ? carId : DEFAULT_CAR_CLASS_ID];
}

export const ALL_VEHICLE_SPECS: readonly VehicleSpec[] = Object.values(SPECS);

/** Wheel centre height in the chassis frame at rest (for models and spawn previews). */
export function wheelRestCenterYFor(spec: VehicleSpec, wheel: WheelSpec): number {
  return wheel.connection[1] - (spec.suspensionRestLength - spec.staticCompression);
}

/**
 * Centre of mass (chassis frame) for a balance value: placed along the car axis so the static
 * front-axle load fraction equals the protocol's balanceToFrontWeightFraction(balance, car).
 */
export function centerOfMassFor(spec: VehicleSpec, balance: number): Tuple3 {
  const frontFraction = balanceToFrontWeightFraction(balance, spec.car);
  return [0, spec.comHeight, spec.rearAxleZ + frontFraction * spec.wheelbase];
}

/** Principal inertia (about chassis X/Y/Z through the COM) of a solid box of the given mass. */
export function chassisInertiaFor(spec: VehicleSpec, mass: number): Tuple3 {
  const [w, h, l] = spec.inertiaBox;
  return [(mass / 12) * (h * h + l * l), (mass / 12) * (w * w + l * l), (mass / 12) * (w * w + h * h)];
}

// ── The hypercar's values as module constants (pre-garage API; the hypercar model still uses them) ──

const HYPERCAR = SPECS.hypercar;
export const HYPERCAR_SPEC: VehicleSpec = HYPERCAR;
export const BODY = HYPERCAR.body;
export const WHEELBASE = HYPERCAR.wheelbase;
export const FRONT_AXLE_Z = HYPERCAR.frontAxleZ;
export const REAR_AXLE_Z = HYPERCAR.rearAxleZ;
export const FRONT_WHEEL_RADIUS = GEOMETRY.hypercar.frontWheelRadius;
/** Equals the protocol's DRIVE_WHEEL_RADIUS: drive force = torque / this. */
export const REAR_WHEEL_RADIUS = HYPERCAR.car.driveWheelRadius;
export const FRONT_WHEEL_WIDTH = GEOMETRY.hypercar.frontWheelWidth;
export const REAR_WHEEL_WIDTH = GEOMETRY.hypercar.rearWheelWidth;
export const FRONT_TRACK_HALF = GEOMETRY.hypercar.frontTrackHalf;
export const REAR_TRACK_HALF = GEOMETRY.hypercar.rearTrackHalf;
export const SUSPENSION_REST_LENGTH = HYPERCAR.suspensionRestLength;
export const MAX_SUSPENSION_TRAVEL = HYPERCAR.maxSuspensionTravel;
export const STATIC_COMPRESSION = HYPERCAR.staticCompression;
export const RIDE_HEIGHT = HYPERCAR.rideHeight;
export const CHASSIS_COLLIDER = HYPERCAR.chassisCollider;
export const COM_HEIGHT = HYPERCAR.comHeight;
export const INERTIA_BOX = HYPERCAR.inertiaBox;
export const WHEELS = HYPERCAR.wheels;
/** Every class has four wheels in the same order. */
export const WHEEL_COUNT = 4;
export const FRONT_WHEELS = [0, 1] as const;
export const REAR_WHEELS = [2, 3] as const;

/** Wheel centre height in the chassis frame at rest — hypercar. */
export function wheelRestCenterY(wheel: WheelSpec): number {
  return wheelRestCenterYFor(HYPERCAR, wheel);
}

/** Centre of mass for a balance value — hypercar. */
export function centerOfMassForBalance(balance: number): Tuple3 {
  return centerOfMassFor(HYPERCAR, balance);
}

/** Principal inertia — hypercar. */
export function chassisInertia(mass: number): Tuple3 {
  return chassisInertiaFor(HYPERCAR, mass);
}
