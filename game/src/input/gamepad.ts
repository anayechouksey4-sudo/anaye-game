/**
 * Standard-mapping gamepad → one PadFrame per poll (pure; the bus polls `navigator.getGamepads()`
 * in its loop). Left stick X steers (dead zone 0.12, response curve ^1.5), D-pad left/right give
 * full lock, RT throttle, LT brake, A handbrake, B respawn, Y restart, Start menu.
 */
import type { PadFrame } from './compose';

export const STICK_DEADZONE = 0.12;
export const STICK_CURVE = 1.5;

/** Button indices of the W3C standard mapping. */
export const PAD_BUTTON = Object.freeze({ A: 0, B: 1, Y: 3, LT: 6, RT: 7, START: 9, DPAD_LEFT: 14, DPAD_RIGHT: 15 });

/** The parts of `Gamepad` the reader needs (so tests and the headless stub can pass plain objects). */
export interface PadLike {
  connected: boolean;
  mapping: string;
  id: string;
  axes: ArrayLike<number>;
  buttons: ArrayLike<{ pressed: boolean; value: number }>;
}

/** Stick −1…1 → steer −1…1: nothing inside the dead zone, then a gentle (^1.5) ramp to full lock. */
export function shapeStick(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const mag = Math.abs(x);
  if (mag <= STICK_DEADZONE) return 0;
  const t = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return Math.sign(x) * Math.pow(t, STICK_CURVE);
}

function trigger(b: { pressed: boolean; value: number } | undefined): number {
  if (!b) return 0;
  if (Number.isFinite(b.value) && b.value > 0) return Math.min(1, b.value);
  return b.pressed ? 1 : 0;
}

const held = (b: { pressed: boolean; value: number } | undefined): boolean => !!b && (b.pressed || b.value > 0.5);

/** Sample one pad into `out` (no allocation). */
export function readPad(pad: PadLike, out: PadFrame): PadFrame {
  const buttons = pad.buttons;
  const left = held(buttons[PAD_BUTTON.DPAD_LEFT]);
  const right = held(buttons[PAD_BUTTON.DPAD_RIGHT]);
  out.steer = left !== right ? (right ? 1 : -1) : shapeStick(pad.axes[0] ?? 0);
  out.throttle = trigger(buttons[PAD_BUTTON.RT]);
  out.brake = trigger(buttons[PAD_BUTTON.LT]);
  out.handbrake = held(buttons[PAD_BUTTON.A]);
  out.respawn = held(buttons[PAD_BUTTON.B]);
  out.restart = held(buttons[PAD_BUTTON.Y]);
  out.menu = held(buttons[PAD_BUTTON.START]);
  return out;
}

/** The first connected pad with the standard mapping, or null. */
export function firstStandardPad(pads: ArrayLike<PadLike | null | undefined>): PadLike | null {
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (pad && pad.connected && pad.mapping === 'standard') return pad;
  }
  return null;
}
