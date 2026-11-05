/**
 * The car's physics, one fixed step at a time. Owns the Rapier raycast-vehicle controller and
 * applies the protocol's F1-style model (see "Physics model" in shared/protocol.ts):
 *
 *   drive      RWD, (engineTorque / 2) per rear wheel through the wheelspin model (drivetrain.ts)
 *   front aero (frontDownforce − FRONT_BODY_LIFT)·v_fwd² along −up AT THE FRONT AXLE (lift if < 0)
 *   rear aero  REAR_DOWNFORCE·v_fwd² at the rear axle
 *   drag       −drag·v·|v| at the centre of mass (+ rolling resistance while grounded)
 *   balance    centre of mass along the axis + per-axle spring/damper split
 *   traction   friction slip / side stiffness on every tyre
 *
 * Every parameter is read from the store each step, so changes apply on the next step.
 */
import type { Collider, DynamicRayCastVehicleController, RigidBody, World } from '@dimforge/rapier3d-compat';
import type * as RapierModule from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import {
  FRONT_BODY_LIFT,
  GRAVITY,
  REAR_DOWNFORCE,
  ROLLING_RESISTANCE,
  balanceToSuspensionStiffness,
  type CarPhysicsParams,
} from '@shared/protocol';
import { CAR_TUNING as T } from './tuning';
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
  FRONT_AXLE_Z,
  MAX_SUSPENSION_FORCE,
  MAX_SUSPENSION_TRAVEL,
  REAR_AXLE_Z,
  RIDE_HEIGHT,
  SUSPENSION_DIRECTION,
  SUSPENSION_REST_LENGTH,
  UP_AXIS_INDEX,
  WHEELS,
  WHEEL_AXLE,
  centerOfMassForBalance,
  chassisInertia,
  type Tuple3,
} from './vehicleSpec';

