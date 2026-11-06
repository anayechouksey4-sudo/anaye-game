import { useSelection } from '../state/selection';
import { useMapsDebugHandle } from './mapsDebug';
import { TRACKS, resolveTrackId } from './registry';

/**
 * Renders the map selected in the selection store (`?track=` seeds it at load; the ☰ menu
 * changes it at runtime). Keyed by id, so a switch unmounts the old map completely before the
 * new one registers its layout — the car (keyed by layout id + car id in App) remounts at the
 * new spawn.
 */
export function Track() {
  const id = resolveTrackId(useSelection((s) => s.trackId));
  useMapsDebugHandle(id);
  const Selected = TRACKS[id];
  return Selected ? <Selected key={id} /> : null;
}
