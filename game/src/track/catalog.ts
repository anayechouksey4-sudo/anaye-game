/**
 * Map catalog: the tracks the player can pick in the ☰ menu. Display data only — each map's
 * component is registered in registry.ts under the same id.
 *
 * CONTRACT (menu / map-select UI reads this; the track system owns and extends it):
 *   - Every entry has a component in `TRACKS` (registry.ts) with the same id, and vice versa.
 *   - Ids are stable (persisted, and used as the best-time key).
 */
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
}

export const TRACK_CATALOG: readonly TrackCatalogEntry[] = [
  {
    id: 'chaos',
    name: 'GamerFleet Chaos',
    description: 'Pendulums, collapsing tiles and shutter gates over the void, then the 95 m jump.',
    difficulty: 4,
    hasBigJump: true,
    accent: '#ff3d9a',
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
