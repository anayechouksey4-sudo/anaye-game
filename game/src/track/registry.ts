import { createElement, type ComponentType } from 'react';
import { ChaosTrack, GeneratedTrack } from './chaos/ChaosTrack';
import type { TrackRecipe } from './chaos/recipe';
import { CRYO_RECIPE, ISLES_RECIPE, RIBBON_RECIPE, STRIP_RECIPE } from './maps';
import { TestTrack } from './test/TestTrack';

/**
 * Track registry: map id → component. The selected map comes from the selection store
 * (`useSelection().trackId`, which `?track=` seeds at load); unknown or missing ids fall back to
 * the default. Every id here has a TRACK_CATALOG entry (catalog.ts) and vice versa.
 *
 * To add a map: write a recipe in maps/ (or a component that renders its colliders/visuals and
 * calls `useRegisterTrackLayout(layout)`), add it here and to TRACK_CATALOG.
 */
function generated(recipe: TrackRecipe): ComponentType {
  const Map = () => createElement(GeneratedTrack, { recipe });
  Map.displayName = `${recipe.id}Track`;
  return Map;
}

export const TRACKS: Readonly<Record<string, ComponentType>> = {
  chaos: ChaosTrack,
  ribbon: generated(RIBBON_RECIPE),
  isles: generated(ISLES_RECIPE),
  cryo: generated(CRYO_RECIPE),
  strip: generated(STRIP_RECIPE),
  test: TestTrack,
};

export const DEFAULT_TRACK_ID = 'chaos';

export function resolveTrackId(param: string | null | undefined): string {
  return param && Object.hasOwn(TRACKS, param) ? param : DEFAULT_TRACK_ID;
}
