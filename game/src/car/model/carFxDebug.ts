/**
 * `window.__CARFX__` — read-only diagnostics for the car visuals (voxel/face counts, live wing
 * pose and light channels, smoke pool state, renderer stats). Used by the automated visual checks;
 * documented in game/README.md.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { CarModelStats } from './carAssets';

export interface SmokeDebugStats {
  capacity: number;
  alive: number;
  /** Puffs emitted since load. */
  emitted: number;
  /** Current emission rate, puffs/s (rear-wheel smoke plus, on all-wheel-drive cars, launch dust). */
  rate: number;
  /** The launch-dust part of `rate`, puffs/s (all-wheel-drive cars only; always 0 for rear-drive cars). */
  dustRate: number;
  /** Launch-dust puffs emitted since the smoke emitter mounted (all-wheel-drive cars only; 0 for rear-drive cars). */
  dustEmitted: number;
}

export interface CarFxLiveState {
  wingMainDeg: number;
  wingUpperDeg: number;
  wingMainChord: number;
  wingUpperChord: number;
  /** Linear RGB radiance per emissive channel: [none, headlight, tail, exhaust, aero]. */
  channels: [number, number, number][];
  flameLength: number;
  /** Visible car meshes (colour-pass draw calls) and the subset that also renders into the shadow map. */
  drawables: { meshes: number; shadowCasters: number };
}

export interface CarFxDebugHandle {
  model(): CarModelStats | null;
  live(): CarFxLiveState | null;
  smoke(): SmokeDebugStats | null;
  renderInfo(): { calls: number; triangles: number; geometries: number; programs: number };
}

declare global {
  interface Window {
    __CARFX__?: CarFxDebugHandle;
  }
}

/** Providers filled by the mounted CarModel / TireSmoke. */
export const carFxDebug: {
  model: (() => CarModelStats) | null;
  live: (() => CarFxLiveState) | null;
  smoke: (() => SmokeDebugStats) | null;
} = { model: null, live: null, smoke: null };

export function useCarFxDebugHandle(): void {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const handle: CarFxDebugHandle = {
      model: () => carFxDebug.model?.() ?? null,
      live: () => carFxDebug.live?.() ?? null,
      smoke: () => carFxDebug.smoke?.() ?? null,
      renderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        programs: gl.info.programs?.length ?? 0,
      }),
    };
    window.__CARFX__ = handle;
    return () => {
      if (window.__CARFX__ === handle) delete window.__CARFX__;
    };
  }, [gl]);
}
