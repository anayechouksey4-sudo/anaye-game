/**
 * Open-world shell, registered in TRACKS for every island entry. Kept tiny (it is in the boot
 * bundle): the engine is the lazy WorldRoot chunk and the generator runs in its own worker file.
 * On mount it starts the generator worker (loadWorld, a few hundred bytes), drops a non-island
 * layout at once, so the previous map's car never drives on air while the island loads, and shows
 * the loading state until WorldRoot takes over.
 */
import { lazy, Suspense, useLayoutEffect } from 'react';
import { TRACK_CATALOG } from '../catalog';
import { useGameStore } from '../../state/store';
import { useWorldHud } from '../../state/worldRuntime';
import { loadWorld } from './loadWorld';

const WorldRoot = lazy(() => import('./WorldRoot'));

const isIslandId = (id: string): boolean => TRACK_CATALOG.some((t) => t.id === id && t.world !== undefined);

export function OpenWorld() {
  useLayoutEffect(() => {
    // Start the generator worker now, in parallel with the WorldRoot chunk download (cached per page).
    loadWorld().catch(() => {
      // WorldRoot reports the failure (banner + back to chaos).
    });
    const s = useGameStore.getState();
    if (s.trackLayout && !isIslandId(s.trackLayout.id)) s.clearTrackLayout();
    const hud = useWorldHud.getState();
    if (!hud.active) hud.set({ active: true, worldId: 'tessera', loading: 0 });
    return () => useWorldHud.getState().reset();
  }, []);
  return (
    <Suspense fallback={null}>
      <WorldRoot />
    </Suspense>
  );
}
