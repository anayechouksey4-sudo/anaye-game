/**
 * Tilt steering maths (pure, unit-tested) plus the thin sensor layer around `deviceorientation`.
 *
 * The roll the player applies is read from the gravity vector rebuilt from the W3C Euler angles
 * (alpha, beta, gamma) and rotated by the screen orientation angle: with the phone flat that is
 * exactly `gamma` in portrait and `±beta` in landscape (sign per `screen.orientation`), and it
 * keeps working when the phone is held tilted back at any angle. Then: minus the calibration
 * offset, a 2° dead zone, linear to full lock at `maxDeg`, optional invert, and exponential
 * smoothing with a ~60 ms time constant applied to the roll samples.
 */
export const TILT_DEADZONE_DEG = 2;
export const TILT_SMOOTHING_MS = 60;

const DEG = Math.PI / 180;

export interface OrientationLike {
  angle?: number;
  type?: string;
}

/** Screen rotation angle (0, 90, 180, 270) from `screen.orientation`, the legacy `window.orientation`, or the type name. */
export function screenAngleOf(orientation: OrientationLike | null | undefined, legacyAngle?: number | string | null): number {
  const norm = (a: number) => ((Math.round(a / 90) * 90) % 360 + 360) % 360;
  if (orientation && typeof orientation.angle === 'number' && Number.isFinite(orientation.angle)) return norm(orientation.angle);
  if (typeof legacyAngle === 'number' && Number.isFinite(legacyAngle)) return norm(legacyAngle);
  switch (orientation?.type) {
    case 'landscape-primary':
      return 90;
    case 'portrait-secondary':
      return 180;
    case 'landscape-secondary':
      return 270;
    default:
      return 0;
  }
}

/**
 * Roll of the screen in degrees: positive when the right-hand side of the *screen* is lower
 * (steer right). `beta`/`gamma` as DeviceOrientationEvent gives them (degrees), `screenAngleDeg`
 * from `screenAngleOf`.
 */
export function tiltRollDeg(beta: number, gamma: number, screenAngleDeg: number): number {
  const b = beta * DEG;
  const g = gamma * DEG;
  // Gravity in device axes (x right, y up, z out of the screen) from R = Rz(α)·Rx(β)·Ry(γ): gᵈ = Rᵀ·(0,0,−1).
  const x = Math.sin(g) * Math.cos(b);
  const y = -Math.sin(b);
  const z = -Math.cos(g) * Math.cos(b);
  // Device axes → screen axes (the screen is rotated by the orientation angle).
  const t = screenAngleDeg * DEG;
  const sx = x * Math.cos(t) - y * Math.sin(t);
  const sy = x * Math.sin(t) + y * Math.cos(t);
  return Math.atan2(sx, Math.hypot(sy, z)) / DEG;
}

export interface TiltMapping {
  /** Calibration: the roll the player holds the phone at. */
  offsetDeg: number;
  /** Roll past the dead zone that gives full lock (14…35). */
  maxDeg: number;
  invert: boolean;
  deadzoneDeg?: number;
}

/** Roll (degrees) → steer −1…1. */
export function tiltSteer(rollDeg: number, m: TiltMapping): number {
  if (!Number.isFinite(rollDeg)) return 0;
  const dz = m.deadzoneDeg ?? TILT_DEADZONE_DEG;
  const a = rollDeg - m.offsetDeg;
  const mag = Math.abs(a);
  if (mag <= dz) return 0;
  const span = Math.max(1e-3, m.maxDeg - dz);
  const s = Math.sign(a) * Math.min(1, (mag - dz) / span);
  return m.invert ? -s : s;
}

/** One step of exponential smoothing: `current` moves towards `target` with time constant `tauMs`. */
export function smoothTowards(current: number, target: number, dtMs: number, tauMs = TILT_SMOOTHING_MS): number {
  if (!(dtMs > 0) || !Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * k;
}

// ── Sensor layer (browser only) ─────────────────────────────────────────────

export type TiltPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

type PermissionCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export function tiltSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** iOS: the permission prompt only works from a tap handler, so call this from the toggle's onClick. */
export function tiltNeedsPermission(): boolean {
  return tiltSupported() && typeof (DeviceOrientationEvent as PermissionCtor).requestPermission === 'function';
}

/**
 * 'granted' / 'denied' as the browser answers; 'unknown' when the call throws, which is iOS saying
 * "ask again from a tap" (so a page-load probe never counts as a refusal).
 */
export async function requestTiltPermission(): Promise<TiltPermission> {
  if (!tiltSupported()) return 'unsupported';
  const ctor = DeviceOrientationEvent as PermissionCtor;
  if (typeof ctor.requestPermission !== 'function') return 'granted';
  try {
    return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

/** Current screen rotation angle of this window. */
export function currentScreenAngle(): number {
  try {
    const legacy = (window as Window & { orientation?: number | string }).orientation;
    return screenAngleOf(window.screen?.orientation ?? null, typeof legacy === 'number' ? legacy : null);
  } catch {
    return 0;
  }
}

/** Listen to the orientation sensor; `onRoll` gets the screen roll in degrees and the event time. Returns the stop function. */
export function startTiltSensor(onRoll: (rollDeg: number, nowMs: number) => void): () => void {
  if (!tiltSupported()) return () => undefined;
  const onEvent = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    onRoll(tiltRollDeg(e.beta, e.gamma, currentScreenAngle()), typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now());
  };
  window.addEventListener('deviceorientation', onEvent);
  return () => window.removeEventListener('deviceorientation', onEvent);
}
