/**
 * Rear-wheel drive with a 1-DOF wheel per driven tyre (Coulomb friction, no traction control).
 *
 * Rapier's raycast vehicle ties wheel rotation to ground speed and applies whatever engine
 * force it is given, so it cannot spin a tyre on its own. Here each driven wheel has an
 * angular speed ω. While the requested contact force (torque / r) fits inside the grip
 * budget μ·N the tyre rolls with the ground and transmits it all; once the torque exceeds
 * the budget the wheel breaks loose, transmits only kinetic friction and the excess torque
 * spins it up — that is the wheelspin/tyre smoke at high engine tiers. It re-grips when the
 * slip closes and the request fits inside the budget again.
 */

export interface DrivenWheelState {
  /** Wheel angular speed, rad/s (positive = rolling forward). */
  omega: number;
  /** Rolling with the ground (static friction) vs spinning/sliding (kinetic friction). */
  locked: boolean;
}

export interface DrivenWheelInput {
  /** Drive torque at this wheel, N·m (negative = reverse). */
  torque: number;
  /** Ground velocity at the contact patch along the tyre's rolling direction, m/s. */
  groundSpeed: number;
  /** Tyre normal load, N. */
  normalLoad: number;
  /** Longitudinal friction coefficient. */
  mu: number;
  radius: number;
  inContact: boolean;
  dt: number;
}

export interface DrivenWheelOutput {
  /** Force to feed to the vehicle as this wheel's engine force, N. */
  force: number;
  /** |ω·r − groundSpeed|, m/s. */
  slipSpeed: number;
}

/** Wheel + driveline inertia seen at one rear wheel, kg·m². */
export const DRIVEN_WHEEL_INERTIA = 1.5;
/** Sliding grip as a fraction of peak grip; < 1 so a spinning tyre needs a lift to hook up again. */
export const KINETIC_GRIP_RATIO = 0.93;
/** "Rev limiter": the tyre surface never outruns the ground by more than this, m/s. */
export const MAX_SLIP_SPEED = 22;
/** Free (airborne) wheel spin decay per step. */
const AIR_SPIN_DECAY = 0.985;

export function createDrivenWheelState(): DrivenWheelState {
  return { omega: 0, locked: true };
}

export function resetDrivenWheel(state: DrivenWheelState, groundSpeed = 0, radius = 1): void {
  state.omega = groundSpeed / radius;
  state.locked = true;
}

/** Hold the wheel at ground speed (braking / no drive, wheel follows the road). */
export function rollWithGround(state: DrivenWheelState, groundSpeed: number, radius: number): void {
  state.omega = groundSpeed / radius;
  state.locked = true;
}

export function stepDrivenWheel(state: DrivenWheelState, input: DrivenWheelInput): DrivenWheelOutput {
  const { torque, groundSpeed, normalLoad, mu, radius, dt } = input;

  if (!input.inContact || normalLoad <= 0) {
    state.omega = (state.omega + (torque / DRIVEN_WHEEL_INERTIA) * dt) * AIR_SPIN_DECAY;
    const limit = (Math.abs(groundSpeed) + MAX_SLIP_SPEED) / radius;
    state.omega = Math.max(-limit, Math.min(limit, state.omega));
    state.locked = false;
    return { force: 0, slipSpeed: 0 };
  }

  const requested = torque / radius;
  const grip = mu * normalLoad;

  if (state.locked) {
    if (Math.abs(requested) <= grip) {
      state.omega = groundSpeed / radius;
      return { force: requested, slipSpeed: 0 };
    }
    // Torque overwhelms the tyre: break loose in the direction of the torque.
    state.locked = false;
    state.omega = groundSpeed / radius;
  }

  const slipBefore = state.omega * radius - groundSpeed;
  const direction = Math.abs(slipBefore) > 1e-4 ? Math.sign(slipBefore) : Math.sign(requested) || 1;
  const kinetic = direction * grip * KINETIC_GRIP_RATIO;
  state.omega += ((torque - kinetic * radius) / DRIVEN_WHEEL_INERTIA) * dt;

  const slipAfter = state.omega * radius - groundSpeed;
  if (Math.sign(slipAfter) !== direction) {
    // Slip closed within this step.
    state.omega = groundSpeed / radius;
    if (Math.abs(requested) <= grip) {
      state.locked = true;
      return { force: requested, slipSpeed: 0 };
    }
    return { force: kinetic, slipSpeed: 0 };
  }

  const maxOmega = (groundSpeed + MAX_SLIP_SPEED) / radius;
  const minOmega = (groundSpeed - MAX_SLIP_SPEED) / radius;
  state.omega = Math.max(minOmega, Math.min(maxOmega, state.omega));
  return { force: kinetic, slipSpeed: Math.abs(state.omega * radius - groundSpeed) };
}
