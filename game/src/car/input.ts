/**
 * Driver input: keyboard + standard-mapping gamepad, with an optional override used by the
 * debug handle / automated tests. Polled by the car controller every physics step.
 */

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

/** Attach keyboard listeners; returns the cleanup. */
export function installKeyboardInput(): () => void {
  const down = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (DRIVING_KEYS.has(e.code)) {
      pressed.add(e.code);
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent) => {
    pressed.delete(e.code);
  };
  const clear = () => pressed.clear();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', clear);
    pressed.clear();
  };
}

/** Partial override (missing fields fall back to keyboard/gamepad); null releases it. */
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
  readGamepad(out);
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
