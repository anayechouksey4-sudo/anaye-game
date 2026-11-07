/**
 * Which tyres leave a mark, how dark, and in what colour: pure functions of the car runtime's
 * numbers and the surface under the wheel (no three.js, no React), used by SkidMarks.tsx and
 * checked on their own. Nothing here touches the physics.
 */
import type { SurfaceKind } from '../../state/worldRuntime';

/** `slip01` (carRuntime.wheels[i].slip01) where a mark starts, and where it is fully dark. */
export const MARK_SLIP_START = 0.3;
export const MARK_SLIP_FULL = 0.95;
/** A locked rear under the handbrake marks from this ground speed (m/s) even before slip01 saturates. */
export const HANDBRAKE_MARK_SPEED = 1.5;
/** Darkest a fresh rubber mark gets (alpha over the road). */
export const MARK_ALPHA_MAX = 0.62;
/** Seconds a mark stays; it holds full strength for the first half and fades out over the second. */
export const MARK_FADE_S = 20;
/** Lift above the contact point along its normal, m (keeps the quad clear of the road's depth). */
export const MARK_LIFT_M = 0.02;
/** Tyre contact-patch length as a fraction of its width: the mark's width when sliding sideways. */
export const PATCH_LENGTH_RATIO = 0.6;
/** Minimum travel between two strip samples, m (shorter steps are merged into the next one). */
export const MARK_MIN_STEP_M = 0.03;
/** A jump in the contact point longer than this (a respawn, a teleport, a flight) starts a new strip. */
export const MARK_BREAK_M = 3;

export interface MarkStyle {
  /** Linear RGB of the mark. */
  r: number;
  g: number;
  b: number;
  /** Multiplier on MARK_ALPHA_MAX for this surface (1 = rubber on asphalt). */
  alpha: number;
}

/**
 * Rubber on a built surface: matte graphite rather than pure black, so it reads as a darker mark
 * on grey asphalt and the ice, and as a dull smear on the near-black neon roads.
 */
export const RUBBER: MarkStyle = Object.freeze({ r: 0.075, g: 0.078, b: 0.09, alpha: 1 });
/** A scuff on ice: pale and faint. */
export const ICE_SCUFF: MarkStyle = Object.freeze({ r: 0.72, g: 0.86, b: 0.95, alpha: 0.42 });

/** Per island surface (worldLive.wheelSurface); null / asphalt / cobble / rock → rubber. */
const SURFACE_STYLE: { readonly [k in SurfaceKind]?: MarkStyle } = Object.freeze({
  dirt: Object.freeze({ r: 0.16, g: 0.1, b: 0.06, alpha: 0.7 }), // a darker rut in the dirt
  grass: Object.freeze({ r: 0.1, g: 0.11, b: 0.05, alpha: 0.6 }),
  sand: Object.freeze({ r: 0.46, g: 0.38, b: 0.26, alpha: 0.55 }), // disturbed sand reads lighter
  salt: ICE_SCUFF,
  snow: ICE_SCUFF,
});

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Mark intensity 0…1 for one wheel: 0 airborne or gripping; from combined slip (`slip01`), and for a
 * rear wheel held by the handbrake (locked and dragged) at least half strength once rolling faster
 * than HANDBRAKE_MARK_SPEED.
 */
export function markIntensity(inContact: boolean, slip01: number, handbrake: number, rearWheel: boolean, groundSpeedMs: number): number {
  if (!inContact) return 0;
  let intensity = smoothstep(MARK_SLIP_START, MARK_SLIP_FULL, slip01);
  if (rearWheel && handbrake > 0.5 && groundSpeedMs > HANDBRAKE_MARK_SPEED) {
    intensity = Math.max(intensity, 0.5 * Math.min(1, groundSpeedMs / (HANDBRAKE_MARK_SPEED * 4)) + 0.5 * intensity);
  }
  return intensity;
}

/**
 * Colour and strength of a mark on this surface: the island's per-wheel surface when known,
 * otherwise rubber, or an ice scuff on a map whose `surfaceGrip` is below 1 (the cryo map).
 */
export function markStyle(surface: SurfaceKind | null, trackSurfaceGrip: number): MarkStyle {
  if (surface) return SURFACE_STYLE[surface] ?? RUBBER;
  return trackSurfaceGrip < 1 ? ICE_SCUFF : RUBBER;
}

/**
 * Half width of the strip for a tyre `width` wide whose contact patch moves at angle `cosTravel`
 * (|cos| between the travel direction and the rolling direction): the full tyre width rolling
 * straight (a lock-up), the shorter patch length when sliding sideways.
 */
export function markHalfWidth(width: number, cosTravel: number): number {
  const c = Math.min(1, Math.abs(cosTravel));
  return 0.5 * width * (c + PATCH_LENGTH_RATIO * (1 - c));
}

/** Alpha of a mark whose age is `ageS`: 1 for the first half of MARK_FADE_S, then a linear fade to 0 (mirrors the shader). */
export function fadeAt(ageS: number): number {
  const tail = MARK_FADE_S * 0.5;
  return Math.min(1, Math.max(0, (MARK_FADE_S - ageS) / tail));
}
