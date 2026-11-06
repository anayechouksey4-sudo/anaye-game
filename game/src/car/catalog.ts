/**
 * Garage catalog: the cars the player can pick in the ☰ menu. Display data only — the physics
 * of each car class is `CAR_CLASSES[id]` in shared/protocol.ts (same ids, same order), its geometry
 * vehicleSpec.ts, its looks car/model/models.ts (see the cars section of game/README.md).
 *
 * CONTRACT (menu / garage UI reads this; the car system owns and extends it):
 *   - `CAR_CATALOG` lists every selectable car in garage order; ids are stable (persisted).
 *   - `resolveCarId` maps unknown / missing ids to `DEFAULT_CAR_ID`.
 */
import { CAR_CLASSES } from '@shared/protocol';
import { DEFAULT_CAR_ID } from '../state/selection';

export { DEFAULT_CAR_ID };

export interface CarCatalogEntry {
  id: string;
  name: string;
  /** One short line for the garage card. */
  tagline: string;
  /**
   * 0…1 bars for the garage card, from measured numbers: topSpeed = tier-5 top speed / 240 km/h,
   * acceleration = 3.6 s / tier-5 0–100 time, grip ≈ peak lateral g ranking, weight = default mass / 2300 kg.
   */
  stats: { topSpeed: number; acceleration: number; grip: number; weight: number };
  /** CSS colour used for the card accent and selection ring. */
  accent: string;
}

export const CAR_CATALOG: readonly CarCatalogEntry[] = [
  {
    id: 'hypercar',
    name: CAR_CLASSES.hypercar.name,
    tagline: 'Wedge-nosed all-rounder. The car the big jump was tuned for.',
    stats: { topSpeed: 0.85, acceleration: 0.73, grip: 0.7, weight: 0.51 },
    accent: '#ff3d9a',
  },
  {
    id: 'rally',
    name: CAR_CLASSES.rally.name,
    tagline: 'Light, short and all-wheel drive. Sticks to anything and flicks into corners, but short-geared.',
    stats: { topSpeed: 0.79, acceleration: 0.85, grip: 0.88, weight: 0.41 },
    accent: '#39ff14',
  },
  {
    id: 'muscle',
    name: CAR_CLASSES.muscle.name,
    tagline: 'Big-block grunt and fat rear tyres: smoke at any tier. Heavy, draggy, wants to wheelie.',
    stats: { topSpeed: 0.8, acceleration: 0.8, grip: 0.55, weight: 0.67 },
    accent: '#9b5cff',
  },
  {
    id: 'formula',
    name: CAR_CLASSES.formula.name,
    tagline: 'Featherweight open-wheeler with giant wings. Planted at speed, twitchy everywhere else.',
    stats: { topSpeed: 0.9, acceleration: 0.96, grip: 1, weight: 0.29 },
    accent: '#00f0ff',
  },
  {
    id: 'buggy',
    name: CAR_CLASSES.buggy.name,
    tagline: 'Huge wheels and a mile of suspension travel. Slow, but it lands anything.',
    stats: { topSpeed: 0.55, acceleration: 0.39, grip: 0.6, weight: 0.54 },
    accent: '#ff9a1f',
  },
];

export function getCarEntry(id: string): CarCatalogEntry {
  return CAR_CATALOG.find((c) => c.id === id) ?? CAR_CATALOG[0]!;
}

export function resolveCarId(id: string | null | undefined): string {
  return id && CAR_CATALOG.some((c) => c.id === id) ? id : DEFAULT_CAR_ID;
}
