/**
 * `?track=chaos` (default) — the GamerFleet Chaos Track. `?seed=<n|text>` remixes the layout;
 * the default seed is the hand-validated one. The plan is generated once per seed and cached at
 * module level, so the registered TrackLayout object is stable for the lifetime of the page.
 */
import { useMemo } from 'react';
import { getQueryParam } from '../../config';
import { useRegisterTrackLayout } from '../useTrackLayout';
import { useChaosDebugHandle } from './chaosDebug';
import { DEFAULT_CHAOS_SEED } from './config';
import { Decor } from './Decor';
import { HazardClockDriver } from './hazardClock';
import { CollapsingTiles } from './hazards/CollapsingTiles';
import { PendulumGauntlet } from './hazards/PendulumGauntlet';
import { SlidingWalls } from './hazards/SlidingWalls';
import { generateChaosTrack, type ChaosSegment, type ChaosTrackPlan } from './plan';
import { parseSeed } from './rng';
import { StaticTrack } from './StaticTrack';

const plans = new Map<number, ChaosTrackPlan>();

export function getChaosPlan(seed: number): ChaosTrackPlan {
  let plan = plans.get(seed);
  if (!plan) {
    plan = generateChaosTrack(seed);
    plans.set(seed, plan);
  }
  return plan;
}

/** `?seed=` → seed, falling back to the validated default. */
export function resolveChaosSeed(): number {
  return parseSeed(getQueryParam('seed')) ?? DEFAULT_CHAOS_SEED;
}

function Hazard({ segment }: { segment: ChaosSegment }) {
  switch (segment.kind) {
    case 'tiles':
      return <CollapsingTiles segment={segment} />;
    case 'pendulums':
      return <PendulumGauntlet segment={segment} />;
    case 'sliders':
      return <SlidingWalls segment={segment} />;
    default:
      return null;
  }
}

export function ChaosTrack() {
  const plan = useMemo(() => getChaosPlan(resolveChaosSeed()), []);
  useRegisterTrackLayout(plan.layout);
  useChaosDebugHandle(plan);
  return (
    <group name="chaos-track">
      <HazardClockDriver />
      <StaticTrack plan={plan} />
      {plan.segments.map((segment) => (
        <Hazard key={segment.id} segment={segment} />
      ))}
      <Decor plan={plan} />
    </group>
  );
}
