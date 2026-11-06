import { useWorldHud } from '../state/worldRuntime';
import { TRACK_CATALOG } from '../track/catalog';

/**
 * While an open world generates and builds (`useWorldHud.loading` 0…1), a centred card:
 * BUILDING TESSERA ISLE · 62 % with a bar. `pointer-events: none`, so ☰ and the controls still work.
 */
export function LoadingVeil() {
  const loading = useWorldHud((s) => s.loading);
  const worldId = useWorldHud((s) => s.worldId);
  if (loading === null) return null;
  const entry = TRACK_CATALOG.find((t) => t.id === worldId) ?? TRACK_CATALOG.find((t) => t.world !== undefined && t.world === worldId);
  const name = (entry?.name ?? 'the world').toUpperCase();
  const pct = Math.round(Math.max(0, Math.min(1, loading)) * 100);
  return (
    <div className="hud-veil" data-testid="loading-veil" role="status" aria-live="polite">
      <div className="hud-veil__card" style={entry ? { ['--accent' as string]: entry.accent } : undefined}>
        <b>
          BUILDING {name} · <span data-testid="loading-pct">{pct}</span> %
        </b>
        <div className="hud-veil__bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
