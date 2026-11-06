/**
 * Engine sound presets, one per car class (CAR_CATALOG ids), plus a generic fallback. A car the
 * catalog knows but this table does not (a class added later) gets a preset derived from its
 * garage stats, so every car sounds like itself without touching this file.
 *
 * All original, synthesized character sketches, not recordings or imitations of any real engine:
 *   hypercar  high-revving 10-cylinder shriek, 7 quick gears
 *   rally     raspy turbo four with whistle and blow-off, 6 short gears
 *   muscle    lumpy, bassy eight with crackle on the overrun, 5 long gears
 *   formula   thin, very high-revving six with turbo whine, 8 lightning shifts
 *   buggy     rattly air-cooled flat four, 4 gears, lots of mechanical grit
 */
import { CAR_CATALOG, type CarCatalogEntry } from '../car/catalog';

export interface EngineOscSpec {
  type: OscillatorType;
  /** Frequency as a multiple of the firing frequency (rpm / 60 · cylinders / 2). */
  ratio: number;
  /** Detune, cents. */
  detune: number;
  gain: number;
}

export interface EnginePreset {
  id: string;
  /** Firing pulses per crank revolution × 2 (a four-stroke fires cylinders/2 times per rev). */
  cylinders: number;
  idleRpm: number;
  /** Full-throttle upshift point / top of the tachometer. */
  redlineRpm: number;
  /** Fuel cut: the rpm bounces off this. */
  limiterRpm: number;
  /** Forward gears. */
  gears: number;
  /** Speed at redline in 1st as a fraction of the speed at redline in top gear (geometric spacing in between). */
  firstGearFrac: number;
  /** Upshift rpm fraction of redline at light / full throttle. */
  shiftUpLight: number;
  shiftUpFull: number;
  /** Downshift below this rpm fraction (clamped so a downshift never lands above the light-throttle upshift point). */
  shiftDownFrac: number;
  /** Ignition cut during an upshift, s. */
  shiftTime: number;
  /** Engine inertia: rpm smoothing rates, 1/s (rising under load, falling off it). */
  revUpRate: number;
  revDownRate: number;
  /** Three oscillators: main, detuned partner, sub. */
  osc: readonly [EngineOscSpec, EngineOscSpec, EngineOscSpec];
  /** Waveshaper hardness 0…1 (more = more odd harmonics, rasp). */
  drive: number;
  /** Low-pass cutoff in multiples of the firing frequency, closed (idle, off-load) → open (full load). */
  harmonicsMin: number;
  harmonicsMax: number;
  filterQ: number;
  /** Amplitude "lump" at a fraction of the firing frequency (uneven firing / burble), depth 0…1. */
  lumpRatio: number;
  lumpDepth: number;
  /** Mechanical / intake noise level 0…1 and its band-pass centre in multiples of the firing frequency. */
  grit: number;
  gritRatio: number;
  /** Turbo whistle level 0…1 (0 = naturally aspirated) and its pitch in multiples of the firing frequency. */
  whistle: number;
  whistleRatio: number;
  /** Blow-off "pssh" on lift-off / upshift at boost (turbo cars), 0…1. */
  blowOff: number;
  /** Overrun crackle / backfire pops probability 0…1. */
  crackle: number;
  /** Overall level. */
  level: number;
}

const HYPERCAR: EnginePreset = {
  id: 'hypercar',
  cylinders: 10,
  idleRpm: 1100,
  redlineRpm: 8800,
  limiterRpm: 9100,
  gears: 7,
  firstGearFrac: 0.27,
  shiftUpLight: 0.58,
  shiftUpFull: 0.96,
  shiftDownFrac: 0.42,
  shiftTime: 0.09,
  revUpRate: 14,
  revDownRate: 7,
  osc: [
    { type: 'sawtooth', ratio: 1, detune: 0, gain: 0.55 },
    { type: 'sawtooth', ratio: 1, detune: 9, gain: 0.4 },
    { type: 'square', ratio: 0.5, detune: 0, gain: 0.22 },
  ],
  drive: 0.55,
  harmonicsMin: 3,
  harmonicsMax: 9,
  filterQ: 2.2,
  lumpRatio: 0.2,
  lumpDepth: 0.12,
  grit: 0.18,
  gritRatio: 3.5,
  whistle: 0,
  whistleRatio: 12,
  blowOff: 0,
  crackle: 0.45,
  level: 0.5,
};

