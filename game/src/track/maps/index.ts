/**
 * Every generated map, by id. Each recipe builds on the shared generator (chaos/plan.ts); the
 * components are registered in ../registry.ts and described for the menu in ../catalog.ts.
 */
import type { TrackRecipe } from '../chaos/recipe';
import { CHAOS_RECIPE } from './chaos';
import { CRYO_RECIPE } from './cryo';
import { ISLES_RECIPE } from './isles';
import { RIBBON_RECIPE } from './ribbon';
import { STRIP_RECIPE } from './strip';

export { CHAOS_RECIPE, CRYO_RECIPE, ISLES_RECIPE, RIBBON_RECIPE, STRIP_RECIPE };

export const RECIPES: Readonly<Record<string, TrackRecipe>> = {
  [CHAOS_RECIPE.id]: CHAOS_RECIPE,
  [RIBBON_RECIPE.id]: RIBBON_RECIPE,
  [ISLES_RECIPE.id]: ISLES_RECIPE,
  [CRYO_RECIPE.id]: CRYO_RECIPE,
  [STRIP_RECIPE.id]: STRIP_RECIPE,
};
