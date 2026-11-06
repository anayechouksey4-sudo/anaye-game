/**
 * Neon Hypercar (hypercar): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const HYPERCAR_TUNING: Partial<CarTuning> = {};
