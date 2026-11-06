import {
  DEFAULT_CAR_CLASS_ID,
  getCarClass,
  isCarClassId,
  type CarClass,
  type CarClassId,
} from '../../../shared/protocol';

/**
 * Display data for the game's cars and maps. A car's physics lives in shared/protocol.ts (CAR_CLASSES,
 * which also has its name). The accents, map names and map facts here copy the game's own catalogs
 * (game/src/car/catalog.ts and game/src/track/catalog.ts), which this app can't import.
 * test/garage.test.ts reads both files and fails if this copy drifts.
 */

/** Accent for ids this build doesn't know: theme.ts's textDim (theme.ts pulls in react-native, which the node tests can't load). */
const UNKNOWN_ACCENT = '#7D8AA8';

/** Card accent of each car in the game's garage. */
export const CAR_ACCENTS: { readonly [K in CarClassId]: string } = {
  hypercar: '#ff3d9a',
  rally: '#39ff14',
  muscle: '#9b5cff',
  formula: '#00f0ff',
  buggy: '#ff9a1f',
};

export interface MapInfo {
  id: string;
  name: string;
  accent: string;
  /**
   * Lip speed of the map's big jump, km/h; null = no big jump. The live value comes from game:state.
   * It is the lip sign and the estimate's target (assessBigJump), calibrated on the Neon Hypercar.
   */
  bigJumpKmh: number | null;
  /**
   * Lip speed that actually lands the big jump, measured in the game's sim with the Neon Hypercar
   * (absent = bigJumpKmh). The speed trap judges CLEARED / SHORT against this (squad/bigJump.ts).
   */
  landKmh?: number;
  /** The same, per car, where it was measured for that car (overrides landKmh). */
  landKmhByCar?: { readonly [K in CarClassId]?: number };
  /** Tyre grip of the surface when it isn't normal tarmac (ice: 0.55). */
  surfaceGrip?: number;
}

/** The game's maps, in menu order. */
export const MAPS: readonly MapInfo[] = [
  {
    id: 'chaos',
    name: 'GamerFleet Chaos',
    accent: '#ff3d9a',
    bigJumpKmh: 183,
    landKmh: 183.5,
    landKmhByCar: { rally: 184, muscle: 182, formula: 188.5 },
  },
  { id: 'ribbon', name: 'Neon Ribbon', accent: '#ff9e3d', bigJumpKmh: null },
  {
    id: 'isles',
    name: 'Cloudbreak Isles',
    accent: '#2ef2c8',
    bigJumpKmh: 163,
    landKmh: 160.5,
    landKmhByCar: { rally: 160.5, muscle: 156.5, formula: 164.5 },
  },
  { id: 'cryo', name: 'Cryo Drift', accent: '#9df2ff', bigJumpKmh: null, surfaceGrip: 0.55 },
  { id: 'strip', name: 'Midnight Strip', accent: '#8f7dff', bigJumpKmh: null },
  { id: 'test', name: 'Proving Ground', accent: '#25e7f2', bigJumpKmh: null },
];

/** The map the dashboard previews until a game says otherwise (the game's default map). */
export const DEFAULT_TRACK_ID = 'chaos';

export interface CarLook {
  /** The id as the game reported it. */
  id: string;
  name: string;
  accent: string;
  /** False for an id this build doesn't know: its previews use the hypercar (getCarClass). */
  known: boolean;
  /** The class the previews use. */
  carClass: Readonly<CarClass>;
  /** 'RWD', or 'AWD 45:55' (front:rear torque split). */
  drive: string;
}

export interface MapLook {
  /** The id as the game reported it, or null when the game didn't say. */
  id: string | null;
  name: string;
  accent: string;
  known: boolean;
  surfaceGrip?: number;
}

/** 'void-runner_2' → 'VOID RUNNER 2': a readable label for an id this build doesn't know. */
export function labelFromId(id: string): string {
  return id.replace(/[-_.]+/g, ' ').trim().toUpperCase();
}

export function describeDrive(car: Readonly<CarClass>): string {
  if (car.frontDriveShare <= 0) return 'RWD';
  const front = Math.round(car.frontDriveShare * 100);
  return `AWD ${front}:${100 - front}`;
}

export function describeCar(carId: string): CarLook {
  const carClass = getCarClass(carId);
  if (isCarClassId(carId)) {
    return { id: carId, name: carClass.name, accent: CAR_ACCENTS[carId], known: true, carClass, drive: describeDrive(carClass) };
  }
  return { id: carId, name: labelFromId(carId), accent: UNKNOWN_ACCENT, known: false, carClass, drive: describeDrive(carClass) };
}

export function describeMap(trackId: string | null): MapLook {
  if (trackId === null) return { id: null, name: 'Map not reported', accent: UNKNOWN_ACCENT, known: false };
  const map = MAPS.find((m) => m.id === trackId);
  if (!map) return { id: trackId, name: labelFromId(trackId), accent: UNKNOWN_ACCENT, known: false };
  const look: MapLook = { id: map.id, name: map.name, accent: map.accent, known: true };
  if (map.surfaceGrip !== undefined) look.surfaceGrip = map.surfaceGrip;
  return look;
}

/** Maps with a big jump, for the "pick one of these" hint when the current map has none. */
export const BIG_JUMP_MAPS: readonly MapInfo[] = MAPS.filter((m) => m.bigJumpKmh !== null);

export const DEFAULT_CAR_LOOK: CarLook = describeCar(DEFAULT_CAR_CLASS_ID);
