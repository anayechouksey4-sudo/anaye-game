/**
 * `window.__MAPS__` — map switching and resource counters for tests and the console (installed
 * by <Track/> inside <Physics>). `physicsInfo()` / `renderInfo()` are what the switch-leak test
 * compares between visits of the same map.
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useSelection } from '../state/selection';
import { TRACK_CATALOG } from './catalog';
import { describePlan, generateTrack } from './chaos/plan';
import { RECIPES } from './maps';
import { TRACKS } from './registry';

export interface MapsDebugHandle {
  /** Id of the mounted map. */
  current(): string;
  /** Every selectable map id. */
  ids(): string[];
  /** Same path as picking a map in the menu (useSelection().setTrack). */
  select(id: string): void;
  /** Rapier world counts (all bodies, incl. the car). */
  physicsInfo(): { bodies: number; colliders: number; joints: number };
  /** renderer.info of the last frame (calls include the shadow pass). */
  renderInfo(): { calls: number; triangles: number; geometries: number; textures: number; programs: number };
  /** Generate (without mounting) a generated map's plan — determinism checks. */
  describe(id: string, seed?: number): ReturnType<typeof describePlan> | null;
}

declare global {
  interface Window {
    __MAPS__?: MapsDebugHandle;
  }
}

export function useMapsDebugHandle(currentId: string): void {
  const gl = useThree((s) => s.gl);
  const { world } = useRapier();
  const current = useRef(currentId);
  current.current = currentId;
  useEffect(() => {
    const handle: MapsDebugHandle = {
      current: () => current.current,
      ids: () => TRACK_CATALOG.map((t) => t.id).filter((id) => Object.hasOwn(TRACKS, id)),
      select: (id) => useSelection.getState().setTrack(id),
      physicsInfo: () => ({ bodies: world.bodies.len(), colliders: world.colliders.len(), joints: world.impulseJoints.len() }),
      renderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
      }),
      describe: (id, seed) => {
        const recipe = RECIPES[id];
        return recipe ? describePlan(generateTrack(recipe, seed ?? recipe.seed)) : null;
      },
    };
    window.__MAPS__ = handle;
    return () => {
      if (window.__MAPS__ === handle) delete window.__MAPS__;
    };
  }, [gl, world]);
}