type Rapier = typeof RapierModule;

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
  private readonly world: World;
  private readonly rapier: Rapier;
  private readonly body: RigidBody;

  private appliedMass = NaN;
  private appliedBalance = NaN;
  private steerAngle = 0;
  private frontOffTime = 0;
  private readonly driven: DrivenWheelState[] = WHEELS.map(() => createDrivenWheelState());
  private readonly prevRapierRotation: number[] = WHEELS.map(() => 0);
  private readonly rawInput: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

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
  private readonly impulse = { x: 0, y: 0, z: 0 };

  constructor(world: World, rapier: Rapier, body: RigidBody) {
    this.world = world;
    this.rapier = rapier;
    this.body = body;
    const vehicle = world.createVehicleController(body);
    vehicle.indexUpAxis = UP_AXIS_INDEX;
    // In rapier3d-compat 0.19 the forward-axis setter is a property literally named `setIndexForwardAxis`.
    vehicle.setIndexForwardAxis = FORWARD_AXIS_INDEX;
    const dir = toVec(SUSPENSION_DIRECTION);
    const axle = toVec(WHEEL_AXLE);
    for (const wheel of WHEELS) {
      vehicle.addWheel(toVec(wheel.connection), dir, axle, SUSPENSION_REST_LENGTH, wheel.radius);
      vehicle.setWheelMaxSuspensionTravel(wheel.index, MAX_SUSPENSION_TRAVEL);
      vehicle.setWheelMaxSuspensionForce(wheel.index, MAX_SUSPENSION_FORCE);
    }
    this.vehicle = vehicle;
  }

  dispose(): void {
    try {
      this.world.removeVehicleController(this.vehicle);
    } catch {
      // The world may already have been freed (Physics unmounted first); nothing left to release.
    }
  }

  /** Mass / centre of mass / springs. Called every step; only touches Rapier when values change. */
  applyParams(p: CarPhysicsParams): void {
    if (p.mass !== this.appliedMass || p.balance !== this.appliedBalance) {
      const com = centerOfMassForBalance(p.balance);
      const inertia = chassisInertia(p.mass);
      // The chassis collider has zero density: all mass comes from here, so COM is exactly ours.
      this.body.setAdditionalMassProperties(p.mass, toVec(com), toVec(inertia), IDENTITY_ROTATION, true);
      this.body.recomputeMassPropertiesFromColliders();
      this.appliedMass = p.mass;
    }
    if (p.balance !== this.appliedBalance) {
      const stiffness = balanceToSuspensionStiffness(p.balance);
      for (const wheel of WHEELS) {
        const k = wheel.axle === 'front' ? stiffness.front : stiffness.rear;
        this.vehicle.setWheelSuspensionStiffness(wheel.index, k);
        this.vehicle.setWheelSuspensionCompression(wheel.index, T.dampingCompressionRatio * Math.sqrt(k));
        this.vehicle.setWheelSuspensionRelaxation(wheel.index, T.dampingRelaxationRatio * Math.sqrt(k));
      }
      this.appliedBalance = p.balance;
    }
  }

  /** Inputs → forces → vehicle update → aero. Runs inside useBeforePhysicsStep. */
  beforeStep(dt: number, p: CarPhysicsParams): void {
    const { body, vehicle, fwd, up, right, vel } = this;
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

    // ── Speed-sensitive steering with slew-rate limiting ──
    const maxSteer = Math.max(T.steerMin, T.steerMax / (1 + Math.abs(vFwd) / T.steerSpeedFalloff));
    // Positive Rapier steering turns the nose toward +X (driver's left), so right input is negative.
    const target = -input.steer * maxSteer;
    const returning = Math.abs(target) < Math.abs(this.steerAngle) || Math.sign(target) !== Math.sign(this.steerAngle);
    const rate = (returning ? T.steerReturnRate : T.steerRate) * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    vehicle.setWheelSteering(0, this.steerAngle);
    vehicle.setWheelSteering(1, this.steerAngle);

    // ── Brakes (Rapier brake = max impulse per step) ──
    const brakeForce = T.brakeForceG * mass * GRAVITY * brake;
    const idleHold = throttle === 0 && brake === 0 && Math.abs(vFwd) < T.idleHoldSpeed ? 0.25 * mass * GRAVITY : 0;
    const frontBrake = (brakeForce * T.brakeFrontShare + idleHold * 0.5 + frontOnlyBrake * 1.2 * mass * GRAVITY) / 2;
    const rearBrake = (brakeForce * (1 - T.brakeFrontShare) + idleHold * 0.5) / 2 + handbrake * T.handbrakeForceN * 0.5;

    // ── Drive + friction per wheel ──
    let torquePerWheel = (p.engineTorque / 2) * throttle * (reversing ? -T.reverseTorqueRatio : 1);
    if (reversing && vFwd < -T.reverseMaxSpeed) torquePerWheel = 0;
    const baseSide = clamp(T.sideStiffnessBase + T.sideStiffnessPerTraction * p.traction, T.sideStiffnessMin, 1);
    const longMu = p.traction * T.longitudinalGripRatio;

    for (const wheel of WHEELS) {
      const i = wheel.index;
      let friction = p.traction;
      let side = baseSide;
      if (wheel.driven) {
        const inContact = vehicle.wheelIsInContact(i);
        const groundSpeed = inContact ? this.contactSpeeds(i).along : vFwd;
        const state = this.driven[i]!;
        let force = 0;
        if (handbrake > 0.5 && inContact) {
          state.omega = 0;
          state.locked = false;
        } else if (brake > 0 || torquePerWheel === 0) {
          if (inContact) rollWithGround(state, groundSpeed, wheel.radius);
          else state.omega *= 0.985;
        } else {
          const out = stepDrivenWheel(state, {
            torque: torquePerWheel,
            groundSpeed,
            normalLoad: Math.min(vehicle.wheelSuspensionForce(i) ?? 0, MAX_SUSPENSION_FORCE),
            mu: longMu,
            radius: wheel.radius,
            inContact,
            dt,
          });
          force = out.force;
        }
        vehicle.setWheelEngineForce(i, force);
        vehicle.setWheelBrake(i, rearBrake * dt);
        const spin = Math.abs(state.omega * wheel.radius - groundSpeed);
        friction *= 1 - T.spinGripLoss * smoothstep(0, T.spinGripLossFullSlip, inContact ? spin : 0);
        if (handbrake > 0) {
          friction *= 1 - (1 - T.handbrakeRearFriction) * handbrake;
          side *= 1 - (1 - T.handbrakeRearSideStiffness) * handbrake;
        }
      } else {
        vehicle.setWheelEngineForce(i, 0);
        vehicle.setWheelBrake(i, frontBrake * dt);
      }
      vehicle.setWheelFrictionSlip(i, friction);
      vehicle.setWheelSideFrictionStiffness(i, side);
    }

    vehicle.updateVehicle(dt, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS);

    // ── Aero + drag as per-step impulses (addForce would persist across steps) ──
    const t = body.translation();
    const v2 = vFwd * vFwd;
    const frontAero = (p.frontDownforce - FRONT_BODY_LIFT) * v2;
    const rearAero = REAR_DOWNFORCE * v2;
    this.applyVerticalImpulseAt(t, FRONT_AXLE_Z, -frontAero * dt);
    this.applyVerticalImpulseAt(t, REAR_AXLE_Z, -rearAero * dt);

    const speed = vel.length();
    let grounded = 0;
    for (const wheel of WHEELS) if (vehicle.wheelIsInContact(wheel.index)) grounded++;
    // Rolling resistance (part of the protocol's top-speed estimate), faded in near standstill.
    const rolling = speed > 0.05 ? ROLLING_RESISTANCE * mass * GRAVITY * (grounded / 4) * Math.min(1, speed / 0.5) : 0;
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
    this.updateWheelRuntime(dt, vFwd, frontAero);
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
    body.setTranslation({ x: groundPosition[0], y: groundPosition[1] + RIDE_HEIGHT + 0.12, z: groundPosition[2] }, true);
    body.setRotation(yawToQuaternion(yaw), true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.resetForces(true);
    body.resetTorques(true);
    this.steerAngle = 0;
    this.frontOffTime = 0;
    for (const wheel of WHEELS) {
      resetDrivenWheel(this.driven[wheel.index]!);
      this.vehicle.setWheelSteering(wheel.index, 0);
      this.vehicle.setWheelEngineForce(wheel.index, 0);
    }
    const rt = carRuntime;
    rt.position.set(groundPosition[0], groundPosition[1] + RIDE_HEIGHT + 0.12, groundPosition[2]);
    rt.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    rt.velocity.set(0, 0, 0);
    rt.angularVelocity.set(0, 0, 0);
    rt.forwardSpeed = 0;
    rt.speedKmh = 0;
    rt.noseLift = false;
    rt.airborneTime = 0;
  }

  private applyVerticalImpulseAt(t: { x: number; y: number; z: number }, axleZ: number, downImpulse: number): void {
    if (downImpulse === 0) return;
    // Any point on the axle's vertical line gives the same moment; use the axle centre in the chassis frame.
    this.tmp.set(0, 0, axleZ).applyQuaternion(this.q);
    this.point.x = t.x + this.tmp.x;
    this.point.y = t.y + this.tmp.y;
    this.point.z = t.z + this.tmp.z;
    // +downImpulse pushes along −up (downforce); negative lifts.
    this.impulse.x = -this.up.x * downImpulse;
    this.impulse.y = -this.up.y * downImpulse;
    this.impulse.z = -this.up.z * downImpulse;
    this.body.applyImpulseAtPoint(this.impulse, this.point, true);
  }

  private applyAirborneMoments(dt: number, speed: number): void {
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
  private contactSpeeds(i: number): { along: number; lateral: number } {
    const { vehicle, body } = this;
    const cp = vehicle.wheelContactPoint(i);
    const cn = vehicle.wheelContactNormal(i);
    if (!cp || !cn) return { along: 0, lateral: 0 };
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
    return { along: this.relVel.dot(this.wheelFwd), lateral: this.relVel.dot(this.wheelLat) };
  }

  private updateWheelRuntime(dt: number, vFwd: number, frontAero: number): void {
    const { vehicle } = this;
    const rt = carRuntime;
    let grounded = 0;
    let frontLoad = 0;
    let rearLoad = 0;
    let rearSlip = 0;
    for (const wheel of WHEELS) {
      const i = wheel.index;
      const w = rt.wheels[i]!;
      const inContact = vehicle.wheelIsInContact(i);
      const rapierRotation = vehicle.wheelRotation(i) ?? 0;
      const rapierSpin = (rapierRotation - this.prevRapierRotation[i]!) / dt;
      this.prevRapierRotation[i] = rapierRotation;

      w.inContact = inContact;
      w.steering = vehicle.wheelSteering(i) ?? 0;
      w.suspensionLength = vehicle.wheelSuspensionLength(i) ?? SUSPENSION_REST_LENGTH;
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
    const lifting = frontAero < 0 && Math.abs(vFwd) > T.noseLiftMinSpeed;
    this.frontOffTime = frontOff && lifting ? this.frontOffTime + dt : 0;
    // Latched while the front stays up under lift, even if the rear follows it into the air.
    rt.noseLift = this.frontOffTime >= T.noseLiftDebounce && (rearOn || rt.noseLift);
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
