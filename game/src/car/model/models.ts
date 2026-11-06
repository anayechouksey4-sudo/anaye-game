/**
 * Which voxel model each car class wears. Adding a class: write `<name>Shape.ts` exporting a
 * `CarModelDef` (see shapeKit.ts) and list it here under the class id.
 */
import type { CarClassId } from '@shared/protocol';
import { RIDE_HEIGHT } from '../vehicleSpec';
import { BUGGY_MODEL } from './buggyShape';
import { COUPE_MODEL } from './coupeShape';
import { DRIFT_MODEL } from './driftShape';
import { ELECTRIC_MODEL } from './electricShape';
import { FORMULA_MODEL } from './formulaShape';
import { KART_MODEL } from './kartShape';
import { HYPERCAR_FRONT_WING } from './frontWing';
import { EXHAUST_OUTLETS, buildHypercarGrid } from './hypercarShape';
import { MUSCLE_MODEL } from './muscleShape';
import { RALLY_MODEL } from './rallyShape';
import type { CarModelDef } from './shapeKit';

/** The original hypercar (hypercarShape.ts works in the hypercar's chassis frame; converted to h here). */
const HYPERCAR_MODEL: CarModelDef = {
  buildBody: () => buildHypercarGrid(),
  wing: { ...HYPERCAR_FRONT_WING, pivot: [HYPERCAR_FRONT_WING.pivot[0], HYPERCAR_FRONT_WING.pivot[1] + RIDE_HEIGHT, HYPERCAR_FRONT_WING.pivot[2]] },
  exhaust: EXHAUST_OUTLETS.map(([x, y, z]) => [x, y + RIDE_HEIGHT, z] as const),
  // On the tail fascia's rear face (z −2.28), just under its top edge and above the exhaust housing
  // (anything lower is hidden by the diffuser from the chase cam; anything further forward is inside the voxels).
  plates: { rear: { position: [0, 0.67, -2.28] } },
};

/**
 * Rear number-plate mounts of the pre-plate models (their shape files are untouched): each sits
 * on a flat rear face the chase camera sees, 1 cm proud of the voxels.
 */
const RALLY_PLATED: CarModelDef = { ...RALLY_MODEL, plates: { rear: { position: [0, 0.74, -1.94] } } };
const MUSCLE_PLATED: CarModelDef = { ...MUSCLE_MODEL, plates: { rear: { position: [0, 0.55, -2.38] } } };
/** Hung under the rear wing on the centre pylon, a small plate for an open-wheeler. */
const FORMULA_PLATED: CarModelDef = { ...FORMULA_MODEL, plates: { rear: { position: [0, 0.66, -2.12], scale: 0.6 } } };
/** On the tub's tail between the tail lamps. */
const BUGGY_PLATED: CarModelDef = { ...BUGGY_MODEL, plates: { rear: { position: [0, 0.9, -1.7] } } };

export const CAR_MODELS: Readonly<Record<CarClassId, CarModelDef>> = {
  hypercar: HYPERCAR_MODEL,
  rally: RALLY_PLATED,
  muscle: MUSCLE_PLATED,
  formula: FORMULA_PLATED,
  buggy: BUGGY_PLATED,
  coupe: COUPE_MODEL,
  drift: DRIFT_MODEL,
  electric: ELECTRIC_MODEL,
  kart: KART_MODEL,
};
