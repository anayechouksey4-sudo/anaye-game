import type { ComponentType } from 'react';
import { TestTrack } from './test/TestTrack';

/**
 * Track registry. `?track=<id>` picks one; unknown or missing ids fall back to the default.
 * To add a track: build a component that renders its colliders/visuals and calls
 * `useRegisterTrackLayout(layout)`, then add it here (and make it the default if it should be).
 */
export const TRACKS: Readonly<Record<string, ComponentType>> = {
  test: TestTrack,
};

export const DEFAULT_TRACK_ID = 'test';

export function resolveTrackId(param: string | null): string {
  return param && param in TRACKS ? param : DEFAULT_TRACK_ID;
}
