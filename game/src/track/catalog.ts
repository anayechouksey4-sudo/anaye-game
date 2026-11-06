/**
 * Map catalog: the tracks the player can pick in the ☰ menu. Display data only — each map's
 * component is registered in registry.ts under the same id.
 *
 * CONTRACT (menu / map-select UI reads this; the track system owns and extends it):
 *   - Every entry has a component in `TRACKS` (registry.ts) with the same id, and vice versa.
 *   - Ids are stable (persisted, and used as the best-time key).
 *   - `medalsMs` (optional) are run times in ms, gold < silver < bronze: a run at or under a
 *     medal's time earns it. Measured with the hypercar (README "Maps").
 */
import type { TrackLayout } from './types';

export interface TrackMedals {
  gold: number;
  silver: number;
  bronze: number;
}

export interface TrackCatalogEntry {
  id: string;
  name: string;
  /** One or two short lines for the map card. */
  description: string;
  /** 1 (easy) … 5 (brutal). */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Whether the map ends in a speed-gated big jump (the dashboard's Big Jump card applies). */
  hasBigJump: boolean;
  /** CSS colour for the card accent. */
  accent: string;
  /** Medal times, ms (absent = no medals, e.g. the Proving Ground). */
  medalsMs?: TrackMedals;
  /**
   * Lip speed the map's big jump needs, km/h (only when hasBigJump): the lip sign, game:state's
   * bigJumpKmh and the ESTIMATED top speed assessBigJump asks for (calibrated on the hypercar).
   */
  bigJumpKmh?: number;
  /**
   * Lip speed that actually lands the big jump, km/h, measured in the sim with the hypercar (only
   * when hasBigJump; absent = bigJumpKmh). The dashboard's speed trap judges CLEARED / SHORT against
   * this, not against bigJumpKmh: on the Isles' short runway the estimate target (163) sits above the
   * lip speed that lands (160.5). Measured from a standstill at the jump's checkpoint, full throttle,
   * sliders swept around the car's edge: it is the first 0.5 km/h step above the fastest lip speed
   * that fell, so every measured run at or above it landed (README "Big jump honesty"). See landKmhOf.
   * Mirrored in dashboard/src/squad/garage.ts (its test/garage.test.ts catches drift).
   */
  landKmh?: number;
  /** Landing lip speed per car id, measured the same way for that car (overrides landKmh). */
  landKmhByCar?: { readonly [carId: string]: number };
  /** Tyre grip of the surface when it is not normal tarmac (e.g. 0.55 on ice). */
  surfaceGrip?: number;
  /** Short setup hint for the map card. */
  tip?: string;
}

export const TRACK_CATALOG: readonly TrackCatalogEntry[] = [
  {
    id: 'chaos',
    name: 'GamerFleet Chaos',
    description: 'Pendulums, collapsing tiles and shutter gates over the void, then the 95 m jump.',
    difficulty: 4,
    hasBigJump: true,
    accent: '#ff3d9a',
    medalsMs: { gold: 46000, silver: 53000, bronze: 62000 },
    bigJumpKmh: 183,
    landKmh: 183.5,
    landKmhByCar: { rally: 184, muscle: 182, formula: 188.5 },
    tip: 'Big jump needs tier 5. Hypercar: 20–34 % wing (from 11 % with weight forward). Others: JUMP ATTEMPT preset.',
  },
  {
    id: 'ribbon',
    name: 'Neon Ribbon',
    description: 'A narrow ribbon of non-stop S-bends at dusk, with fast shutter gates and one hop. Short and technical.',
    difficulty: 3,
    hasBigJump: false,
    accent: '#ff9e3d',
    medalsMs: { gold: 41000, silver: 47000, bronze: 55000 },
    tip: 'Default setup works; extra wing helps front grip. Brake before each bend.',
  },
  {
    id: 'isles',
    name: 'Cloudbreak Isles',
    description: 'Floating islands in a bright sky: ever-longer hops, a crumbling bridge, then a 90 m leap.',
    difficulty: 4,
    hasBigJump: true,
    accent: '#2ef2c8',
    medalsMs: { gold: 49000, silver: 56000, bronze: 66000 },
    bigJumpKmh: 163,
    landKmh: 160.5,
    landKmhByCar: { rally: 160.5, muscle: 156.5, formula: 164.5 },
    tip: 'Final leap (hypercar): tier 4 with 15–40 % wing, or tier 5 with 20–80 %. It lands from 160.5 km/h at the lip.',
  },
  {
    id: 'cryo',
    name: 'Cryo Drift',
    description: 'A wide ice shelf at half grip: sweeping pendulums and collapse fields. Brake early.',
    difficulty: 4,
    hasBigJump: false,
    accent: '#9df2ff',
    medalsMs: { gold: 58000, silver: 67000, bronze: 80000 },
    surfaceGrip: 0.55,
    tip: 'Half grip: launch gently, brake early, steer smoothly.',
  },
  {
    id: 'strip',
    name: 'Midnight Strip',
    description: 'A 1 km night drag strip. Flat out from the line, then a long braking zone.',
    difficulty: 1,
    hasBigJump: false,
    accent: '#8f7dff',
    medalsMs: { gold: 24500, silver: 27000, bronze: 31000 },
    tip: 'Tier 5 with ~20 % wing: fast, and the nose stays down.',
  },
  {
    id: 'test',
    name: 'Proving Ground',
    description: 'A long flat straight with a grid. Learn the car, test top speed and nose lift.',
    difficulty: 1,
    hasBigJump: false,
    accent: '#25e7f2',
  },
];

export function getTrackEntry(id: string): TrackCatalogEntry {
  return TRACK_CATALOG.find((t) => t.id === id) ?? TRACK_CATALOG[0]!;
}

/**
 * Lip speed that lands a map's big jump with this car, km/h: the car's own measurement, else the
 * map's (hypercar) landKmh, else its bigJumpKmh; null when the map has no big jump.
 */
export function landKmhOf(entry: TrackCatalogEntry, carId?: string): number | null {
  if (!entry.hasBigJump || entry.bigJumpKmh === undefined) return null;
  return (carId !== undefined ? entry.landKmhByCar?.[carId] : undefined) ?? entry.landKmh ?? entry.bigJumpKmh;
}

/**
 * The big-jump lip speed a map reports (game:state.bigJumpKmh for the dashboard, the HUD's jump
 * verdict, __RACER__.estimates): its layout's requiredKmh, or null when the map has no big jump.
 * The catalog decides, so the Proving Ground's calibration kicker (a speed trap, no gap) doesn't
 * get a jump verdict it can't be cleared against.
 */
export function bigJumpKmhOf(layout: TrackLayout | null | undefined): number | null {
  const kmh = layout?.bigJump?.requiredKmh;
  if (!layout || kmh === undefined || !Number.isFinite(kmh) || kmh <= 0) return null;
  const entry = TRACK_CATALOG.find((t) => t.id === layout.id);
  return entry && !entry.hasBigJump ? null : kmh;
}
