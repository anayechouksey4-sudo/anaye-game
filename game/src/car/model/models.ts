/**
 * Which voxel model each car class wears. Adding a class: write `<name>Shape.ts` exporting a
 * `CarModelDef` (see shapeKit.ts) and list it here under the class id.
 */
import type { CarClassId } from '@shared/protocol';
import { RIDE_HEIGHT } from '../vehicleSpec';
import { BUGGY_MODEL } from './buggyShape';
import { FORMULA_MODEL } from './formulaShape';
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
};

export const CAR_MODELS: Readonly<Record<CarClassId, CarModelDef>> = {
  hypercar: HYPERCAR_MODEL,
  rally: RALLY_MODEL,
  muscle: MUSCLE_MODEL,
  formula: FORMULA_MODEL,
  buggy: BUGGY_MODEL,
};
