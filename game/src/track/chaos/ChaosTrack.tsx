/**
 * Generated maps over the void. `<GeneratedTrack recipe={…}/>` builds any recipe's plan
 * (plan.ts) and mounts its static decks, hazards and decor; `<ChaosTrack/>` is the GamerFleet
 * Chaos Track (`?seed=<n|text>` remixes its layout; the default seed is the hand-validated one).
 * Plans are generated once per recipe + seed and cached at module level, so the registered
 * TrackLayout object is stable for the lifetime of the page (also across map switches).
 *
 * Switching maps unmounts the whole tree: rigid bodies, joints and imperatively created tile
 * bodies are removed, geometries / materials / textures disposed, `window.__CHAOS__` removed, and
 * the shared hazard clock restarts at 0 for the new map.
 */
import { useMemo, useState } from 'react';
import { getQueryParam } from '../../config';
import { CHAOS_RECIPE } from '../maps/chaos';
import { useRegisterTrackLayout } from '../useTrackLayout';
import { useChaosDebugHandle } from './chaosDebug';
import { chaosRuntime } from './chaosRuntime';
import { DEFAULT_CHAOS_SEED } from './config';
import { Decor } from './Decor';
import { HazardClockDriver, resetHazardClock } from './hazardClock';
import { CollapsingTiles } from './hazards/CollapsingTiles';
import { PendulumGauntlet } from './hazards/PendulumGauntlet';
import { SlidingWalls } from './hazards/SlidingWalls';
import { generateTrack, type ChaosSegment, type ChaosTrackPlan } from './plan';
import type { TrackPalette, TrackRecipe } from './recipe';
import { parseSeed } from './rng';
import { StaticTrack } from './StaticTrack';

const plans = new Map<string, ChaosTrackPlan>();

/** Cached plan for a recipe + seed (default: the recipe's validated seed). */
export function getTrackPlan(recipe: TrackRecipe, seed: number = recipe.seed): ChaosTrackPlan {
  const key = `${recipe.id}:${seed}`;
  let plan = plans.get(key);
  if (!plan) {
    plan = generateTrack(recipe, seed);
    plans.set(key, plan);
  }
  return plan;
}

export function getChaosPlan(seed: number): ChaosTrackPlan {
  return getTrackPlan(CHAOS_RECIPE, seed);
}

/** `?seed=` → seed, falling back to the validated default. */
export function resolveChaosSeed(): number {
  return parseSeed(getQueryParam('seed')) ?? DEFAULT_CHAOS_SEED;
}

function Hazard({ segment, palette }: { segment: ChaosSegment; palette: TrackPalette }) {
  switch (segment.kind) {
    case 'tiles':
      return <CollapsingTiles segment={segment} palette={palette} />;
    case 'pendulums':
      return <PendulumGauntlet segment={segment} palette={palette} />;
    case 'sliders':
      return <SlidingWalls segment={segment} palette={palette} />;
    default:
      return null;
  }
}

function startFresh(): number {
  // A new map's hazards read the clock during their first render (shutter start positions), so
  // it restarts here — before they render — not in an effect. Idempotent (StrictMode-safe).
  resetHazardClock();
  chaosRuntime.collapses.length = 0;
  return 0;
}

export function GeneratedTrack({ recipe, seed = recipe.seed }: { recipe: TrackRecipe; seed?: number }) {
  useState(startFresh);
  const plan = useMemo(() => getTrackPlan(recipe, seed), [recipe, seed]);
  useRegisterTrackLayout(plan.layout);
  useChaosDebugHandle(plan, recipe);
  return (
    <group name={`${plan.recipeId}-track`}>
      <HazardClockDriver />
      <StaticTrack plan={plan} />
      {plan.segments.map((segment) => (
        <Hazard key={segment.id} segment={segment} palette={plan.palette} />
      ))}
      <Decor plan={plan} />
    </group>
  );
}

export function ChaosTrack() {
  const seed = useMemo(resolveChaosSeed, []);
  return <GeneratedTrack recipe={CHAOS_RECIPE} seed={seed} />;
}
