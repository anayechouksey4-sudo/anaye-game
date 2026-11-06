/**
 * Which plate text a car shows: the player's own (selection store, persisted) or the catalog's
 * default for that car. `usePlateText` is the React hook the car model and the editor use;
 * `plateFor` the plain function for results / debug.
 *
 * MY RIDE (state/profile.ts) can carry its own plate: while the ride is mounted on `carId`, the car
 * wears that text instead (`useWornPlate` / `plateFor`); the garage editor keeps editing the stock
 * car's plate, which comes back when the ride is unmounted.
 */
import { profileState, useProfile } from '../../state/profile';
import { selectionState, useSelection } from '../../state/selection';
import { defaultPlateFor } from '../catalog';
import { normalizePlate } from './plateText';

export { defaultPlateFor };

/** The mounted ride's plate for this class ('' = none mounted here, or the ride uses the stock plate). */
function ridePlate(carId: string, p: { rideActive: boolean; ride: { base: string; plate: string } } = profileState()): string {
  return p.rideActive && p.ride.base === carId ? normalizePlate(p.ride.plate) : '';
}

/** The plate `carId` wears now (the mounted ride's, else custom text, else its default). */
export function plateFor(carId: string): string {
  return ridePlate(carId) || selectionState().plates[carId] || defaultPlateFor(carId);
}

/** React: the plate the car on track wears (the mounted ride's text wins), re-rendering only when it changes. */
export function useWornPlate(carId: string): string {
  const custom = useSelection((s) => s.plates[carId]);
  const fromRide = useProfile((s) => ridePlate(carId, s));
  return fromRide || custom || defaultPlateFor(carId);
}

/** True when the player has typed their own plate for this car. */
export function hasCustomPlate(carId: string): boolean {
  return Boolean(selectionState().plates[carId]);
}

/** React: this car's plate text, re-rendering only when it changes. */
export function usePlateText(carId: string): string {
  const custom = useSelection((s) => s.plates[carId]);
  return custom || defaultPlateFor(carId);
}
