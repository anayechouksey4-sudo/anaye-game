import { useLayoutEffect } from 'react';
import { useGameStore } from '../state/store';
import type { TrackLayout } from './types';

/**
 * Register a track's layout with the store. Call it once from the track's root component
 * with a stable (memoised / module-level) layout object; the car mounts once a layout exists.
 */
export function useRegisterTrackLayout(layout: TrackLayout): void {
  useLayoutEffect(() => {
    useGameStore.getState().setTrackLayout(layout);
  }, [layout]);
}
