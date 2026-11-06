/**
 * Handling constants that are NOT part of the wire protocol (those live in shared/protocol.ts
 * and arrive live from the dashboard).
 *
 * The base table (tuning/base.ts) holds the hypercar's values, every class's defaults; each class
 * overrides what makes it feel different in tuning/<id>.ts. vehicleSpec.ts merges the two into the
 * class's `CarTuning`, so calibration of one car touches one file.
 */
import type { CarClassId } from '@shared/protocol';
import { CAR_TUNING } from './tuning/base';
import { HYPERCAR_TUNING } from './tuning/hypercar';
import { RALLY_TUNING } from './tuning/rally';
import { MUSCLE_TUNING } from './tuning/muscle';
import { FORMULA_TUNING } from './tuning/formula';
import { BUGGY_TUNING } from './tuning/buggy';
import { COUPE_TUNING } from './tuning/coupe';
import { DRIFT_TUNING } from './tuning/drift';
import { ELECTRIC_TUNING } from './tuning/electric';
import { KART_TUNING } from './tuning/kart';

export { CAR_TUNING };

/** One car class's handling constants (CAR_TUNING with that class's overrides). */
export type CarTuning = { readonly [K in keyof typeof CAR_TUNING]: (typeof CAR_TUNING)[K] extends boolean ? boolean : number };

/** Per-class overrides, merged over CAR_TUNING by vehicleSpec.ts. */
export const CLASS_TUNING: { readonly [K in CarClassId]: Partial<CarTuning> } = {
  hypercar: HYPERCAR_TUNING,
  rally: RALLY_TUNING,
  muscle: MUSCLE_TUNING,
  formula: FORMULA_TUNING,
  buggy: BUGGY_TUNING,
  coupe: COUPE_TUNING,
  drift: DRIFT_TUNING,
  electric: ELECTRIC_TUNING,
  kart: KART_TUNING,
};
