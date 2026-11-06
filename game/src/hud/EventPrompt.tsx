import { useEffect, useRef } from 'react';
import { emitHapticCue } from '../audio/haptics';
import { isEditableTarget } from '../car/input';
import { carRuntime } from '../car/runtime';
import { loadBestTime } from '../state/records';
import { selectionState, useSelection } from '../state/selection';
import { useWorldHud } from '../state/worldRuntime';
import { TRACK_CATALOG } from '../track/catalog';
import { toggleClass, useRafLoop } from './hudUtils';

/** The prompt goes away above this speed even before the world clears it (PLAN §3.8). */
const PROMPT_MAX_KMH = 40;

/** m:ss.s (one decimal is plenty on a pill). */
function shortTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--';
  const tenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

function startEvent(trackId: string): void {
  if (carRuntime.speedKmh > PROMPT_MAX_KMH) return;
  selectionState().setTrack(trackId);
}

/**
 * Free roam: the car is parked on an event pad (`useWorldHud.prompt`, written by the world when it
 * is within 14 m of a start pad under 40 km/h). One tap, or Enter, starts that race: the world stays
 * loaded, the car goes to the start and the lights run. Lives at the top of the callout column
 * (Banners.tsx), so callouts queue under it; placement per viewport is in hud.css / minimap.css.
 */
export function EventPrompt() {
  const prompt = useWorldHud((s) => s.prompt);
  const carId = useSelection((s) => s.carId);
  const ref = useRef<HTMLButtonElement>(null);

  // Hide straight away above the speed limit (the world re-evaluates every few steps).
  useRafLoop(() => toggleClass(ref.current, 'is-fast', carRuntime.speedKmh > PROMPT_MAX_KMH));

  const trackId = prompt?.trackId ?? null;
  useEffect(() => {
    if (!trackId) return;
    emitHapticCue('prompt');
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      if (selectionState().menuOpen) return;
      e.preventDefault();
      startEvent(trackId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trackId]);

  if (!prompt) return null;
  const entry = TRACK_CATALOG.find((t) => t.id === prompt.trackId);
  const title = prompt.title || entry?.name.toUpperCase() || prompt.trackId.toUpperCase();
  const detail =
    entry && entry.lengthM !== undefined
      ? `${(entry.lengthM / 1000).toFixed(1)} KM · BEST ${shortTime(loadBestTime(entry.id, carId))}`
      : prompt.detail;
  return (
    <button
      type="button"
      ref={ref}
      className="hud-prompt"
      style={entry ? { ['--accent' as string]: entry.accent } : undefined}
      onClick={() => startEvent(prompt.trackId)}
      data-testid="event-prompt"
      data-track={prompt.trackId}
    >
      <span className="hud-prompt__go" aria-hidden="true">
        ▶
      </span>
      <span className="hud-prompt__text">
        <b>START {title}</b>
        {detail && (
          <small>
            <span className="hud-sr"> · </span>
            {detail}
          </small>
        )}
      </span>
    </button>
  );
}
