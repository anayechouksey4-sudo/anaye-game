/**
 * Which tyres smoke, and how hard: pure functions of the car runtime's state (no three.js, no
 * React), used by TireSmoke.tsx and checked on their own.
 */

/** slip01 where smoke starts, and where it reaches full intensity. */
export const SLIP_START = 0.25;
export const SLIP_FULL = 0.85;

/**
 * Launch dust, all-wheel-drive cars only (purely visual; the physics never sees it). Their centre
 * diff keeps the front tyres inside their grip and on tarmac no tyre spins at all, so wheelspin
 * smoke never shows their launches. Instead: throttle at least LAUNCH_DUST_THROTTLE, below
 * LAUNCH_DUST_MAX_KMH (full strength up to LAUNCH_DUST_FADE_KMH), scaled by how much of the driven
 * tyres' grip the drive force asks for (none at LAUNCH_DUST_LOAD_START, full at LAUNCH_DUST_LOAD_FULL).
 */
export const LAUNCH_DUST_THROTTLE = 0.6;
export const LAUNCH_DUST_FADE_KMH = 15;
export const LAUNCH_DUST_MAX_KMH = 40;
export const LAUNCH_DUST_LOAD_START = 0.2;
export const LAUNCH_DUST_LOAD_FULL = 0.65;
/** Dust multiplier per car id (rate and puff size); unlisted all-wheel-drive cars get 1. */
export const LAUNCH_DUST_AMOUNT: { readonly [carId: string]: number } = { buggy: 1.5 };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Smoke intensity 0…1 for one rear wheel (0 when gripping or airborne). */
export function smokeIntensity(inContact: boolean, slip01: number): number {
  return inContact ? smoothstep(SLIP_START, SLIP_FULL, slip01) : 0;
}

/**
 * Launch-dust intensity 0…1 for an all-wheel-drive car: throttle (applied, 0…1), speed (km/h), and
 * the drive force asked of the driven tyres against their grip budget (carRuntime.driveForceN /
 * driveGripN). 0 off throttle, airborne (no grip budget) or above LAUNCH_DUST_MAX_KMH.
 */
export function launchDustIntensity(throttle: number, speedKmh: number, driveForceN: number, driveGripN: number): number {
  if (throttle < LAUNCH_DUST_THROTTLE || driveGripN <= 0 || driveForceN <= 0 || speedKmh >= LAUNCH_DUST_MAX_KMH) return 0;
  const load = smoothstep(LAUNCH_DUST_LOAD_START, LAUNCH_DUST_LOAD_FULL, driveForceN / driveGripN);
  return load * (1 - smoothstep(LAUNCH_DUST_FADE_KMH, LAUNCH_DUST_MAX_KMH, speedKmh));
}
