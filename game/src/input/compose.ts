/**
 * Pure composition of the phone/pad input sources into the one "touch" input the car reads
 * (`car/input.ts setTouchInput`, merged there with the keyboard, the drive lock and the debug
 * override exactly as before). No DOM, no stores: the unit test imports this file directly.
 *
 * Rules (PLAN-M1 §2 B): steer = gamepad stick when it is outside its dead zone, else tilt when tilt
 * is enabled (the ◀ ▶ pad is hidden then), else the touch pad; throttle and brake = the max of the
 * sources; handbrake = any source. With tilt off and no gamepad the result is the touch input
 * unchanged, so the keyboard/replay harness feeds the controller exactly what it fed before.
 */
import type { DriverInput } from '../car/input';

/** One sampled gamepad frame (input/gamepad.ts readPad). */
export interface PadFrame {
  /** −1…1 after dead zone and response curve; d-pad left/right give ∓1. */
  steer: number;
  /** 0…1 (RT). */
  throttle: number;
  /** 0…1 (LT). */
  brake: number;
  /** A held. */
  handbrake: boolean;
  /** B held (respawn on press). */
  respawn: boolean;
  /** Y held (restart on press). */
  restart: boolean;
  /** Start held (menu on press). */
  menu: boolean;
}

export const emptyPadFrame = (): PadFrame => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, respawn: false, restart: false, menu: false });

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @param touch   the on-screen controls (all zero while nothing is held)
 * @param tilt    the tilt steer −1…1, or null while tilt steering is off
 * @param pad     the latest gamepad frame, or null while no gamepad is connected
 */
export function composeInput(touch: DriverInput, tilt: number | null, pad: PadFrame | null, out: DriverInput): DriverInput {
  let steer = touch.steer;
  if (tilt !== null) steer = tilt;
  if (pad && pad.steer !== 0) steer = pad.steer;
  out.steer = clamp(steer, -1, 1);
  out.throttle = clamp(Math.max(touch.throttle, pad ? pad.throttle : 0), 0, 1);
  out.brake = clamp(Math.max(touch.brake, pad ? pad.brake : 0), 0, 1);
  out.handbrake = clamp(Math.max(touch.handbrake, pad && pad.handbrake ? 1 : 0), 0, 1);
  return out;
}
