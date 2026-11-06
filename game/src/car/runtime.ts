/**
 * Mutable per-physics-step car state. Written ONLY by `Car.tsx` (every fixed step, after the
 * world integrates); read by visuals, hazards, camera, HUD and telemetry without going through
 * React. Never replace the objects — mutate in place so references stay valid.
 */
import { Object3D, Quaternion, Vector3 } from 'three';
import { HYPERCAR_SPEC, WHEEL_COUNT, type VehicleSpec } from './vehicleSpec';

export interface WheelRuntime {
  inContact: boolean;
  /** Visual rolling angle about the axle, rad (rear wheels include wheelspin). Positive = rolling forward. */
  rotation: number;
  /** Wheel angular speed, rad/s (rear: drivetrain model; front: from rotation deltas). */
  spinRate: number;
  /** Steering angle about the chassis up axis, rad. Positive turns the nose toward +X (left). */
  steering: number;
  /** Current suspension length, m (wheel centre = connection − this along chassis −Y). */
  suspensionLength: number;
  /** Normal load on the tyre, N. */
  suspensionForce: number;
  /** World-space point the suspension ray hit (valid while inContact). */
  contactPointWorld: Vector3;
  contactNormalWorld: Vector3;
  /** Handle of the collider under this wheel (vehicle.wheelGroundObject(i)?.handle), or null. */
  groundColliderHandle: number | null;
  /** Sideways sliding speed at the contact patch, m/s. */
  lateralSlip: number;
  /** |wheel surface speed − ground speed| along the tyre, m/s (wheelspin / lock-up). */
  longitudinalSlip: number;
  /** Combined slip intensity 0…1 (0 = gripping, 1 = fully sliding / smoking). */
  slip01: number;
}

export interface CarRuntime {
  /** True once the vehicle controller exists and has stepped at least once. */
  ready: boolean;
  /** Car class of the mounted car (`spec.id`) and its geometry: for the camera, smoke, audio and HUD. */
  carId: string;
  spec: VehicleSpec;
  /** Rapier handles so hazards can recognise the car in contact/intersection events. */
  bodyHandle: number | null;
  chassisColliderHandle: number | null;
  /** Interpolated render transform of the chassis (use for visuals/camera, not physics). */
  chassisObject: Object3D | null;

  /** Physics pose (end of the latest step). */
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  /** World-space chassis axes. */
  forward: Vector3;
  up: Vector3;
  right: Vector3;
  /** velocity · forward, m/s (negative when reversing). */
  forwardSpeed: number;
  /** |forwardSpeed| in km/h. */
  speedKmh: number;

  /** Inputs actually applied this step (after smoothing / reverse logic), 0…1 except steer −1…1. */
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
  reversing: boolean;

  /** Net vertical aero force at the front axle, N (+ down, − lift). */
  frontAeroN: number;
  /** Rear-wing downforce at the rear axle, N. */
  rearAeroN: number;
  /** Aero drag magnitude, N. */
  dragN: number;
  /** Ground-effect factor applied to the vertical aero forces, 0…1 (1 = on/near the ground). */
  groundEffect: number;
  /** Aero lift has both front wheels off the ground at speed. */
  noseLift: boolean;

  wheelsGrounded: number;
  frontAxleLoadN: number;
  rearAxleLoadN: number;
  /** max(slip01) of the rear wheels — tyre smoke intensity. */
  rearSlip: number;
  wheels: WheelRuntime[];

  /** Seconds since all four wheels last touched the ground (0 while grounded). */
  airborneTime: number;
  /** Fixed steps simulated since load, and the matching simulated time in s. */
  stepCount: number;
  simTime: number;
}

function makeWheel(): WheelRuntime {
  return {
    inContact: false,
    rotation: 0,
    spinRate: 0,
    steering: 0,
    suspensionLength: 0,
    suspensionForce: 0,
    contactPointWorld: new Vector3(),
    contactNormalWorld: new Vector3(0, 1, 0),
    groundColliderHandle: null,
    lateralSlip: 0,
    longitudinalSlip: 0,
    slip01: 0,
  };
}

export const carRuntime: CarRuntime = {
  ready: false,
  carId: HYPERCAR_SPEC.id,
  spec: HYPERCAR_SPEC,
  bodyHandle: null,
  chassisColliderHandle: null,
  chassisObject: null,
  position: new Vector3(),
  quaternion: new Quaternion(),
  velocity: new Vector3(),
  angularVelocity: new Vector3(),
  forward: new Vector3(0, 0, 1),
  up: new Vector3(0, 1, 0),
  right: new Vector3(-1, 0, 0),
  forwardSpeed: 0,
  speedKmh: 0,
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: 0,
  reversing: false,
  frontAeroN: 0,
  rearAeroN: 0,
  dragN: 0,
  groundEffect: 1,
  noseLift: false,
  wheelsGrounded: 0,
  frontAxleLoadN: 0,
  rearAxleLoadN: 0,
  rearSlip: 0,
  wheels: Array.from({ length: WHEEL_COUNT }, makeWheel),
  airborneTime: 0,
  stepCount: 0,
  simTime: 0,
};

/** Is this collider handle one of the car's? Handy inside hazard collision callbacks. */
export function isCarCollider(handle: number | null | undefined): boolean {
  return handle !== null && handle !== undefined && handle === carRuntime.chassisColliderHandle;
}

/** Wheels currently resting on the given collider (e.g. a collapsing tile). */
export function wheelsOnCollider(handle: number): number {
  let n = 0;
  for (const w of carRuntime.wheels) if (w.inContact && w.groundColliderHandle === handle) n++;
  return n;
}
