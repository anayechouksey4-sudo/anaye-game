/**
 * The RaceRoute of the registered layout: classic maps from their cached plan (track/chaos), island
 * races from the generated world's event (null until the island is ready). One route per layout id
 * for the page lifetime (routes are a few KB each).
 */
import { RECIPES } from '../track/maps';
import { getChaosPlan, getTrackPlan, resolveChaosSeed } from '../track/chaos/ChaosTrack';
import { WORLD_OF } from '../track/registry';
import type { TrackLayout } from '../track/types';
import { worldEngine } from '../track/world/engine';
import { classicRoute } from './classicRoute';
import { islandRoute } from './islandRoute';
import { layoutRoute, type RaceRoute } from './route';

const cache = new Map<string, RaceRoute>();

export function routeForLayout(layout: TrackLayout | null): RaceRoute | null {
  if (!layout || layout.mode === 'roam') return null;
  const hit = cache.get(layout.id);
  if (hit) return hit;
  let route: RaceRoute | null = null;
  const recipe = RECIPES[layout.id];
  if (recipe) route = classicRoute(getTrackPlan(recipe));
  else if (layout.id.startsWith('chaos')) {
    const plan = getChaosPlan(resolveChaosSeed());
    if (plan.layout === layout) route = classicRoute(plan);
  } else if (WORLD_OF[layout.id]) {
    const data = worldEngine.data;
    const ev = data?.events.find((e) => e.id === layout.id);
    if (ev && ev.mode === 'race' && ev.route.length >= 6) route = islandRoute(ev);
  } else route = layoutRoute(layout); // the hand-built test track: straight legs through its gates
  if (route) cache.set(layout.id, route);
  return route;
}

/** Tests / debug: forget cached routes. */
export function clearRouteCache(): void {
  cache.clear();
}
