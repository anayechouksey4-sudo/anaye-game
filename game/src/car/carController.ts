/**
 * The car's physics, one fixed step at a time. Owns the Rapier raycast-vehicle controller and
 * applies the protocol's wing, drive and drag model (see "Physics model" in shared/protocol.ts)
 * with the mounted car class's constants (VehicleSpec → spec.car):
 *
 *   drive      engineTorque × each wheel's driveShare (RWD: ½ per rear wheel; AWD classes split
 *              front/rear) × the class's low-speed launch boost, through the wheelspin model (drivetrain.ts)
 *   front aero (frontDownforce − frontBodyLift)·v_fwd² along −up AT THE FRONT AXLE (lift if < 0)
 *   rear aero  rearDownforce·v_fwd² at the rear axle
 *              (both × a ground-effect factor: 1 on the ground, fading with height in flight)
 *   drag       −drag·v·|v| at the centre of mass (+ rolling resistance while grounded)
 *   balance    centre of mass along the axis + per-axle spring/damper split
 *   traction   friction slip / side stiffness on every tyre (friction × the track's surfaceGrip)
 *
 * Every parameter is read from the store each step, so changes apply on the next step.
 *
 * Handling v2 (per class, `tuning.handlingV2`; the legacy path above runs bit-identically when it is
 * off): load-sensitive tyres, a friction ellipse, an engine with real gears (the audio gearbox stepped
 * here, torque from the class's curve — the protocol's estimates use the same functions), ABS with a
 * live brake bias, Ackermann and slip-aware steering, anti-roll bars, a rear differential lock, and
 * the player's assists (ABS pulse, wheelspin cap, counter-steer) from GameSettings.
 */
