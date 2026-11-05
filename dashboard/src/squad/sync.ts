import {
  SQUAD_CONTROL_KEYS,
  type SquadControlKey,
  type SquadControls,
} from '../../../shared/protocol';

export type DragState = { readonly [K in SquadControlKey]: boolean };

export const NOT_DRAGGING: DragState = Object.freeze({
  frontWingAero: false,
  engineTier: false,
  chassisBalance: false,
});

/**
 * What to do with `server:welcome.snapshot.controls` on each (re)connect.
 *
 * The rule: the squad's shared state wins until this phone has an opinion.
 *   - snapshot has controls AND the user has not touched a slider, preset or reset since launch
 *       → 'adopt': show the squad's current tune, send nothing (it is already the relay's state).
 *   - otherwise (no snapshot, or the user has tuned locally — e.g. while the link was down)
 *       → 'push': broadcast our three values so the game and other dashboards converge on them.
 */
export function resolveWelcomeSync(snapshotControls: SquadControls | null, userTouched: boolean): 'adopt' | 'push' {
  return snapshotControls !== null && !userTouched ? 'adopt' : 'push';
}

/**
 * Another dashboard broadcast its sliders. Take its values, except for any slider this user is
 * holding right now — yanking a thumb out from under a finger is worse than a brief disagreement,
 * and our own release (onSlidingComplete) re-broadcasts the full set anyway.
 */
export function mergeRemoteControls(local: SquadControls, remote: SquadControls, dragging: DragState): SquadControls {
  const out = { ...local };
  for (const key of SQUAD_CONTROL_KEYS) if (!dragging[key]) out[key] = remote[key];
  return out;
}
