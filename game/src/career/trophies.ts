/**
 * Trophies: 24 original rules over the career data (career/store.ts). Each has a stable id, a name,
 * a one-line hint, a small glyph (an SVG path on a 24×24 box, drawn by the tab and the toast; no
 * emoji) and a pure `check(career)`. `evaluateTrophies` lists what a career has newly earned.
 */
import { CAR_CLASS_IDS } from '@shared/protocol';
import { TRACK_CATALOG } from '../track/catalog';
import { carsWithMedal, kmDriven, tracksWithMedal, type Career } from './store';

export interface Trophy {
  id: string;
  name: string;
  /** How to earn it, one line. */
  hint: string;
  /** SVG path data on a 24×24 viewBox (stroke 2, round caps). */
  glyph: string;
  check: (career: Career) => boolean;
}

/** The five classic maps that carry medals (not the proving ground, not the island). */
export const CLASSIC_MAP_IDS: readonly string[] = TRACK_CATALOG.filter((t) => t.world === undefined && t.medalsMs !== undefined).map((t) => t.id);
/** The island's timed races. */
export const ISLAND_RACE_IDS: readonly string[] = TRACK_CATALOG.filter((t) => t.world !== undefined && t.medalsMs !== undefined).map((t) => t.id);
/** Every car class. */
export const ALL_CAR_IDS: readonly string[] = CAR_CLASS_IDS;

export const BIG_AIR_M = 40;
export const HANG_TIME_S = 2;
export const LONG_HAUL_KM = 100;
export const ODOMETER_KM = 10;
export const NIGHT_SHIFT_S = 30 * 60;
export const GHOST_MARGIN_MS = 2000;
export const SPEED_MARK_KMH = 250;
export const REGIONS_FOR_WAYFARER = 5;
export const CHAOS_ID = 'chaos';

// Glyphs: short strokes, legible at 20 px.
const G = {
  lights: 'M6 4h12v16H6zM12 7.5v0M12 12v0M12 16.5v0',
  flag: 'M5 21V4h12l-2 4 2 4H5',
  medal: 'M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 14l-2 7 5-3 5 3-2-7',
  star: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z',
  crown: 'M4 18h16l1-10-5 4-4-7-4 7-5-4zM4 21h16',
  ring: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  island: 'M3 19h18M7 19c0-5 2-8 5-10M12 9c3 2 5 5 5 10M12 9V4M12 4c2 0 4 1 5 2M12 4c-2 0-4 1-5 2',
  cat: 'M6 20V9l-2-5 5 3h6l5-3-2 5v11zM9 13v0M15 13v0M12 16l-1 1h2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  podium: 'M3 21h18M8 21v-8h8v8M3 21v-5h5M16 21v-11h5v11',
  house: 'M4 11l8-7 8 7v10h-5v-6h-6v6H4z',
  pack: 'M8 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 2-5 4-5s6 2 6 5',
  tilt: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 17v0M4 12l-2 1M20 12l2 1',
  moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
  road: 'M6 21L9 3h6l3 18M12 5v3M12 11v3M12 17v3',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8a2 2 0 1 1-2 2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  ghost: 'M5 21V11a7 7 0 0 1 14 0v10l-2-2-2 2-2-2-2 2-2-2-2 2-2-2zM9 11v0M15 11v0',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-2 5-4 1 2-5z',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-6M12 16v0',
  garage: 'M3 21V9l9-6 9 6v12M7 21v-7h10v7M7 17h10',
  ten: 'M7 7v10M12 17a3 5 0 1 0 0-10 3 5 0 0 0 0 10zM17 8l2-1v10',
  layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
} as const;

