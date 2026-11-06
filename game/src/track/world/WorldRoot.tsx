/**
 * Tessera Isle root (lazy chunk). State machine:
 *   loading  → the generator runs in its worker (cached per page: re-entering never regenerates);
 *   building → terrain, districts and water mount; the colliders are created (trimeshes 8 per frame);
 *   ready    → WorldRules mounts, the resolvers are installed, and the selected entry's layout is
 *              registered (only now, so the car never spawns before its ground).
 * Switching between island entries keeps this mounted (Track keys it by the world) and only
 * re-registers the layout. Fills useWorldHud for the HUD; on error: banner + back to chaos.
 * Everything is disposed / reset on unmount.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createVoxelMaterial } from '../chaos/voxel';
import { resolveCarId } from '../../car/catalog';
import { resolveTrackId } from '../registry';
import { useSelection, selectionState } from '../../state/selection';
import { useGameStore } from '../../state/store';
import { useWorldHud, worldLive } from '../../state/worldRuntime';
import { resetWorldEngine, worldEngine } from './engine';
import type { WorldData } from './gen/types';
import { markersOf, minimapOf, routeOf, travelSpotsOf } from './hudData';
import { isIslandLayout, islandLayout } from './layouts';
import { cachedWorld, loadProgress, loadWorld, type LoadedWorld } from './loadWorld';
import { buildRoadIndex } from './physics/roadIndex';
import { resetSafePoses } from './physics/safePose';
import { WorldColliders } from './physics/WorldColliders';
import { clearPendingTravel, createWorldActions, WorldRules } from './physics/WorldRules';
import { Districts } from './scene/Districts';
import { createEventAtlas } from './scene/eventAtlas';
import { EventLayer } from './scene/EventLayer';
import { createGlowMaterial } from './scene/glowMaterial';
import { signSpecs } from './scene/signs';
import { Terrain } from './scene/Terrain';
import { createTerrainMaterial, createTerrainTextures } from './scene/terrainMaterial';
import { ShaderWarmup, type WarmupItem } from './scene/ShaderWarmup';
import { Water } from './scene/Water';
import { createWaterMaterial } from './scene/waterMaterial';
import { installWorldDebug } from './worldDebug';

export const WORLD_ID = 'tessera';
/** Share of the loading bar spent generating; the rest is building colliders. */
const GEN_SHARE = 0.7;

type Phase = { state: 'loading' } | { state: 'building' | 'ready'; loaded: LoadedWorld } | { state: 'error' };

function resetLive(): void {
  worldLive.surface = null;
  worldLive.wheelSurface.fill(null);
  worldLive.waterDepth = 0;
  worldLive.nextGate = -1;
  worldLive.totalGates = 0;
  worldLive.nextGateM = Number.NaN;
  worldLive.wrongWay = false;
  worldLive.missedGate = false;
  worldLive.stuckHint = false;
}

export default function WorldRoot() {
  const trackId = resolveTrackId(useSelection((s) => s.trackId));
  const [phase, setPhase] = useState<Phase>(() => {
    const hit = cachedWorld();
    return hit ? { state: 'building', loaded: hit } : { state: 'loading' };
  });

  // Mount / unmount bookkeeping.
  useEffect(() => {
    worldEngine.mountedAt = performance.now();
    worldEngine.readyAt = 0;
    useWorldHud.getState().set({ active: true, worldId: WORLD_ID, loading: 0 });
    return () => {
      useWorldHud.getState().reset();
      resetLive();
      resetSafePoses();
      clearPendingTravel();
      resetWorldEngine();
    };
  }, []);

  // loading → building
  useEffect(() => {
    if (phase.state !== 'loading') return;
    let alive = true;
    worldEngine.state = 'loading';
    const timer = window.setInterval(() => useWorldHud.getState().set({ loading: GEN_SHARE * loadProgress() }), 100);
    loadWorld().then(
      (loaded) => {
        if (alive) setPhase({ state: 'building', loaded });
      },
      (err: unknown) => {
        if (!alive) return;
        console.error('[world] Tessera Isle failed to generate', err);
        setPhase({ state: 'error' });
      },
    );
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase.state]);

  useEffect(() => {
    if (phase.state !== 'error') return;
    worldEngine.state = 'error';
    useGameStore.getState().pushUplink('error', 'Tessera Isle failed to load: back to the chaos track');
    useWorldHud.getState().set({ loading: null });
    selectionState().setTrack('chaos');
  }, [phase.state]);

  const data = phase.state === 'building' || phase.state === 'ready' ? phase.loaded.data : null;
  const loaded = phase.state === 'building' || phase.state === 'ready' ? phase.loaded : null;

  useEffect(() => {
    if (!loaded) return;
    worldEngine.data = loaded.data;
    if (worldEngine.phases.data === 0) worldEngine.phases.data = performance.now();
    worldEngine.genWhere = loaded.where;
    worldEngine.genMs = loaded.genMs;
    if (phase.state === 'building') worldEngine.state = 'building';
  }, [loaded, phase.state]);

  return data ? (
    <WorldScene
      data={data}
      trackId={trackId}
      ready={phase.state === 'ready'}
      onProgress={(p) => {
        if (phase.state === 'building') useWorldHud.getState().set({ loading: GEN_SHARE + (1 - GEN_SHARE) * p });
      }}
      onReady={() => setPhase((ph) => (ph.state === 'building' ? { state: 'ready', loaded: ph.loaded } : ph))}
    />
  ) : null;
}