import type { Collider, DynamicRayCastVehicleController, Ray, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { RapierContext } from '@react-three/rapier';
import { Quaternion, Vector3 } from 'three';
import {
  GRAVITY,
  balanceToFrontWeightFraction,
  balanceToSuspensionStiffness,
  estimateTopSpeedKmh,
  gearRatioToTop,
  torqueShape,
  type CarClass,
  type CarPhysicsParams,
  type EngineModel,
} from '@shared/protocol';
import { engineReadout } from '../audio/engineReadout';
import { Gearbox, type GearboxInput } from '../audio/gearbox';
import { getEnginePreset, type EnginePreset } from '../audio/presets';
import { selectionState } from '../state/selection';
import type { CarTuning } from './tuning';
import {
  absBrakeCap,
  ackermannAngles,
  antiRollTransferN,
  brakeFrontShare,
  diffLockTransfer,
  driveSlipRatio,
  frictionEllipseScale,
  frictionSlipForLoad,
  lateralBudgetScale,
  loadSensitivityScale,
  tractionControlFactor,
  type SteerAngles,
} from './handling';
import { chassisInertia, wheelGrip } from './surfaceGrip';
import { stableRollInertia } from '../track/world/physics/rollStability';
import { carRuntime } from './runtime';
import {
  createDrivenWheelState,
  resetDrivenWheel,
  rollWithGround,
  stepDrivenWheel,
  type DrivenWheelState,
} from './drivetrain';
import { readDriverInput, type DriverInput } from './input';
import {
  FORWARD_AXIS_INDEX,
  MAX_SUSPENSION_FORCE,
  SUSPENSION_DIRECTION,
  UP_AXIS_INDEX,
  WHEEL_AXLE,
  centerOfMassFor,
  chassisInertiaFor,
  type Tuple3,
  type VehicleSpec,
  type WheelSpec,
} from './vehicleSpec';

type Rapier = RapierContext['rapier'];

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export class CarController {
  readonly vehicle: DynamicRayCastVehicleController;
  readonly spec: VehicleSpec;
  private readonly world: World;
  private readonly rapier: Rapier;
  private readonly body: RigidBody;
  private readonly car: Readonly<CarClass>;
  private readonly T: CarTuning;
  private readonly wheels: readonly WheelSpec[];

  private appliedMass = NaN;
  private appliedBalance = NaN;
  private steerAngle = 0;
  private frontOffTime = 0;
  /** A front tyre has touched since the car was last fully airborne (landings are not nose lifts). */
  private frontTouchedSinceAirborne = true;
  /** Ground-effect factor per axle, [front, rear]. */
  private readonly groundEffect = [1, 1];
  private chassisCollider: Collider | null = null;
  private readonly groundRay: Ray;
  private readonly driven: DrivenWheelState[];
  private readonly prevRapierRotation: number[];
  private readonly rawInput: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

  // ── Handling v2 state (unused, and never touched, while T.handlingV2 is false) ──
  private readonly v2: boolean;
  /** The physics gearbox (v2 classes with an engine model); null = legacy flat torque. */
  private readonly gearbox: Gearbox | null;
  private readonly engine: Readonly<EngineModel> | null;
  private readonly enginePreset: EnginePreset | null;
  private readonly gearIn: GearboxInput = { dt: 0, carSpeed: 0, driveSpeed: 0, throttle: 0, brake: 0, grounded: true, reversing: false };
  /** The physics the gearing was last fitted to (estimateTopSpeedKmh reads mass, drag, torque). */
  private gearMass = NaN;
  private gearDrag = NaN;
  private gearTorque = NaN;
  private gearTopSpeedMs = 0;
  /** Anti-roll-bar load share per wheel from the last step, N (+ = more load on that tyre). */
  private readonly arbLoad: number[];
  /** Brake slide per undriven wheel: applied impulse ÷ grip cap − 1, ≥ 0 only when the tyre slides. */
  private readonly brakeSlide: number[];
  /** Per-wheel values computed before updateVehicle this step (along / lateral patch speed, N). */
  private readonly along: number[];
  private readonly lateral: number[];
  private readonly steerAngles: SteerAngles = { left: 0, right: 0 };
  /** Traction-control torque factor per driven wheel (drops at once on slip, recovers at tcRecover per second). */
  private readonly tcFactor: number[];

  // Scratch objects — the step runs 60×/s, so nothing below allocates.
  private readonly q = new Quaternion();
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private readonly right = new Vector3();
  private readonly vel = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly wheelFwd = new Vector3();
  private readonly wheelLat = new Vector3();
  private readonly contact = new Vector3();
  private readonly normal = new Vector3();
  private readonly relVel = new Vector3();
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly speeds = { along: 0, lateral: 0 };
  private readonly impulse = { x: 0, y: 0, z: 0 };
  /** Direction of positive (down) vertical aero force this step, world frame. */
  private readonly aeroDown = new Vector3(0, -1, 0);

  constructor(world: World, rapier: Rapier, body: RigidBody, spec: VehicleSpec) {
    this.world = world;
    this.rapier = rapier;
    this.body = body;
    this.spec = spec;
    this.car = spec.car;
    this.T = spec.tuning;
    this.wheels = spec.wheels;
    this.driven = spec.wheels.map(() => createDrivenWheelState());
    this.prevRapierRotation = spec.wheels.map(() => 0);
    this.arbLoad = spec.wheels.map(() => 0);
    this.brakeSlide = spec.wheels.map(() => 0);
    this.along = spec.wheels.map(() => 0);
    this.lateral = spec.wheels.map(() => 0);
    this.tcFactor = spec.wheels.map(() => 1);
    this.v2 = spec.tuning.handlingV2;
    this.engine = this.v2 && spec.car.engine ? spec.car.engine : null;
    if (this.engine) {
      // The audio preset's character with the class's physics gearing, so sound and physics agree.
      const base = getEnginePreset(spec.id);
      this.enginePreset = { ...base, gears: this.engine.gears, firstGearFrac: this.engine.firstGearFrac, shiftUpFull: this.engine.shiftUpFrac, shiftTime: this.engine.shiftCutS };
      this.gearbox = new Gearbox(this.enginePreset);
    } else {
      this.enginePreset = null;
      this.gearbox = null;
    }
    engineReadout.live = this.gearbox !== null;
    const vehicle = world.createVehicleController(body);
    vehicle.indexUpAxis = UP_AXIS_INDEX;
    // In rapier3d-compat 0.19 the forward-axis setter is a property literally named `setIndexForwardAxis`.
    vehicle.setIndexForwardAxis = FORWARD_AXIS_INDEX;
    const dir = toVec(SUSPENSION_DIRECTION);
    const axle = toVec(WHEEL_AXLE);
    for (const wheel of spec.wheels) {
      vehicle.addWheel(toVec(wheel.connection), dir, axle, spec.suspensionRestLength, wheel.radius);
      vehicle.setWheelMaxSuspensionTravel(wheel.index, spec.maxSuspensionTravel);
      vehicle.setWheelMaxSuspensionForce(wheel.index, MAX_SUSPENSION_FORCE);
    }
    this.vehicle = vehicle;
    this.groundRay = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** The chassis collider, so the ground-effect probe never hits the car itself. */
  setChassisCollider(collider: Collider | null): void {
    this.chassisCollider = collider;
  }

  dispose(): void {
    if (this.gearbox) engineReadout.live = false;
    try {
      this.world.removeVehicleController(this.vehicle);
    } catch {
      // The world may already have been freed (Physics unmounted first); nothing left to release.
    }
  }

  /** Mass / centre of mass / springs. Called every step; only touches Rapier when values change. */
  applyParams(p: CarPhysicsParams): void {
    if (p.mass !== this.appliedMass || p.balance !== this.appliedBalance) {
      const com = centerOfMassFor(this.spec, p.balance);
      const stiffness = balanceToSuspensionStiffness(p.balance, this.car);
      let inertia = chassisInertia(this.spec, p.mass, stiffness, chassisInertiaFor(this.spec, p.mass));
      // v2: the roll-stability floor (the island's) on every map, with the springs' and the bars' explicit
      // stiffness in its number, so a stiff anti-roll bar cannot set off the step-to-step roll chatter.
      if (this.v2) inertia = stableRollInertia(this.spec, p.mass, stiffness, inertia);
      // The chassis collider has zero density: all mass comes from here, so COM is exactly ours.
      this.body.setAdditionalMassProperties(p.mass, toVec(com), toVec(inertia), IDENTITY_ROTATION, true);
      this.body.recomputeMassPropertiesFromColliders();
      this.appliedMass = p.mass;
    }
    if (p.balance !== this.appliedBalance) {
      const T = this.T;
      const stiffness = balanceToSuspensionStiffness(p.balance, this.car);
      for (const wheel of this.wheels) {
        const k = wheel.axle === 'front' ? stiffness.front : stiffness.rear;
        this.vehicle.setWheelSuspensionStiffness(wheel.index, k);
        this.vehicle.setWheelSuspensionCompression(wheel.index, T.dampingCompressionRatio * Math.sqrt(k));
        this.vehicle.setWheelSuspensionRelaxation(wheel.index, T.dampingRelaxationRatio * Math.sqrt(k));
      }
      this.appliedBalance = p.balance;
    }
  }

  /**
   * Inputs → forces → vehicle update → aero. Runs inside useBeforePhysicsStep.
   * `surfaceGrip` is the track surface's tyre-grip multiplier (TrackLayout.surfaceGrip, 1 = tarmac).
   */
  beforeStep(dt: number, p: CarPhysicsParams, surfaceGrip = 1): void {
    const { body, vehicle, fwd, up, right, vel, T, car } = this;
    this.applyParams(p);

    const r = body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    fwd.set(0, 0, 1).applyQuaternion(this.q);
    up.set(0, 1, 0).applyQuaternion(this.q);
    right.set(-1, 0, 0).applyQuaternion(this.q);
    const lv = body.linvel();
    vel.set(lv.x, lv.y, lv.z);
    const vFwd = vel.dot(fwd);
    const mass = body.mass() || p.mass;

    // ── Pedals: brake pedal reverses once stopped; throttle while rolling backwards brakes ──
    const input = readDriverInput(this.rawInput);
    let throttle = 0;
    let brake = 0;
    let frontOnlyBrake = 0;
    let reversing = false;
    if (input.throttle > 0) {
      if (vFwd < -T.reverseEngageSpeed && input.brake === 0) brake = input.throttle;
      else {
        throttle = input.throttle;
        // Both pedals: front brakes hold the car while the rear tyres light up (burnout).
        frontOnlyBrake = input.brake;
      }
    } else if (input.brake > 0) {
      if (vFwd > T.reverseEngageSpeed) brake = input.brake;
      else {
        throttle = input.brake;
        reversing = true;
      }
    }
    const handbrake = input.handbrake;

    const h2 = this.v2;
    const assists = h2 && selectionState().settings.assists !== 'off';

    // ── Speed-sensitive steering with slew-rate limiting ──
    const maxSteer = Math.max(T.steerMin, T.steerMax / (1 + Math.abs(vFwd) / T.steerSpeedFalloff));
    // Positive Rapier steering turns the nose toward +X (driver's left), so right input is negative.
    let target = -input.steer * maxSteer;
    if (h2) {
      // Patch speeds of the last step (contact data is from the previous updateVehicle).
      for (const wheel of this.wheels) {
        const i = wheel.index;
        if (vehicle.wheelIsInContact(i)) {
          const sp = this.contactSpeeds(i);
          this.along[i] = sp.along;
          this.lateral[i] = sp.lateral;
        } else {
          this.along[i] = 0;
          this.lateral[i] = 0;
        }
      }
      // Counter-steer assist: a sliding rear adds steer into the slide (a light hand, never with the handbrake).
      if (assists && handbrake === 0 && vFwd > 5 && (vehicle.wheelIsInContact(2) || vehicle.wheelIsInContact(3))) {
        const rearLat = 0.5 * (this.lateral[2]! + this.lateral[3]!);
        target += clamp(T.counterSteerGain * Math.atan2(rearLat, vFwd), -0.5 * maxSteer, 0.5 * maxSteer);
      }
      // Slip-aware cap: past the tyres' peak slip angle more lock only scrubs, so the angle holds there.
      // Not while the handbrake is pulled: a handbrake turn wants all the lock the driver asks for.
      if (handbrake === 0 && (vehicle.wheelIsInContact(0) || vehicle.wheelIsInContact(1))) {
        const alpha = Math.atan2(Math.abs(this.lateral[0]! + this.lateral[1]!) * 0.5, Math.max(1, Math.abs(vFwd)));
        if (alpha > T.peakSlipRad && Math.abs(target) > Math.abs(this.steerAngle) && Math.sign(target) === Math.sign(this.steerAngle)) target = this.steerAngle;
      }
    }
    const returning =
      Math.abs(target) < Math.abs(this.steerAngle) || (this.steerAngle !== 0 && Math.sign(target) !== Math.sign(this.steerAngle));
    const rate = (returning ? T.steerReturnRate : T.steerRate) * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    if (h2) {
      // Ackermann: the inner wheel turns more than the outer so both roll about one centre. The share
      // fades out with speed (the kinematic centre is far inside the real, sliding radius at speed, where
      // the loaded outer tyre wants the larger angle), so it shapes parking and hairpins, not fast sweepers.
      const share = T.ackermann * Math.max(0, 1 - Math.abs(vFwd) / T.ackermannFadeSpeed);
      const a = ackermannAngles(this.steerAngle, this.spec.wheelbase, Math.abs(this.wheels[0]!.connection[0]), share, this.steerAngles);
      vehicle.setWheelSteering(0, a.left);
      vehicle.setWheelSteering(1, a.right);
    } else {
      vehicle.setWheelSteering(0, this.steerAngle);
      vehicle.setWheelSteering(1, this.steerAngle);
    }

    // ── Brakes (Rapier brake = max impulse per step) ──
    // Rapier never caps brake force by tyre grip, so a slippery surface (ice: surfaceGrip 0.55) scales
    // the pedal brake itself; on tarmac (1) this is exact, so nothing changes there.
    // Handling v2: the surface scaling moves into the per-wheel grip cap (ABS), and the bias follows
    // the live axle loads (nose-heavy under braking) blended with the static share.
    const frontShare = h2 ? brakeFrontShare(T.brakeFrontShare, carRuntime.frontAxleLoadN, carRuntime.rearAxleLoadN, T.brakeBiasLive) : T.brakeFrontShare;
    const brakeForce = h2 ? T.brakeForceG * mass * GRAVITY * brake : T.brakeForceG * mass * GRAVITY * brake * Math.min(1, surfaceGrip);
    const idleHold = throttle === 0 && brake === 0 && Math.abs(vFwd) < T.idleHoldSpeed ? 0.25 * mass * GRAVITY : 0;
    const frontBrake = (brakeForce * frontShare + idleHold * 0.5 + frontOnlyBrake * 1.2 * mass * GRAVITY) / 2;
    const rearPedalBrake = (brakeForce * (1 - frontShare) + idleHold * 0.5) / 2;
    const rearHandbrake = handbrake * T.handbrakeForceN * 0.5;
    const rearBrake = rearPedalBrake + rearHandbrake;

    // ── Drive + friction per wheel ──
    // Low-speed "grunt" (launch boost) multiplies forward drive only; flat-torque classes skip it.
    let drive = 1;
    if (reversing) drive = -T.reverseTorqueRatio;
    else if (car.launchBoost > 1 && car.launchFadeKmh > 0) {
      drive = 1 + (car.launchBoost - 1) * Math.max(0, 1 - (Math.abs(vFwd) * 3.6) / car.launchFadeKmh);
    }
    const noDrive = reversing && vFwd < -T.reverseMaxSpeed;
    const traction = p.traction * surfaceGrip;
    const baseSide = clamp(T.sideStiffnessBase + T.sideStiffnessPerTraction * p.traction, T.sideStiffnessMin, 1);
    const burnout = frontOnlyBrake > 0 && Math.abs(vFwd) < T.burnoutMaxSpeed;
    const longMu = traction * T.longitudinalGripRatio * (burnout ? T.burnoutRearGrip : 1);

    // Handling v2 engine: the gearbox steps on the last step's wheel speeds; wheel torque comes from
    // the gear and the torque curve (shift and limiter cuts really cut it). The launch boost is gone:
    // 1st gear multiplies torque instead. `driveTorque` is the whole car's wheel torque this step.
    let driveTorque = p.engineTorque * throttle * drive;
    const gearbox = this.gearbox;
    if (gearbox && this.engine) {
      if (p.mass !== this.gearMass || p.drag !== this.gearDrag || p.engineTorque !== this.gearTorque) {
        this.gearMass = p.mass;
        this.gearDrag = p.drag;
        this.gearTorque = p.engineTorque;
        const top = estimateTopSpeedKmh(p, car) / 3.6;
        this.gearTopSpeedMs = Number.isFinite(top) ? top : 250 / 3.6;
        gearbox.configure(this.enginePreset!, this.gearTopSpeedMs);
      }
      let driveSpeed = 0;
      let drivenGrounded = false;
      for (const wheel of this.wheels) {
        if (!wheel.driven) continue;
        const s = Math.abs(this.driven[wheel.index]!.omega) * wheel.radius;
        if (s > driveSpeed) driveSpeed = s;
        if (vehicle.wheelIsInContact(wheel.index)) drivenGrounded = true;
      }
      const gin = this.gearIn;
      gin.dt = dt;
      gin.carSpeed = Math.abs(vFwd);
      gin.driveSpeed = driveSpeed;
      gin.throttle = throttle;
      gin.brake = brake;
      gin.grounded = drivenGrounded;
      gin.reversing = reversing;
      gearbox.update(gin);
      const gear = gearbox.gear < 1 ? 1 : gearbox.gear;
      const shape = gearbox.cut ? 0 : torqueShape(this.engine, gearbox.rpmFrac);
      // Reverse is the legacy flat torque × reverseTorqueRatio (never 1st gear's multiplication: that
      // spun the rears backwards whenever the brake was held at a standstill).
      driveTorque = reversing ? -p.engineTorque * throttle * T.reverseTorqueRatio : p.engineTorque * throttle * shape * gearRatioToTop(this.engine, gear);
      const r = engineReadout;
      r.gear = gearbox.gear;
      r.gears = gearbox.gearCount;
      r.rpm = gearbox.rpm;
      r.rpmFrac = gearbox.rpmFrac;
      r.redline = this.enginePreset!.redlineRpm;
      r.limiter = gearbox.limiter;
      r.shifting = gearbox.shifting;
      r.shifts = gearbox.shifts;
      r.load = gearbox.load;
      r.events |= gearbox.events;
    }

    // All-wheel drive: a torque-sensing centre diff. Nominally frontDriveShare goes to the front, but
    // an axle never gets more drive than its tyres' grip budget (from the last step's loads) while
    // the other axle has budget to spare, so a nose lightened by body lift or a rear-biased balance
    // doesn't just spin its tyres. RWD classes (the hypercar) skip this entirely.
    let frontAxleShare = car.frontDriveShare;
    if (frontAxleShare > 0 && throttle > 0 && !reversing) {
      const requested = h2 ? driveTorque / car.driveWheelRadius : (p.engineTorque * throttle * drive) / car.driveWheelRadius;
      const load = (a: number, b: number) =>
        (vehicle.wheelIsInContact(a) ? (vehicle.wheelSuspensionForce(a) ?? 0) : 0) + (vehicle.wheelIsInContact(b) ? (vehicle.wheelSuspensionForce(b) ?? 0) : 0);
      // The steered front tyres keep part of their grip for cornering (the diff never asks them for more).
      const frontBudget = 0.6 * longMu * load(0, 1);
      const rearBudget = 0.95 * longMu * load(2, 3);
      let frontForce = requested * frontAxleShare;
      let rearForce = requested - frontForce;
      if (frontForce > frontBudget) {
        rearForce += frontForce - frontBudget;
        frontForce = frontBudget;
      } else if (rearForce > rearBudget) {
        const moved = Math.min(rearForce - rearBudget, frontBudget - frontForce);
        frontForce += moved;
        rearForce -= moved;
      }
      frontAxleShare = requested > 0 ? frontForce / requested : frontAxleShare;
    }

    // Drive asked of the tyres vs their grip, for the visuals only (TireSmoke's launch dust): plain
    // reads of this step's inputs and last step's tyre loads, nothing here feeds back into a force.
    let driveForceN = 0;
    let driveGripN = 0;
    if (throttle > 0 && !reversing && !noDrive) {
      driveForceN = h2 ? driveTorque / car.driveWheelRadius : (p.engineTorque * throttle * drive) / car.driveWheelRadius;
      for (const wheel of this.wheels) {
        if (wheel.driven && vehicle.wheelIsInContact(wheel.index)) driveGripN += longMu * wheelGrip(wheel.index) * (vehicle.wheelSuspensionForce(wheel.index) ?? 0);
      }
    }

    // Handling v2: rear differential lock, moving torque from the faster rear wheel to the slower one
    // (last step's wheel speeds), up to diffLock of the axle's torque.
    let lsd = 0;
    if (h2 && T.diffLock > 0 && !reversing && throttle > 0 && !noDrive) {
      const dOmega = (this.driven[2]!.omega - this.driven[3]!.omega) * this.wheels[2]!.radius;
      lsd = diffLockTransfer(T.diffLock, driveTorque * (1 - frontAxleShare), dOmega, T.diffSlipRef);
    }
    const frontFrac = h2 ? balanceToFrontWeightFraction(p.balance, car) : 0;

    for (const wheel of this.wheels) {
      const i = wheel.index;
      const front = wheel.axle === 'front';
      // Per-wheel surface grip (open worlds); exactly 1 elsewhere, so these multiplies change nothing there.
      const g = wheelGrip(i);
      let friction = traction * g;
      let side = baseSide;
      // v2 tyre: the controller's own load N = the last step's spring force + the anti-roll bar's
      // transfer (every grip budget below reads N, and Rapier's friction cap is scaled to it at the
      // end of the loop); load sensitivity on N, then the friction ellipse from the patch's lateral
      // speed and the longitudinal slip (or brake demand).
      let loadScale = 1;
      let muLat = 1;
      let brakeCap = Infinity;
      let springN = 0;
      let N = 0;
      if (h2) {
        const inContactNow = vehicle.wheelIsInContact(i);
        springN = inContactNow ? Math.min(vehicle.wheelSuspensionForce(i) ?? 0, MAX_SUSPENSION_FORCE) : 0;
        N = inContactNow ? Math.max(0, springN + this.arbLoad[i]!) : 0;
        const N0 = (mass * GRAVITY * (front ? frontFrac : 1 - frontFrac)) / 2;
        loadScale = loadSensitivityScale(N, N0, T.loadSensitivity);
        const lat = Math.abs(this.lateral[i]!);
        const long = wheel.driven && inContactNow ? Math.abs(this.driven[i]!.omega * wheel.radius - this.along[i]!) : 0;
        // The lateral reference grows with speed: a tyre at its peak slip angle slides faster at speed.
        const latRef = Math.max(T.slipLatRef, Math.abs(vFwd) * T.peakSlipRad * T.slipLatPeakRatio);
        const ellipse = frictionEllipseScale(long, lat, T.slipLongRef, latRef);
        friction *= loadScale * ellipse;
        side *= ellipse;
        muLat = lateralBudgetScale(lat, latRef, T.slipLatBudget);
        // ABS cap on the pedal brake (the handbrake is exempt: it is meant to lock the rears).
        brakeCap = assists ? absBrakeCap(friction, N, dt, T.absSlipFactor) : Infinity;
        this.brakeSlide[i] = 0;
      }
      if (wheel.driven) {
        const inContact = vehicle.wheelIsInContact(i);
        const groundSpeed = inContact ? this.contactSpeeds(i).along : vFwd;
        const state = this.driven[i]!;
        // Both pedals: a driven front axle is held by its brakes (line lock) while the rears spin.
        const share = frontAxleShare === car.frontDriveShare ? wheel.driveShare : front ? frontAxleShare / 2 : (1 - frontAxleShare) / 2;
        let torque = noDrive || (front && frontOnlyBrake > 0) ? 0 : h2 ? driveTorque * share : p.engineTorque * share * throttle * drive;
        if (h2 && !front && lsd !== 0) torque += i === 2 ? -lsd : lsd;
        if (assists && inContact && frontOnlyBrake === 0) {
          // Traction control (never during a deliberate burnout): the torque factor drops at once when
          // the slip ratio in the drive direction (last step's wheel speed, against a speed floor so a
          // crawl is not all slip; reverse counts backwards spin) passes tcSlip and climbs back at
          // tcRecover per second; and the torque never asks more than tcGripShare of the tyre's
          // last-step budget μ·N, so a 1st gear worth four times the grip launches at the limit
          // instead of flipping between spin and grip every step.
          const dir: 1 | -1 = torque < 0 ? -1 : 1;
          const slipRatio = driveSlipRatio(state.omega * wheel.radius, groundSpeed, dir, T.tcSpeedFloor);
          const f = tractionControlFactor(this.tcFactor[i]!, slipRatio, T.tcSlip, T.tcGain, T.tcRecover, dt);
          this.tcFactor[i] = f;
          torque *= f;
          const budget = T.tcGripShare * longMu * g * loadScale * muLat * N * wheel.radius;
          if (Math.abs(torque) > budget) torque = dir * budget;
        } else {
          this.tcFactor[i] = 1;
        }
        let force = 0;
        if (handbrake > 0.5 && inContact && !front) {
          state.omega = 0;
          state.locked = false;
        } else if (brake > 0 || torque === 0) {
          if (inContact) rollWithGround(state, groundSpeed, wheel.radius);
          else state.omega *= 0.985;
        } else {
          const out = stepDrivenWheel(state, {
            torque,
            groundSpeed,
            normalLoad: h2 ? N : Math.min(vehicle.wheelSuspensionForce(i) ?? 0, MAX_SUSPENSION_FORCE),
            mu: h2 ? longMu * g * loadScale * muLat : longMu * g,
            radius: wheel.radius,
            inContact,
            dt,
          });
          force = out.force;
        }
        vehicle.setWheelEngineForce(i, force);
        if (h2) {
          const pedal = Math.min((front ? frontBrake : rearPedalBrake) * dt, brakeCap);
          vehicle.setWheelBrake(i, front ? pedal : pedal + rearHandbrake * dt);
        } else {
          vehicle.setWheelBrake(i, (front ? frontBrake : rearBrake) * dt * Math.min(1, g));
        }
        const spin = Math.abs(state.omega * wheel.radius - groundSpeed);
        friction *= 1 - T.spinGripLoss * smoothstep(0, T.spinGripLossFullSlip, inContact ? spin : 0);
      } else {
        vehicle.setWheelEngineForce(i, 0);
        if (h2) {
          const demand = (front ? frontBrake : rearPedalBrake) * dt;
          const pedal = Math.min(demand, brakeCap);
          vehicle.setWheelBrake(i, front ? pedal : pedal + rearHandbrake * dt);
          // Lock-up report: how far the applied pedal impulse exceeds what the tyre can transmit.
          const grip = absBrakeCap(friction, N, dt, T.absSlipFactor);
          this.brakeSlide[i] = grip > 1e-9 ? Math.max(0, pedal / grip - 1) : 0;
        } else {
          vehicle.setWheelBrake(i, (front ? frontBrake : rearBrake) * dt * Math.min(1, g));
        }
      }
      if (handbrake > 0 && !front) {
        friction *= 1 - (1 - T.handbrakeRearFriction) * handbrake;
        side *= 1 - (1 - T.handbrakeRearSideStiffness) * handbrake;
      }
      // v2: Rapier caps the tyre at frictionSlip × its own spring force, which never sees the bar's
      // transfer; scaled by N / spring the cap reads the controller's N, so the budget is μ·N.
      if (h2) friction = frictionSlipForLoad(friction, N, springN);
      vehicle.setWheelFrictionSlip(i, friction);
      vehicle.setWheelSideFrictionStiffness(i, side);
    }

    vehicle.updateVehicle(dt, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS);
    let grounded = 0;
    for (const wheel of this.wheels) if (vehicle.wheelIsInContact(wheel.index)) grounded++;
    if (h2) this.applyAntiRoll(dt);

    // ── Aero + drag as per-step impulses (addForce would persist across steps) ──
    const t = body.translation();
    const { frontAxleZ, rearAxleZ } = this.spec;
    const frontGround = this.updateGroundEffect(0, t, frontAxleZ, vehicle.wheelIsInContact(0) || vehicle.wheelIsInContact(1), dt);
    const rearGround = this.updateGroundEffect(1, t, rearAxleZ, vehicle.wheelIsInContact(2) || vehicle.wheelIsInContact(3), dt);
    const v2 = vFwd * vFwd;
    this.updateAeroDirection();
    const frontAero = (p.frontDownforce - car.frontBodyLift) * v2 * frontGround;
    const rearAero = car.rearDownforce * v2 * rearGround;
    this.applyVerticalImpulseAt(t, frontAxleZ, frontAero * dt);
    this.applyVerticalImpulseAt(t, rearAxleZ, rearAero * dt);

    const speed = vel.length();
    // Rolling resistance (part of the protocol's top-speed estimate), faded in near standstill.
    const rolling = speed > 0.05 ? car.rollingResistance * mass * GRAVITY * (grounded / 4) * Math.min(1, speed / 0.5) : 0;
    const dragMag = p.drag * speed * speed;
    if (speed > 1e-3) {
      const k = -((dragMag + rolling) / speed) * dt;
      this.impulse.x = vel.x * k;
      this.impulse.y = vel.y * k;
      this.impulse.z = vel.z * k;
      body.applyImpulse(this.impulse, true);
    }

    if (grounded === 0) this.applyAirborneMoments(dt, speed);

    // ── Runtime (inputs, aero, wheels) ──
    const rt = carRuntime;
    rt.throttle = throttle;
    rt.brake = Math.max(brake, frontOnlyBrake);
    rt.steer = input.steer;
    rt.handbrake = handbrake;
    rt.reversing = reversing;
    rt.frontAeroN = frontAero;
    rt.rearAeroN = rearAero;
    rt.dragN = dragMag;
    rt.groundEffect = 0.5 * (frontGround + rearGround);
    rt.driveForceN = driveForceN;
    rt.driveGripN = driveGripN;
    this.updateWheelRuntime(dt, vFwd, frontAero, mass * GRAVITY * balanceToFrontWeightFraction(p.balance, car));
  }

  /** Pose/velocity after the world integrated. Runs inside useAfterPhysicsStep. */
  afterStep(dt: number): void {
    const { body } = this;
    const rt = carRuntime;
    const t = body.translation();
    const r = body.rotation();
    const lv = body.linvel();
    const av = body.angvel();
    rt.position.set(t.x, t.y, t.z);
    rt.quaternion.set(r.x, r.y, r.z, r.w);
    rt.velocity.set(lv.x, lv.y, lv.z);
    rt.angularVelocity.set(av.x, av.y, av.z);
    rt.forward.set(0, 0, 1).applyQuaternion(rt.quaternion);
    rt.up.set(0, 1, 0).applyQuaternion(rt.quaternion);
    rt.right.set(-1, 0, 0).applyQuaternion(rt.quaternion);
    rt.forwardSpeed = rt.velocity.dot(rt.forward);
    rt.speedKmh = Math.abs(rt.forwardSpeed) * 3.6;
    rt.airborneTime = rt.wheelsGrounded === 0 ? rt.airborneTime + dt : 0;
    rt.stepCount += 1;
    rt.simTime += dt;
    rt.ready = true;
  }

  /** Place the car (ground point + ride height), stopped, facing `yaw`. */
  teleport(groundPosition: Tuple3, yaw: number): void {
    const { body } = this;
    const rideHeight = this.spec.rideHeight;
    body.setTranslation({ x: groundPosition[0], y: groundPosition[1] + rideHeight + 0.12, z: groundPosition[2] }, true);
    body.setRotation(yawToQuaternion(yaw), true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.resetForces(true);
    body.resetTorques(true);
    this.steerAngle = 0;
    this.frontOffTime = 0;
    this.frontTouchedSinceAirborne = true;
    this.groundEffect[0] = 1;
    this.groundEffect[1] = 1;
    for (const wheel of this.wheels) {
      resetDrivenWheel(this.driven[wheel.index]!);
      this.vehicle.setWheelSteering(wheel.index, 0);
      this.vehicle.setWheelEngineForce(wheel.index, 0);
      this.arbLoad[wheel.index] = 0;
      this.brakeSlide[wheel.index] = 0;
      this.tcFactor[wheel.index] = 1;
    }
    if (this.gearbox) this.gearbox.reset();
    const rt = carRuntime;
    rt.position.set(groundPosition[0], groundPosition[1] + rideHeight + 0.12, groundPosition[2]);
    rt.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    rt.velocity.set(0, 0, 0);
    rt.angularVelocity.set(0, 0, 0);
    rt.forwardSpeed = 0;
    rt.speedKmh = 0;
    rt.noseLift = false;
    rt.airborneTime = 0;
  }

  /**
   * Handling v2 anti-roll bars: each axle's bar resists roll with a couple of antiRoll × (travel
   * difference) across the track, applied to the chassis as one roll torque impulse (no force on any
   * contact point: Rapier's suspension never sees it), and the same force is the load the bar moves
   * from the extended tyre onto the compressed one (`arbLoad`), which the next step adds to the
   * springs' loads for its own N — load sensitivity, the friction ellipse, the drive budgets and the
   * friction cap all read that N, so a stiff bar moves grip across the axle and never adds any.
   */
  private applyAntiRoll(dt: number): void {
    const { vehicle, up, T } = this;
    for (let axle = 0; axle < 2; axle++) {
      const l = axle * 2;
      const r = l + 1;
      const k = axle === 0 ? T.antiRollFrontN_m : T.antiRollRearN_m;
      if (k <= 0 || !vehicle.wheelIsInContact(l) || !vehicle.wheelIsInContact(r)) {
        this.arbLoad[l] = 0;
        this.arbLoad[r] = 0;
        continue;
      }
      // Left shorter (more compressed) ⇒ the bar lifts the body at the left wheel (+ load there), never
      // more than the other tyre's spring carries (a tyre at full droop has no load left to hand over).
      const forceL = antiRollTransferN(
        k,
        vehicle.wheelSuspensionLength(l) ?? 0,
        vehicle.wheelSuspensionLength(r) ?? 0,
        Math.min(vehicle.wheelSuspensionForce(l) ?? 0, MAX_SUSPENSION_FORCE),
        Math.min(vehicle.wheelSuspensionForce(r) ?? 0, MAX_SUSPENSION_FORCE),
      );
      this.arbLoad[l] = forceL;
      this.arbLoad[r] = -forceL;
      if (forceL === 0) continue;
      const cl = vehicle.wheelContactPoint(l);
      const cr = vehicle.wheelContactPoint(r);
      if (!cl || !cr) continue;
      // The couple (+F·up at the left contact, −F·up at the right) as a torque: (c_l − c_r) × F·up·dt.
      this.tmp.set(cl.x - cr.x, cl.y - cr.y, cl.z - cr.z);
      this.tmp2.copy(up).multiplyScalar(forceL * dt);
      this.tmp.cross(this.tmp2);
      this.impulse.x = this.tmp.x;
      this.impulse.y = this.tmp.y;
      this.impulse.z = this.tmp.z;
      this.body.applyTorqueImpulse(this.impulse, true);
    }
  }

  /**
   * Ground-effect factor for one axle's vertical aero force. Full strength while that axle's
   * tyres touch or it is within groundEffectFullRise of its normal height above the surface below
   * (so a wheelie keeps its lift); beyond that it decays exponentially, to groundEffectMin over
   * the void. Per axle, so at a lip the front wing loses its ground effect as soon as it is over
   * the edge instead of levering the car up while the rear tyres are still on the ramp.
   */
  private updateGroundEffect(axle: 0 | 1, t: { x: number; y: number; z: number }, axleZ: number, axleGrounded: boolean, dt: number): number {
    const T = this.T;
    const rideHeight = this.spec.rideHeight;
    let target = 1;
    if (!axleGrounded) {
      this.tmp.set(0, 0, axleZ).applyQuaternion(this.q);
      const ray = this.groundRay;
      ray.origin.x = t.x + this.tmp.x;
      ray.origin.y = t.y + this.tmp.y;
      ray.origin.z = t.z + this.tmp.z;
      const hit = this.world.castRay(
        ray,
        rideHeight + T.groundEffectRange,
        true,
        this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        this.chassisCollider ?? undefined,
        this.body,
      );
      const rise = hit ? hit.timeOfImpact - rideHeight - T.groundEffectFullRise : Infinity;
      if (rise > 0) target = T.groundEffectMin + (1 - T.groundEffectMin) * Math.exp(-rise / T.groundEffectHeight);
    }
    const f = this.groundEffect[axle]! + (target - this.groundEffect[axle]!) * Math.min(1, dt / T.groundEffectTau);
    this.groundEffect[axle] = f;
    return f;
  }

  /**
   * Downforce direction: chassis −up (the original model), or with `aeroNormalToFlow` −up with its
   * component along the velocity removed — lift acts across the airflow, so a car squatting nose-up
   * under big rear downforce isn't pushed forward by its own wing.
   */
  private updateAeroDirection(): void {
    const { up, vel, aeroDown } = this;
    aeroDown.copy(up).negate();
    if (!this.T.aeroNormalToFlow) return;
    const speed = vel.length();
    if (speed < 1) return;
    const along = aeroDown.dot(vel) / speed;
    aeroDown.addScaledVector(vel, -along / speed).normalize();
  }

  private applyVerticalImpulseAt(t: { x: number; y: number; z: number }, axleZ: number, downImpulse: number): void {
    if (downImpulse === 0) return;
    // Any point on the axle's vertical line gives the same moment; use the axle centre in the chassis frame.
    this.tmp.set(0, 0, axleZ).applyQuaternion(this.q);
    this.point.x = t.x + this.tmp.x;
    this.point.y = t.y + this.tmp.y;
    this.point.z = t.z + this.tmp.z;
    // +downImpulse pushes along the downforce direction (−up); negative lifts.
    this.impulse.x = this.aeroDown.x * downImpulse;
    this.impulse.y = this.aeroDown.y * downImpulse;
    this.impulse.z = this.aeroDown.z * downImpulse;
    this.body.applyImpulseAtPoint(this.impulse, this.point, true);
  }

  private applyAirborneMoments(dt: number, speed: number): void {
    const T = this.T;
    const blend = clamp((carRuntime.airborneTime + dt) / T.airBlendTime, 0, 1);
    if (blend <= 0) return;
    const { body, up, right, fwd, vel } = this;
    const av = body.angvel();
    this.tmp2.set(av.x, av.y, av.z);
    // Nose above the flight path ⇒ velocity has a negative component along chassis up.
    const sinAoa = speed > 1 ? clamp(-vel.dot(up) / speed, -1, 1) : 0;
    const pitchRate = this.tmp2.dot(right); // + = nose rising (rotation about the right axis)
    const rollRate = this.tmp2.dot(fwd);
    const pitchTorque = -(T.airPitchStiffness * speed * speed * sinAoa) - (T.airPitchDamping * speed + T.airPitchDampingBase) * pitchRate;
    const rollTorque = -T.airRollDamping * rollRate;
    const k = blend * dt;
    this.impulse.x = (right.x * pitchTorque + fwd.x * rollTorque) * k;
    this.impulse.y = (right.y * pitchTorque + fwd.y * rollTorque) * k;
    this.impulse.z = (right.z * pitchTorque + fwd.z * rollTorque) * k;
    body.applyTorqueImpulse(this.impulse, true);
  }

  /**
   * Contact-patch velocity of wheel i relative to whatever it stands on, decomposed along the
   * tyre's rolling direction and its axle (projected onto the contact plane).
   */
  private contactSpeeds(i: number): { readonly along: number; readonly lateral: number } {
    const { vehicle, body, speeds } = this;
    const cp = vehicle.wheelContactPoint(i);
    const cn = vehicle.wheelContactNormal(i);
    if (!cp || !cn) {
      speeds.along = 0;
      speeds.lateral = 0;
      return speeds;
    }
    this.contact.set(cp.x, cp.y, cp.z);
    this.normal.set(cn.x, cn.y, cn.z);
    const v = body.velocityAtPoint(cp);
    this.relVel.set(v.x, v.y, v.z);
    const ground = vehicle.wheelGroundObject(i);
    const groundBody = ground ? groundParent(ground) : null;
    if (groundBody && !groundBody.isFixed()) {
      const gv = groundBody.velocityAtPoint(cp);
      this.relVel.x -= gv.x;
      this.relVel.y -= gv.y;
      this.relVel.z -= gv.z;
    }
    const steer = vehicle.wheelSteering(i) ?? 0;
    this.wheelFwd.set(Math.sin(steer), 0, Math.cos(steer)).applyQuaternion(this.q);
    this.wheelLat.set(Math.cos(steer), 0, -Math.sin(steer)).applyQuaternion(this.q);
    this.wheelFwd.addScaledVector(this.normal, -this.wheelFwd.dot(this.normal)).normalize();
    this.wheelLat.addScaledVector(this.normal, -this.wheelLat.dot(this.normal)).normalize();
    speeds.along = this.relVel.dot(this.wheelFwd);
    speeds.lateral = this.relVel.dot(this.wheelLat);
    return speeds;
  }

  private updateWheelRuntime(dt: number, vFwd: number, frontAero: number, staticFrontLoad: number): void {
    const { vehicle, T } = this;
    const rt = carRuntime;
    let grounded = 0;
    let frontLoad = 0;
    let rearLoad = 0;
    let rearSlip = 0;
    for (const wheel of this.wheels) {
      const i = wheel.index;
      const w = rt.wheels[i]!;
      const inContact = vehicle.wheelIsInContact(i);
      const rapierRotation = vehicle.wheelRotation(i) ?? 0;
      const rapierSpin = (rapierRotation - this.prevRapierRotation[i]!) / dt;
      this.prevRapierRotation[i] = rapierRotation;

      w.inContact = inContact;
      w.steering = vehicle.wheelSteering(i) ?? 0;
      w.suspensionLength = vehicle.wheelSuspensionLength(i) ?? this.spec.suspensionRestLength;
      w.suspensionForce = inContact ? Math.min(vehicle.wheelSuspensionForce(i) ?? 0, MAX_SUSPENSION_FORCE) : 0;
      const ground = inContact ? vehicle.wheelGroundObject(i) : null;
      w.groundColliderHandle = ground ? ground.handle : null;
      if (inContact) {
        const cp = vehicle.wheelContactPoint(i);
        const cn = vehicle.wheelContactNormal(i);
        if (cp) w.contactPointWorld.set(cp.x, cp.y, cp.z);
        if (cn) w.contactNormalWorld.set(cn.x, cn.y, cn.z);
      }

      if (wheel.driven) {
        const state = this.driven[i]!;
        w.spinRate = state.omega;
        w.rotation += state.omega * dt;
      } else {
        w.spinRate = rapierSpin;
        w.rotation = rapierRotation;
      }

      if (inContact) {
        const speeds = this.contactSpeeds(i);
        w.lateralSlip = Math.abs(speeds.lateral);
        w.longitudinalSlip = Math.abs(w.spinRate * wheel.radius - speeds.along);
        // v2: an undriven tyre whose brake exceeds its grip slides along the road (Rapier keeps it rolling visually).
        if (this.v2 && !wheel.driven && this.brakeSlide[i]! > 0) w.longitudinalSlip = Math.max(w.longitudinalSlip, Math.abs(speeds.along) * Math.min(1, this.brakeSlide[i]!));
        w.slip01 = smoothstep(T.slipStart, T.slipFull, Math.hypot(w.lateralSlip, w.longitudinalSlip));
        grounded++;
      } else {
        w.lateralSlip = 0;
        w.longitudinalSlip = 0;
        w.slip01 = 0;
      }
      if (wheel.axle === 'front') frontLoad += w.suspensionForce;
      else {
        rearLoad += w.suspensionForce;
        rearSlip = Math.max(rearSlip, w.slip01);
      }
    }
    // Keep rotation bounded so float precision never degrades the visual spin.
    for (const w of rt.wheels) if (Math.abs(w.rotation) > 1e4) w.rotation %= Math.PI * 2;

    rt.wheelsGrounded = grounded;
    rt.frontAxleLoadN = frontLoad;
    rt.rearAxleLoadN = rearLoad;
    rt.rearSlip = rearSlip;

    const frontOff = !rt.wheels[0]!.inContact && !rt.wheels[1]!.inContact;
    const rearOn = rt.wheels[2]!.inContact || rt.wheels[3]!.inContact;
    if (grounded === 0) this.frontTouchedSinceAirborne = false;
    else if (!frontOff) this.frontTouchedSinceAirborne = true;
    // Aero must be doing the lifting: a landing bounce at modest lift is not a nose lift.
    const lifting = frontAero < -T.noseLiftMinLiftRatio * staticFrontLoad && Math.abs(vFwd) > T.noseLiftMinSpeed;
    this.frontOffTime = frontOff && lifting ? this.frontOffTime + dt : 0;
    // A lift must start from all four tyres down (a rear-first landing is not a nose lift), and
    // stays latched while the front is up under lift, even if the rear follows it into the air.
    rt.noseLift =
      this.frontOffTime >= T.noseLiftDebounce && (rt.noseLift || (rearOn && this.frontTouchedSinceAirborne));
  }
}

function toVec(t: Tuple3): { x: number; y: number; z: number } {
  return { x: t[0], y: t[1], z: t[2] };
}

function groundParent(collider: Collider): RigidBody | null {
  try {
    return collider.parent();
  } catch {
    return null;
  }
}
