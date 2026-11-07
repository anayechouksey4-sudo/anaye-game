/**
 * Who the rivals are and how fast they drive (pure: node-tested).
 *
 * Three rivals start with the player on every timed race: the other drivers of the DRIVERS roster
 * (the active driver never races themself), taking turns run by run, each in a different car class
 * than the player and each other, wearing a livery in their signature colour and their own plate.
 * Their paces finish exactly at the player's car's GOLD, SILVER and BRONZE times on the map
 * (state/records.ts medalsFor): beat the gold rival and you are P1. With RIVALS: 1 only the gold
 * rival starts. A class whose top speed cannot make a target is skipped for that slot.
 */
import { CAR_CLASS_IDS, estimateTopSpeedKmh, mapSquadControlsToPhysics, type CarClassId } from '@shared/protocol';
import { normalizePlate } from '../car/plates/plateText';
import type { AvatarConfig, DriverProfile } from '../drivers/avatar';
import { DEFAULT_RIDE, sanitizeRide, type RideConfig } from '../ride/config';
import type { LookSpec } from '../ride/livery';
import { MEDALS, medalsFor, type Medal } from '../state/records';
import type { TrackMedals } from '../track/catalog';
import type { RaceRoute } from './route';
import { planSpeeds, type SpeedPlan } from './speedPlan';

export interface RivalSpec {
  id: string;
  slot: number;
  medal: Medal;
  /** The finish time this rival hits (ms from GO). */
  targetMs: number;
  name: string;
  color: string;
  avatar: AvatarConfig;
  carId: CarClassId;
  look: LookSpec;
  plate: string;
  /** Seconds after the lights before it moves (0.15–0.35). */
  reactionS: number;
  plan: SpeedPlan;
  /** Lateral wander: offset(s) = amp · sin(2π s / period + phase), metres (+ = left). */
  lateralAmp: number;
  lateralPeriod: number;
  lateralPhase: number;
  /** Start grid: metres behind the spawn and the side (+ left) it starts on. */
  gridBack: number;
  gridSide: number;
}

/** The class's top speed, m/s: tier 5, no front-wing drag (the fastest the dashboard can make it). */
const capCache = new Map<string, number>();
export function classTopSpeedMps(carId: CarClassId): number {
  const hit = capCache.get(carId);
  if (hit !== undefined) return hit;
  const v = estimateTopSpeedKmh(mapSquadControlsToPhysics({ frontWingAero: 0, engineTier: 5, chassisBalance: 0 }, carId), carId) / 3.6;
  capCache.set(carId, v);
  return v;
}

/** Small deterministic hash → 0…1. */
export function hash01(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Mix a hex colour toward black (k < 0) or white (k > 0). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return hex;
  const ch = (v: number) => {
    const t = k < 0 ? v * (1 + k) : v + (255 - v) * k;
    return Math.max(0, Math.min(255, Math.round(t)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

const TRIMS_BY_SLOT = ['cyan', 'magenta', 'yellow', 'green', 'white'] as const;

/** The look a rival wears: its class painted in the driver's signature colour, their own plate. */
export function rivalLook(carId: CarClassId, driver: DriverProfile, slot: number, plate: string): LookSpec {
  const ride: RideConfig = sanitizeRide({
    ...DEFAULT_RIDE,
    base: carId,
    name: driver.name,
    plate,
    paint: driver.avatar.color,
    paint2: shade(driver.avatar.color, -0.55),
    accent: shade(driver.avatar.color, 0.55),
    trim: TRIMS_BY_SLOT[slot % TRIMS_BY_SLOT.length],
    wheel: 'stock',
    wheelColor: shade(driver.avatar.color, 0.3),
    spoiler: 'stock',
    exhaust: 'stock',
    stance: 0,
  });
  return { ride, driver: driver.avatar };
}

/** Plate text from a driver's name and slot, e.g. "VOLT 11", "PIXEL RAE 22" (car/plates rules). */
export function rivalPlate(name: string, slot: number): string {
  const base = normalizePlate(name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')).slice(0, 9).trim() || 'RIVAL';
  return normalizePlate(`${base} ${(slot + 1) * 11}`) || `RIVAL ${(slot + 1) * 11}`;
}

export interface RivalPlanInput {
  route: RaceRoute;
  trackId: string;
  playerCarId: string;
  /** The roster without the active driver (any order; rotated by `serial`). */
  others: readonly DriverProfile[];
  /** Run counter: rotates drivers, classes and lanes. */
  serial: number;
  count: 1 | 3;
  /** Override for tests (default: records.ts medalsFor). */
  medals?: TrackMedals | null;
}

/** Plan the rivals of one run; [] when the map has no medals for this car (no targets → nobody spawns). */
export function planRivals(input: RivalPlanInput): RivalSpec[] {
  const { route, trackId, playerCarId, others, serial, count } = input;
  const medals = input.medals === undefined ? medalsFor(trackId, playerCarId) : input.medals;
  if (!medals || others.length === 0) return [];
  const slots: Medal[] = MEDALS.slice(0, count);
  const classes = CAR_CLASS_IDS.filter((c) => c !== playerCarId);
  const rot = Math.floor(hash01(trackId, serial) * classes.length);
  const candidates = [...classes.slice(rot), ...classes.slice(0, rot)];
  const used = new Set<CarClassId>();
  const out: RivalSpec[] = [];
  for (let slot = 0; slot < slots.length; slot++) {
    const medal = slots[slot]!;
    const targetMs = medals[medal];
    const driver = others[(serial + slot) % others.length]!;
    const reactionS = 0.15 + 0.2 * hash01(trackId, serial, slot, 'reaction');
    const driveS = targetMs / 1000 - reactionS;
    let carId: CarClassId | null = null;
    let plan: SpeedPlan | null = null;
    for (const c of candidates) {
      if (used.has(c)) continue;
      const p = planSpeeds(route, classTopSpeedMps(c), driveS);
      if (p.feasible) {
        carId = c;
        plan = p;
        break;
      }
    }
    if (!carId || !plan) {
      // No class can make it (a very fast target): the quickest free class drives flat out and arrives late.
      const free = candidates.filter((c) => !used.has(c)).sort((a, b) => classTopSpeedMps(b) - classTopSpeedMps(a));
      carId = free[0] ?? candidates[0]!;
      plan = planSpeeds(route, classTopSpeedMps(carId), driveS);
    }
    used.add(carId);
    const plate = rivalPlate(driver.name, slot);
    out.push({
      id: `rival-${slot}`,
      slot,
      medal,
      targetMs,
      name: driver.name,
      color: driver.avatar.color,
      avatar: driver.avatar,
      carId,
      look: rivalLook(carId, driver, slot, plate),
      plate,
      reactionS,
      plan,
      lateralAmp: 1.2,
      lateralPeriod: 260 + 120 * hash01(trackId, serial, slot, 'period'),
      lateralPhase: slot * 2.1 + 6.283 * hash01(serial, slot, 'phase'),
      gridBack: 5 + 3.5 * slot,
      gridSide: (slot % 2 === 0 ? 1 : -1) * 1.7,
    });
  }
  return out;
}
