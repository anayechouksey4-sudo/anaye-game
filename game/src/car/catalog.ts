/**
 * Garage catalog: the cars the player can pick in the ☰ menu. Display data only — the physics
 * of each car class lives with the car system (see the cars section of game/README.md).
 *
 * CONTRACT (menu / garage UI reads this; the car system owns and extends it):
 *   - `CAR_CATALOG` lists every selectable car in garage order; ids are stable (persisted).
 *   - `resolveCarId` maps unknown / missing ids to `DEFAULT_CAR_ID`.
 */
import { DEFAULT_CAR_ID } from '../state/selection';

export { DEFAULT_CAR_ID };

export interface CarCatalogEntry {
  id: string;
  name: string;
  /** One short line for the garage card. */
  tagline: string;
  /** 0…1 bars for the garage card. */
  stats: { topSpeed: number; acceleration: number; grip: number; weight: number };
  /** CSS colour used for the card accent and selection ring. */
  accent: string;
}

export const CAR_CATALOG: readonly CarCatalogEntry[] = [
  {
    id: 'hypercar',
    name: 'Neon Hypercar',
    tagline: 'Wedge-nosed all-rounder. The car the big jump was tuned for.',
    stats: { topSpeed: 0.85, acceleration: 0.75, grip: 0.7, weight: 0.5 },
    accent: '#ff3d9a',
  },
];

export function getCarEntry(id: string): CarCatalogEntry {
  return CAR_CATALOG.find((c) => c.id === id) ?? CAR_CATALOG[0]!;
}

export function resolveCarId(id: string | null | undefined): string {
  return id && CAR_CATALOG.some((c) => c.id === id) ? id : DEFAULT_CAR_ID;
}