const RALLY: EnginePreset = {
  id: 'rally',
  cylinders: 4,
  idleRpm: 950,
  redlineRpm: 7600,
  limiterRpm: 7900,
  gears: 6,
  firstGearFrac: 0.3,
  shiftUpLight: 0.6,
  shiftUpFull: 0.95,
  shiftDownFrac: 0.45,
  shiftTime: 0.08,
  revUpRate: 18,
  revDownRate: 10,
  osc: [
    { type: 'sawtooth', ratio: 1, detune: 0, gain: 0.5 },
    { type: 'square', ratio: 2, detune: 14, gain: 0.22 },
    { type: 'triangle', ratio: 0.5, detune: 0, gain: 0.3 },
  ],
  drive: 0.75,
  harmonicsMin: 4,
  harmonicsMax: 14,
  filterQ: 3,
  lumpRatio: 0.5,
  lumpDepth: 0.18,
  grit: 0.42,
  gritRatio: 6,
  whistle: 0.5,
  whistleRatio: 28,
  blowOff: 0.8,
  crackle: 0.3,
  level: 0.48,
};

const MUSCLE: EnginePreset = {
  id: 'muscle',
  cylinders: 8,
  idleRpm: 750,
  redlineRpm: 6400,
  limiterRpm: 6650,
  gears: 5,
  firstGearFrac: 0.36,
  shiftUpLight: 0.55,
  shiftUpFull: 0.95,
  shiftDownFrac: 0.38,
  shiftTime: 0.14,
  revUpRate: 10,
  revDownRate: 5,
  osc: [
    { type: 'sawtooth', ratio: 1, detune: 0, gain: 0.5 },
    { type: 'square', ratio: 0.5, detune: 6, gain: 0.42 },
    { type: 'sawtooth', ratio: 0.25, detune: 0, gain: 0.3 },
  ],
  drive: 0.85,
  harmonicsMin: 2.5,
  harmonicsMax: 7,
  filterQ: 4,
  lumpRatio: 0.25,
  lumpDepth: 0.45,
  grit: 0.22,
  gritRatio: 2.5,
  whistle: 0,
  whistleRatio: 12,
  blowOff: 0,
  crackle: 0.9,
  level: 0.56,
};

const FORMULA: EnginePreset = {
  id: 'formula',
  cylinders: 6,
  idleRpm: 3800,
  redlineRpm: 12000,
  limiterRpm: 12400,
  gears: 8,
  firstGearFrac: 0.24,
  shiftUpLight: 0.65,
  shiftUpFull: 0.97,
  shiftDownFrac: 0.5,
  shiftTime: 0.05,
  revUpRate: 22,
  revDownRate: 12,
  osc: [
    { type: 'sawtooth', ratio: 1, detune: 0, gain: 0.5 },
    { type: 'triangle', ratio: 2, detune: 5, gain: 0.35 },
    { type: 'sine', ratio: 0.5, detune: 0, gain: 0.25 },
  ],
  drive: 0.45,
  harmonicsMin: 3,
  harmonicsMax: 8,
  filterQ: 5,
  lumpRatio: 0.333,
  lumpDepth: 0.08,
  grit: 0.12,
  gritRatio: 5,
  whistle: 0.35,
  whistleRatio: 18,
  blowOff: 0.3,
  crackle: 0.4,
  level: 0.45,
};

