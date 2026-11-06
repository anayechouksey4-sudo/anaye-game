/**
 * Surfaces and grip (PLAN §4.10). The tyre-grip multiplier for a wheel on surface g with the car's
 * off-road factor k is g_eff = max(0.4, 1 - (1 - g)·k); rolling drag is C·k (× m·g). Only the five
 * k values and the dirt / sand / salt grip values may be retuned (integration agent). Pure.
 */
import { SURF, SURFACE_KINDS, type SurfaceName } from './types';

export interface SurfaceSpec {
  grip: number;
  /** Rolling drag coefficient, × m·g. */
  drag: number;
}

export const SURFACE_TABLE: Readonly<Record<SurfaceName, SurfaceSpec>> = {
  asphalt: { grip: 1.0, drag: 0 },
  cobble: { grip: 0.97, drag: 0.005 },
  salt: { grip: 0.9, drag: 0 },
  rock: { grip: 0.9, drag: 0.01 },
  dirt: { grip: 0.85, drag: 0.02 },
  grass: { grip: 0.72, drag: 0.05 },
  sand: { grip: 0.62, drag: 0.09 },
  snow: { grip: 0.55, drag: 0.04 },
  water: { grip: 0.6, drag: 0 },
};
/** Shallow-water drag: 0.25 × depth (m) × m·g. */
export const WATER_DRAG_PER_M = 0.25;

/** Off-road factor k per car class. */
export const OFFROAD_K: Readonly<Record<string, number>> = {
  hypercar: 1.0,
  formula: 1.15,
  muscle: 0.9,
  rally: 0.55,
  buggy: 0.3,
};

export function effectiveGrip(surface: SurfaceName, k: number): number {
  const g = SURFACE_TABLE[surface].grip;
  return Math.max(0.4, 1 - (1 - g) * k);
}

export function rollingDrag(surface: SurfaceName, k: number): number {
  return SURFACE_TABLE[surface].drag * k;
}

export function surfaceName(id: number): SurfaceName {
  return SURFACE_KINDS[id] ?? 'grass';
}

/** Grip lookup by surface id (fast path for per-step code). */
export const GRIP_BY_ID: Float32Array = Float32Array.from(SURFACE_KINDS.map((s) => SURFACE_TABLE[s].grip));
export const DRAG_BY_ID: Float32Array = Float32Array.from(SURFACE_KINDS.map((s) => SURFACE_TABLE[s].drag));
void SURF;
