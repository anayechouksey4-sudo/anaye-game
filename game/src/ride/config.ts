/**
 * MY RIDE: the custom-car configuration. A ride is a LOOK over one of the existing car classes
 * (`base`): paint, neon trim, wheels, spoiler, exhaust tips, stance, a name and a plate. It never
 * changes handling — the physics, best times, medals and the dashboard's estimates all key on the
 * base class id — so a ride is exactly as fast as its base car.
 *
 * Pure data + validation (node-testable); the voxel work is ride/livery.ts, the UI hud/RideTab.tsx.
 */
import { CAR_CLASS_IDS, type CarClassId } from '@shared/protocol';
import { NAME_MAX, pickOf, sanitizeHex, sanitizeName, sanitizePlate } from '../drivers/sanitize';

export const TRIMS = ['none', 'cyan', 'magenta', 'yellow', 'green', 'white', 'accent'] as const;
export const WHEEL_STYLES = ['stock', 'spoke5', 'spoke6', 'disc', 'turbofan', 'knobby', 'retro'] as const;
export const SPOILERS = ['stock', 'lip', 'gt', 'fin'] as const;
export const EXHAUSTS = ['stock', 'none', 'single', 'twin', 'quad'] as const;
export type TrimId = (typeof TRIMS)[number];
export type WheelStyleId = (typeof WHEEL_STYLES)[number];
export type SpoilerId = (typeof SPOILERS)[number];
export type ExhaustId = (typeof EXHAUSTS)[number];

/** Body offset range, metres: the wheel wells keep 0.05 m of margin, so ±4 cm never shows a tyre through the arch at rest. */
export const STANCE_MIN = -0.04;
export const STANCE_MAX = 0.08;
export const STANCE_STEP = 0.02;

/** Paint swatches offered by the builder (any #RRGGBB is accepted, e.g. from a share code). */
export const PAINT_SWATCHES = ['#E8102E', '#FF3D9A', '#FF9A1F', '#F5E663', '#39FF14', '#2EF2C8', '#00F0FF', '#4D7CFF', '#9B5CFF', '#F4F7FB', '#8A93A6', '#15171E'] as const;

/** How many tips each exhaust option stamps (stock keeps the class's own). */
export const EXHAUST_TIPS: Readonly<Record<ExhaustId, number>> = { stock: -1, none: 0, single: 1, twin: 2, quad: 4 };

export interface RideConfig {
  /** Base class (CAR_CLASS_IDS); the ride drives exactly like it. */
  base: CarClassId;
  /** Car name, ≤ NAME_MAX code points. */
  name: string;
  /** Plate text handed to the plate system, ≤ 14 of A–Z 0–9 space; '' = the base car's default plate. */
  plate: string;
  /** Primary / secondary / accent paint, #RRGGBB. */
  paint: string;
  paint2: string;
  accent: string;
  trim: TrimId;
  wheel: WheelStyleId;
  /** Rim colour, #RRGGBB. */
  wheelColor: string;
  spoiler: SpoilerId;
  exhaust: ExhaustId;
  /** Cosmetic body offset, m (STANCE_MIN … STANCE_MAX in STANCE_STEP steps); the wheels and the physics stay put. */
  stance: number;
}

export const DEFAULT_RIDE: Readonly<RideConfig> = Object.freeze({
  base: 'hypercar',
  name: 'My Ride',
  plate: '',
  paint: '#E8102E',
  paint2: '#15171E',
  accent: '#F5E663',
  trim: 'yellow',
  wheel: 'stock',
  wheelColor: '#F5E663',
  spoiler: 'stock',
  exhaust: 'stock',
  stance: 0,
});

export function isCarClassIdSafe(id: unknown): id is CarClassId {
  return typeof id === 'string' && (CAR_CLASS_IDS as readonly string[]).includes(id);
}

/** Snap a stance to the allowed grid (NaN / junk → 0). */
export function clampStance(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const snapped = Math.round(v / STANCE_STEP) * STANCE_STEP;
  return Number(Math.min(STANCE_MAX, Math.max(STANCE_MIN, snapped)).toFixed(2));
}

/** A valid ride from anything (saved JSON, a share code, a URL): junk fields fall back one by one to `base`. */
export function sanitizeRide(input: unknown, base: Readonly<RideConfig> = DEFAULT_RIDE): RideConfig {
  const r = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof RideConfig, unknown>>;
  return {
    base: isCarClassIdSafe(r.base) ? r.base : base.base,
    name: sanitizeName(r.name, NAME_MAX) || base.name,
    plate: sanitizePlate(r.plate),
    paint: sanitizeHex(r.paint, base.paint),
    paint2: sanitizeHex(r.paint2, base.paint2),
    accent: sanitizeHex(r.accent, base.accent),
    trim: pickOf(TRIMS, r.trim, base.trim),
    wheel: pickOf(WHEEL_STYLES, r.wheel, base.wheel),
    wheelColor: sanitizeHex(r.wheelColor, base.wheelColor),
    spoiler: pickOf(SPOILERS, r.spoiler, base.spoiler),
    exhaust: pickOf(EXHAUSTS, r.exhaust, base.exhaust),
    stance: clampStance(r.stance),
  };
}

export function rideEqual(a: Readonly<RideConfig>, b: Readonly<RideConfig>): boolean {
  return (Object.keys(DEFAULT_RIDE) as (keyof RideConfig)[]).every((k) => a[k] === b[k]);
}

/** A stable key of everything that changes the body / wheel geometry or colours (preview caches). */
export function rideLookKey(r: Readonly<RideConfig>): string {
  return `${r.base}|${r.paint}|${r.paint2}|${r.accent}|${r.trim}|${r.wheel}|${r.wheelColor}|${r.spoiler}|${r.exhaust}`;
}

/** Spoilers a base class can wear (an open-wheeler and the caged buggy keep their own). */
export function spoilersFor(base: CarClassId): readonly SpoilerId[] {
  return base === 'formula' || base === 'buggy' ? ['stock'] : SPOILERS;
}
