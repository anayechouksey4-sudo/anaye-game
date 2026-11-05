import { getTrackParam } from '../config';
import { TRACKS, resolveTrackId } from './registry';

/** Renders the track selected by `?track=` (see registry.ts). */
export function Track() {
  const id = resolveTrackId(getTrackParam());
  const Selected = TRACKS[id];
  return Selected ? <Selected /> : null;
}
