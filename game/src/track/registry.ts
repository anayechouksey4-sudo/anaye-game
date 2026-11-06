import { createElement, type ComponentType } from 'react';
import { ChaosTrack, GeneratedTrack } from './chaos/ChaosTrack';
import type { TrackRecipe } from './chaos/recipe';
import { CRYO_RECIPE, ISLES_RECIPE, RIBBON_RECIPE, STRIP_RECIPE } from './maps';
import { TestTrack } from './test/TestTrack';
import { TRACK_CATALOG } from './catalog';
import { OpenWorld } from './world/OpenWorld';

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
  tessera: OpenWorld,
  'tessera-rim': OpenWorld,
  'tessera-crown': OpenWorld,
  'tessera-neon': OpenWorld,
  'tessera-rally': OpenWorld,
};

/** Open-world entries → the world they share; <Track/> keys by it so switching between them keeps the world mounted. */
export const WORLD_OF: Readonly<Record<string, string>> = Object.fromEntries(
  TRACK_CATALOG.flatMap((t) => (t.world ? [[t.id, t.world] as const] : [])),
);

export const DEFAULT_TRACK_ID = 'chaos';

export function resolveTrackId(param: string | null | undefined): string {
  // Registered AND offered by the catalog (an entry behind a switch, like the island while it is off, is not).
  return param && Object.hasOwn(TRACKS, param) && TRACK_CATALOG.some((t) => t.id === param) ? param : DEFAULT_TRACK_ID;
}