const BUGGY: EnginePreset = {
  id: 'buggy',
  cylinders: 4,
  idleRpm: 900,
  redlineRpm: 5600,
  limiterRpm: 5850,
  gears: 4,
  firstGearFrac: 0.36,
  shiftUpLight: 0.55,
  shiftUpFull: 0.93,
  shiftDownFrac: 0.4,
  shiftTime: 0.16,
  revUpRate: 9,
  revDownRate: 6,
  osc: [
    { type: 'square', ratio: 1, detune: 0, gain: 0.42 },
    { type: 'sawtooth', ratio: 1, detune: -18, gain: 0.35 },
    { type: 'triangle', ratio: 0.5, detune: 0, gain: 0.35 },
  ],
  drive: 0.7,
  harmonicsMin: 3,
  harmonicsMax: 9,
  filterQ: 1.6,
  lumpRatio: 0.5,
  lumpDepth: 0.35,
  grit: 0.6,
  gritRatio: 4,
  whistle: 0,
  whistleRatio: 12,
  blowOff: 0,
  crackle: 0.2,
  level: 0.5,
};

/** Fallback for ids the catalog doesn't know either: a smooth straight six. */
export const GENERIC_PRESET: EnginePreset = {
  id: 'generic',
  cylinders: 6,
  idleRpm: 850,
  redlineRpm: 7000,
  limiterRpm: 7250,
  gears: 6,
  firstGearFrac: 0.3,
  shiftUpLight: 0.58,
  shiftUpFull: 0.95,
  shiftDownFrac: 0.42,
  shiftTime: 0.1,
  revUpRate: 13,
  revDownRate: 7,
  osc: [
    { type: 'sawtooth', ratio: 1, detune: 0, gain: 0.5 },
    { type: 'sawtooth', ratio: 1, detune: 7, gain: 0.35 },
    { type: 'triangle', ratio: 0.5, detune: 0, gain: 0.3 },
  ],
  drive: 0.6,
  harmonicsMin: 3,
  harmonicsMax: 9,
  filterQ: 2.5,
  lumpRatio: 0.333,
  lumpDepth: 0.15,
  grit: 0.25,
  gritRatio: 4,
  whistle: 0,
  whistleRatio: 12,
  blowOff: 0,
  crackle: 0.35,
  level: 0.5,
};

export const ENGINE_PRESETS: Readonly<Record<string, EnginePreset>> = {
  hypercar: HYPERCAR,
  rally: RALLY,
  muscle: MUSCLE,
  formula: FORMULA,
  buggy: BUGGY,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A preset for a catalog car this table doesn't list, from its garage bars: heavier cars get
 * more cylinders, a lower redline and more lump; quicker cars rev higher and brighter; grippy
 * cars get more gears.
 */
export function derivePreset(entry: CarCatalogEntry): EnginePreset {
  const { topSpeed, acceleration, grip, weight } = entry.stats;
  const heavy = clamp01(weight);
  const quick = clamp01(acceleration);
  const cylinders = heavy > 0.6 ? 8 : heavy > 0.45 ? 6 : 4;
  const redlineRpm = Math.round(lerp(5800, 10500, clamp01(0.6 * quick + 0.4 * clamp01(topSpeed)) * (1 - 0.35 * heavy)) / 50) * 50;
  return {
    ...GENERIC_PRESET,
    id: entry.id,
    cylinders,
    idleRpm: Math.round(lerp(800, 1300, quick)),
    redlineRpm,
    limiterRpm: redlineRpm + 250,
    gears: Math.round(lerp(4, 8, clamp01(grip * 0.5 + quick * 0.5))),
    lumpDepth: lerp(0.08, 0.4, heavy),
    drive: lerp(0.45, 0.8, heavy),
    harmonicsMax: lerp(7, 12, quick),
    crackle: lerp(0.2, 0.8, heavy),
  };
}

const derived = new Map<string, EnginePreset>();

/**
 * Preset for a car id: the table, then a preset derived from CAR_CATALOG (cached, so the same id
 * always returns the same object), then the generic one.
 */
export function getEnginePreset(carId: string | null | undefined): EnginePreset {
  if (carId && Object.prototype.hasOwnProperty.call(ENGINE_PRESETS, carId)) return ENGINE_PRESETS[carId]!;
  const entry = carId ? CAR_CATALOG.find((c) => c.id === carId) : undefined;
  if (!entry) return GENERIC_PRESET;
  let preset = derived.get(entry.id);
  if (!preset) {
    preset = derivePreset(entry);
    derived.set(entry.id, preset);
  }
  return preset;
}