function WorldScene({ data, trackId, ready, onProgress, onReady }: { data: WorldData; trackId: string; ready: boolean; onProgress: (p: number) => void; onReady: () => void }) {
  const gpu = useMemo(() => {
    const textures = createTerrainTextures(data);
    const carId = resolveCarId(useGameStore.getState().carId);
    const atlas = createEventAtlas(signSpecs(data, carId), carId);
    const out = {
      textures,
      atlas,
      glow: createGlowMaterial(atlas.texture),
      terrain: createTerrainMaterial(textures),
      voxel: createVoxelMaterial({ roughness: 0.78, metalness: 0.08 }),
      water: createWaterMaterial(textures.tile, 1),
      // Glassmere is ≤ 0.6 m deep: stretch its depth so it reads as a clear shelf, not foam.
      lake: createWaterMaterial(textures.tile, 6),
    };
    out.terrain.name = 'tessera-terrain';
    out.voxel.name = 'tessera-voxel';
    out.water.name = 'tessera-water';
    return out;
  }, [data]);
  useEffect(
    () => () => {
      gpu.textures.dispose();
      gpu.terrain.dispose();
      gpu.voxel.dispose();
      gpu.water.dispose();
      gpu.lake.dispose();
      gpu.glow.dispose();
      gpu.atlas.dispose();
    },
    [gpu],
  );
  const warm = useMemo(() => {
    const items: WarmupItem[] = [
      { material: gpu.terrain, receiveShadow: true },
      { material: gpu.voxel, receiveShadow: true },
      { material: gpu.water, receiveShadow: false },
      { material: gpu.glow, receiveShadow: false },
    ];
    return { items, textures: [gpu.textures.tile, gpu.textures.field, gpu.atlas.texture], tasks: gpu.atlas.steps };
  }, [gpu]);
  // ready = colliders built AND programs linked
  const parts = useRef({ colliders: false, shaders: false });
  const partDone = (k: 'colliders' | 'shaders') => {
    parts.current[k] = true;
    worldEngine.phases[k] = performance.now();
    if (parts.current.colliders && parts.current.shaders) onReady();
  };
  const roads = useMemo(() => buildRoadIndex(data.roads), [data]);
  const actions = useMemo(() => createWorldActions(data), [data]);

  useEffect(() => installWorldDebug(roads), [roads]);

  // Register the selected entry's layout once ready; switching entries re-registers.
  useLayoutEffect(() => {
    if (!ready) return;
    const layout = islandLayout(data, trackId);
    if (!layout) return;
    worldEngine.state = 'ready';
    // the island draws from the frame its layout registers (build frames stay cheap)
    worldEngine.reveal = { terrain: true, districts: true, water: true };
    if (worldEngine.readyAt === 0) worldEngine.readyAt = performance.now();
    if (useGameStore.getState().trackLayout !== layout) useGameStore.getState().setTrackLayout(layout);
    useWorldHud.getState().set({
      loading: null,
      minimap: minimapOf(data),
      markers: markersOf(data, trackId),
      route: routeOf(data, trackId),
      travelSpots: travelSpotsOf(data),
      actions,
    });
  }, [ready, data, trackId, actions]);

  // Leaving the island: drop our layout before the next map registers its own.
  useLayoutEffect(
    () => () => {
      const s = useGameStore.getState();
      if (isIslandLayout(data, s.trackLayout)) s.clearTrackLayout();
    },
    [data],
  );

  return (
    <>
      <Terrain world={data} material={gpu.terrain} />
      <Districts world={data} material={gpu.voxel} />
      <Water sea={gpu.water} lake={gpu.lake} />
      <WorldColliders world={data} onProgress={onProgress} onReady={() => partDone('colliders')} />
      {!ready && <ShaderWarmup items={warm.items} textures={warm.textures} tasks={warm.tasks} onDone={() => partDone('shaders')} />}
      {ready && <EventLayer data={data} entryId={trackId} roads={roads} atlas={gpu.atlas} voxel={gpu.voxel} glow={gpu.glow} />}
      {ready && <WorldRules data={data} roads={roads} entryId={trackId} />}
    </>
  );
}