export const TROPHIES: readonly Trophy[] = [
  { id: 'first-lights', name: 'FIRST LIGHTS', hint: 'Finish a race.', glyph: G.lights, check: (c) => c.totals.racesFinished >= 1 },
  { id: 'ten-up', name: 'TEN UP', hint: 'Finish ten races.', glyph: G.ten, check: (c) => c.totals.racesFinished >= 10 },
  { id: 'bronze-age', name: 'BRONZE AGE', hint: 'Earn a medal of any colour.', glyph: G.medal, check: (c) => Object.values(c.records).some((r) => r.medal !== null) },
  { id: 'silver-lining', name: 'SILVER LINING', hint: 'Earn a silver medal.', glyph: G.ring, check: (c) => Object.values(c.records).some((r) => r.medal === 'silver' || r.medal === 'gold') },
  { id: 'gold-rush', name: 'GOLD RUSH', hint: 'Earn a gold medal.', glyph: G.star, check: (c) => Object.values(c.records).some((r) => r.medal === 'gold') },
  {
    id: 'full-set',
    name: 'FULL SET',
    hint: `Gold on every classic map with one car (${CLASSIC_MAP_IDS.length} maps).`,
    glyph: G.crown,
    check: (c) => c.carsFinished.some((car) => CLASSIC_MAP_IDS.every((t) => tracksWithMedal(c, 'gold', car).has(t))),
  },
  {
    id: 'islander',
    name: 'ISLANDER',
    hint: 'Gold on all four island races.',
    glyph: G.island,
    check: (c) => ISLAND_RACE_IDS.length > 0 && ISLAND_RACE_IDS.every((t) => tracksWithMedal(c, 'gold').has(t)),
  },
  { id: 'nine-lives', name: 'NINE LIVES', hint: 'A medal with every car.', glyph: G.cat, check: (c) => ALL_CAR_IDS.every((car) => carsWithMedal(c).has(car)) },
  {
    id: 'clean-sheet',
    name: 'CLEAN SHEET',
    hint: 'Finish the chaos map without a single fall.',
    glyph: G.shield,
    check: (c) => Object.entries(c.records).some(([key, r]) => key.startsWith(`${CHAOS_ID}|`) && r.cleanRuns > 0),
  },
  { id: 'front-row', name: 'FRONT ROW', hint: 'Finish P1 against the rivals.', glyph: G.flag, check: (c) => c.totals.wins >= 1 },
  { id: 'podium-regular', name: 'PODIUM REGULAR', hint: 'Five podiums (P1 to P3) against the rivals.', glyph: G.podium, check: (c) => c.totals.podiums >= 5 },
  { id: 'grid-king', name: 'GRID KING', hint: 'P1 against the rivals in ten races.', glyph: G.crown, check: (c) => c.totals.wins >= 10 },
  { id: 'room-service', name: 'ROOM SERVICE', hint: 'Host a friends race.', glyph: G.house, check: (c) => c.totals.friendsHosted >= 1 },
  { id: 'pack-leader', name: 'PACK LEADER', hint: 'Win a friends race with three or more players.', glyph: G.pack, check: (c) => c.totals.friendsWonWith3 >= 1 },
  { id: 'tilted', name: 'TILTED', hint: 'Finish a race on tilt steering.', glyph: G.tilt, check: (c) => c.totals.tiltFinishes >= 1 },
  { id: 'night-shift', name: 'NIGHT SHIFT', hint: 'Thirty minutes behind the wheel.', glyph: G.moon, check: (c) => c.totals.timePlayedS >= NIGHT_SHIFT_S },
  { id: 'odometer', name: 'ODOMETER', hint: `Drive ${ODOMETER_KM} km in total.`, glyph: G.clock, check: (c) => kmDriven(c) >= ODOMETER_KM },
  { id: 'long-haul', name: 'LONG HAUL', hint: `Drive ${LONG_HAUL_KM} km in total.`, glyph: G.road, check: (c) => kmDriven(c) >= LONG_HAUL_KM },
  { id: 'big-air', name: 'BIG AIR', hint: `A leap of ${BIG_AIR_M} m or more on the island.`, glyph: G.wind, check: (c) => c.totals.longestLeapM >= BIG_AIR_M },
  { id: 'hang-time', name: 'HANG TIME', hint: `${HANG_TIME_S} seconds in the air on one jump.`, glyph: G.layers, check: (c) => c.totals.longestAirS >= HANG_TIME_S },
  { id: 'ghostbuster', name: 'GHOSTBUSTER', hint: 'Beat your own best time by two seconds.', glyph: G.ghost, check: (c) => c.totals.bestImprovementMs >= GHOST_MARGIN_MS },
  { id: 'wayfarer', name: 'WAYFARER', hint: `Visit ${REGIONS_FOR_WAYFARER} regions of the island.`, glyph: G.compass, check: (c) => c.regions.length >= REGIONS_FOR_WAYFARER },
  { id: 'speed-mark', name: 'SPEED MARK', hint: `Reach ${SPEED_MARK_KMH} km/h.`, glyph: G.gauge, check: (c) => c.totals.topSpeedKmh >= SPEED_MARK_KMH },
  { id: 'garage-tour', name: 'GARAGE TOUR', hint: 'Finish a race with five different cars.', glyph: G.garage, check: (c) => c.carsFinished.length >= 5 },
];

export const TROPHY_COUNT = TROPHIES.length;

export const trophyById = (id: string): Trophy | undefined => TROPHIES.find((t) => t.id === id);

/** Ids whose rule now passes but that the career has not unlocked yet (catalog order). */
export function evaluateTrophies(c: Career): string[] {
  const out: string[] = [];
  for (const t of TROPHIES) if (!(t.id in c.trophies) && t.check(c)) out.push(t.id);
  return out;
}

export const unlockedCount = (c: Career): number => TROPHIES.filter((t) => t.id in c.trophies).length;
