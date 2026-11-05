/**
 * Everything static: deck/ramp colliders (one fixed body), the merged voxel scenery mesh, and the
 * checkpoint / finish trigger sensors. The RunController also evaluates the same gate volumes
 * from the registered layout every step; the sensors are an event-driven second path and both
 * end in the idempotent store actions (reachCheckpoint only accepts higher indices).
 */
import { useEffect, useMemo } from 'react';
import { CuboidCollider, RigidBody, type IntersectionEnterPayload } from '@react-three/rapier';
import { isCarCollider } from '../../car/runtime';
import { gameState } from '../../state/store';
import { DECK_COLLISION_GROUPS } from './config';
import type { ChaosTrackPlan } from './plan';
import { buildStaticScenery } from './scenery';
import { createVoxelMaterial } from './voxel';

function carEntered(payload: IntersectionEnterPayload): boolean {
  return isCarCollider(payload.other.collider?.handle);
}

function GateTriggers({ plan }: { plan: ChaosTrackPlan }) {
  const { checkpoints, finish } = plan.layout;
  return (
    <RigidBody type="fixed" colliders={false} name="chaos-gate-sensors">
      {checkpoints.slice(1).map((cp) => (
        <CuboidCollider
          key={cp.index}
          sensor
          args={[cp.size[0] / 2, (cp.size[1] + 1) / 2, cp.size[2] / 2]}
          position={[cp.position[0], cp.position[1] + (cp.size[1] - 1) / 2, cp.position[2]]}
          rotation={[0, cp.yaw, 0]}
          onIntersectionEnter={(e) => {
            if (carEntered(e)) gameState().reachCheckpoint(cp.index);
          }}
        />
      ))}
      <CuboidCollider
        sensor
        args={[finish.size[0] / 2, (finish.size[1] + 1) / 2, finish.size[2] / 2]}
        position={[finish.position[0], finish.position[1] + (finish.size[1] - 1) / 2, finish.position[2]]}
        rotation={[0, finish.yaw, 0]}
        onIntersectionEnter={(e) => {
          if (carEntered(e) && !gameState().run.finished) gameState().finishRun();
        }}
      />
    </RigidBody>
  );
}

export function StaticTrack({ plan }: { plan: ChaosTrackPlan }) {
  const geometry = useMemo(() => buildStaticScenery(plan), [plan]);
  const material = useMemo(() => createVoxelMaterial(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <>
      <RigidBody type="fixed" colliders={false} name="chaos-decks">
        {plan.decks.map((d, i) => (
          <CuboidCollider
            key={`d${i}`}
            args={[d.size[0] / 2, d.size[1] / 2, d.size[2] / 2]}
            position={d.center}
            rotation={[d.pitch, 0, 0]}
            friction={1}
            collisionGroups={DECK_COLLISION_GROUPS}
          />
        ))}
        {plan.solids.map((s, i) => (
          <CuboidCollider key={`s${i}`} args={[s.size[0] / 2, s.size[1] / 2, s.size[2] / 2]} position={s.center} friction={0.6} restitution={0.1} />
        ))}
      </RigidBody>
      <mesh geometry={geometry} material={material} receiveShadow castShadow frustumCulled={false} name="chaos-scenery" />
      <GateTriggers plan={plan} />
    </>
  );
}
