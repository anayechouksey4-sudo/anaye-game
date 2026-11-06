/**
 * Driver input: keyboard + on-screen touch controls + standard-mapping gamepad, with an optional
 * override used by the debug handle / automated tests. Polled by the car controller every physics
 * step.
 *
 * Drive lock (start lights, game/countdown.ts): while locked, throttle and brake from the
 * keyboard / touch / gamepad read 0 (steer and handbrake still work, so the player can line up).
 * The debug override is exempt — a scripted driver is never held at the lights.
 */
import { getQueryParam } from '../config';

export interface DriverInput {
  /** 0…1 */
  throttle: number;
  /** 0…1 — brakes while rolling forward, reverses once (nearly) stopped. */
  brake: number;
  /** −1 (left) … +1 (right). */
  steer: number;
  /** 0…1 */
  handbrake: number;
}

const pressed = new Set<string>();
let override: Partial<DriverInput> | null = null;
let driveLocked = false;
/** Written by the on-screen controls (hud/TouchControls.tsx); all zero while nothing is held. */
const touch: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

const THROTTLE_KEYS = ['KeyW', 'ArrowUp'];
const BRAKE_KEYS = ['KeyS', 'ArrowDown'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const HANDBRAKE_KEYS = ['Space'];
const DRIVING_KEYS = new Set([...THROTTLE_KEYS, ...BRAKE_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS, ...HANDBRAKE_KEYS]);

const anyPressed = (codes: readonly string[]) => codes.some((c) => pressed.has(c));

/** True when the event comes from a form control the user is typing into / adjusting. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Inside the ☰ menu (hud/GameMenu.tsx marks its root with `data-menu`): keys belong to the menu there. */
function isMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-menu]') !== null;
}

/** Attach keyboard listeners; returns the cleanup. */
export function installKeyboardInput(): () => void {
  const down = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target) || isMenuTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (DRIVING_KEYS.has(e.code)) {
      pressed.add(e.code);
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent) => {
    pressed.delete(e.code);
  };
  const clear = () => pressed.clear();
  // A hidden tab never sees the keyup of a key held while switching away.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') clear();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', onVisibility);
    pressed.clear();
  };
}

/**
 * Touch-first device (phone / tablet): the primary pointer is coarse, or there are touch points
 * and no pointer that can hover. A laptop with a touchscreen keeps its fine, hovering pointer and
 * stays a desktop.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const media = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  return media('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && media('(hover: none)'));
}

/** On-screen touch controls: `?touch=1` / `?touch=0` force them on / off, otherwise touch devices get them. */
export function wantsTouchControls(): boolean {
  const forced = getQueryParam('touch')?.toLowerCase();
  if (forced !== undefined) return !['0', 'off', 'false', 'no'].includes(forced);
  return isTouchDevice();
}

/** Merge the on-screen controls' state (pedals 0…1, steer −1…+1) into the driver input. */
export function setTouchInput(next: Partial<DriverInput>): void {
  Object.assign(touch, next);
}

/** Release every on-screen control (finger lifted / cancelled, tab hidden, controls unmounted). */
export function clearTouchInput(): void {
  touch.throttle = 0;
  touch.brake = 0;
  touch.steer = 0;
  touch.handbrake = 0;
}

/** Start lights: lock / unlock throttle and brake from the player's controls (see the header). */
export function setDriveLock(locked: boolean): void {
  driveLocked = locked;
}

export function isDriveLocked(): boolean {
  return driveLocked;
}

/** Partial override (missing fields fall back to keyboard/touch/gamepad); null releases it. */
export function setInputOverride(next: Partial<DriverInput> | null): void {
  override = next ? { ...next } : null;
}

export function getInputOverride(): Partial<DriverInput> | null {
  return override;
}

const DEADZONE = 0.12;
const deadzone = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function readGamepad(out: DriverInput): void {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    const stick = deadzone(pad.axes[0] ?? 0);
    out.throttle = Math.max(out.throttle, rt);
    out.brake = Math.max(out.brake, lt);
    if (stick !== 0) out.steer = stick;
    if (pad.buttons[0]?.pressed || pad.buttons[1]?.pressed) out.handbrake = 1;
    return;
  }
}

/** Current driver input, written into `out` (no allocation). */
export function readDriverInput(out: DriverInput): DriverInput {
  out.throttle = anyPressed(THROTTLE_KEYS) ? 1 : 0;
  out.brake = anyPressed(BRAKE_KEYS) ? 1 : 0;
  out.steer = (anyPressed(RIGHT_KEYS) ? 1 : 0) - (anyPressed(LEFT_KEYS) ? 1 : 0);
  out.handbrake = anyPressed(HANDBRAKE_KEYS) ? 1 : 0;
  // Touch works like a second keyboard: pedals add up, a held steer pad wins over released keys.
  out.throttle = Math.max(out.throttle, touch.throttle);
  out.brake = Math.max(out.brake, touch.brake);
  out.handbrake = Math.max(out.handbrake, touch.handbrake);
  if (touch.steer !== 0 && out.steer === 0) out.steer = touch.steer;
  readGamepad(out);
  if (driveLocked) {
    out.throttle = 0;
    out.brake = 0;
  }
  if (override) {
    if (override.throttle !== undefined) out.throttle = override.throttle;
    if (override.brake !== undefined) out.brake = override.brake;
    if (override.steer !== undefined) out.steer = override.steer;
    if (override.handbrake !== undefined) out.handbrake = override.handbrake;
  }
  out.throttle = clamp01(out.throttle);
  out.brake = clamp01(out.brake);
  out.handbrake = clamp01(out.handbrake);
  out.steer = Math.max(-1, Math.min(1, out.steer));
  return out;
}
