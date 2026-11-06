import { useEffect, useRef, useState } from 'react';
import { getCarEntry } from '../car/catalog';
import { onGameEvent } from '../game/events';
import { MEDAL_LABEL, medalFor, medalsFor, nextMedal, type Medal } from '../state/records';
import { selectionState, useSelection } from '../state/selection';
import { gameState, useGameStore } from '../state/store';
import { TRACK_CATALOG, getTrackEntry } from '../track/catalog';
import { formatRaceTime } from './hudUtils';
import { openMenu } from './uiStore';

interface RunResult {
  id: number;
  elapsedMs: number;
  bestMs: number | null;
  previousBestMs: number | null;
  isBest: boolean;
  medal: Medal | null;
  next: { medal: Medal; ms: number } | null;
  medals: { gold: number; silver: number; bronze: number } | null;
  checkpoints: number;
  totalCheckpoints: number;
  falls: number;
  speedTrapKmh: number | null;
  trackId: string;
  trackName: string;
  carName: string;
  accent: string;
}

/** The map after `trackId` in the catalog (wraps around). */
export function nextTrackId(trackId: string): string {
  const i = TRACK_CATALOG.findIndex((t) => t.id === trackId);
  return TRACK_CATALOG[(i + 1) % TRACK_CATALOG.length]?.id ?? trackId;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}

export function MedalBadge({ medal, small = false }: { medal: Medal | null; small?: boolean }) {
  if (!medal) return null;
  return (
    <span className={`gm-medal gm-medal--${medal}${small ? ' gm-medal--small' : ''}`} data-testid={`medal-${medal}`}>
      <i aria-hidden="true" />
      {MEDAL_LABEL[medal]}
    </span>
  );
}

/**
 * Results screen at the finish line: time, best for this car + map, NEW RECORD, medal against this
 * car's medal times on the map (state/records.ts medalsFor), checkpoints and falls; RETRY / NEXT
 * MAP / GARAGE. The car keeps rolling underneath; the screen goes away with a new run (retry,
 * restart, map or car change) or ✕.
 */
export function Results() {
  const [result, setResult] = useState<RunResult | null>(null);
  const [hidden, setHidden] = useState(false);
  const menuOpen = useSelection((s) => s.menuOpen);
  // Best time before this finish (the store already holds the new one when 'finish' fires).
  const previousBest = useRef<number | null>(null);
  const runBest = useGameStore((s) => s.run.bestMs);
  const finished = useGameStore((s) => s.run.finished);
  if (!finished) previousBest.current = runBest;

  useEffect(() => {
    let id = 0;
    const clear = () => setResult(null);
    const offs = [
      onGameEvent('finish', ({ elapsedMs, bestMs, isBest }) => {
        const s = gameState();
        const trackId = s.trackLayout?.id ?? selectionState().trackId;
        const track = getTrackEntry(trackId);
        // This car's medal times on this map (records.ts: hypercar times scaled per car; none when
        // the car can't clear the map's big jump).
        const medals = track.id === trackId ? medalsFor(trackId, s.carId) : null;
        setHidden(false);
        setResult({
          id: ++id,
          elapsedMs,
          bestMs,
          previousBestMs: previousBest.current,
          isBest,
          medal: medalFor(elapsedMs, medals),
          next: nextMedal(elapsedMs, medals),
          medals,
          checkpoints: s.run.checkpoint,
          totalCheckpoints: s.run.totalCheckpoints,
          falls: s.run.falls,
          speedTrapKmh: s.run.speedTrapKmh,
          trackId,
          trackName: s.trackLayout?.name ?? track.name,
          carName: getCarEntry(s.carId).name,
          accent: track.accent,
        });
      }),
      onGameEvent('restart', clear),
    ];
    const offLayout = useGameStore.subscribe((s, prev) => {
      if (s.trackLayout !== prev.trackLayout) clear();
    });
    return () => {
      offs.forEach((off) => off());
      offLayout();
    };
  }, []);

  if (!result || hidden || menuOpen) return null;
  const r = result;
  const improvedBy = r.isBest && r.previousBestMs !== null ? r.previousBestMs - r.elapsedMs : null;
  const nextId = nextTrackId(r.trackId);
  const nextName = getTrackEntry(nextId).name;

  return (
    <div className="hud-results" data-testid="results" role="dialog" aria-label="Run results">
      <div className="hud-results__card" style={{ ['--accent' as string]: r.accent }}>
        <button type="button" className="hud-results__close" onClick={() => setHidden(true)} aria-label="Hide results">
          ✕
        </button>
        <div className="hud-results__head">
          <b>FINISH</b>
          <span>
            {r.trackName} · {r.carName}
          </span>
        </div>
        <div className="hud-results__main">
          <div className="hud-results__time" data-testid="results-time">
            {formatRaceTime(r.elapsedMs)}
          </div>
          {r.isBest && (
            <div className="hud-results__record" data-testid="results-record">
              NEW RECORD{improvedBy !== null && improvedBy > 0 ? ` −${seconds(improvedBy)}` : ''}
            </div>
          )}
          <div className="hud-results__medal">
            {r.medal ? <MedalBadge medal={r.medal} /> : r.medals ? <span className="hud-dim">NO MEDAL</span> : null}
            {r.next && (
              <span className="hud-results__next">
                {MEDAL_LABEL[r.next.medal]} AT {formatRaceTime(r.next.ms)} · {seconds(r.elapsedMs - r.next.ms)} TO FIND
              </span>
            )}
          </div>
        </div>
        <dl className="hud-results__stats">
          <div>
            <dt>BEST</dt>
            <dd data-testid="results-best">{formatRaceTime(r.bestMs)}</dd>
          </div>
          <div>
            <dt>CHECKPOINTS</dt>
            <dd>
              {r.checkpoints}/{r.totalCheckpoints}
            </dd>
          </div>
          <div>
            <dt>FALLS</dt>
            <dd className={r.falls > 0 ? 'is-bad' : undefined}>{r.falls}</dd>
          </div>
          {r.speedTrapKmh !== null && (
            <div>
              <dt>JUMP LIP</dt>
              <dd>{r.speedTrapKmh.toFixed(0)} km/h</dd>
            </div>
          )}
        </dl>
        <div className="hud-results__actions">
          <button type="button" className="gm-btn gm-btn--primary" onClick={() => gameState().restart()} data-testid="results-retry">
            ⟲ RETRY
          </button>
          <button
            type="button"
            className="gm-btn"
            onClick={() => selectionState().setTrack(nextId)}
            data-testid="results-next"
            title={nextName}
          >
            NEXT MAP ▸
          </button>
          <button type="button" className="gm-btn" onClick={() => openMenu('garage')} data-testid="results-garage">
            GARAGE
          </button>
        </div>
      </div>
    </div>
  );
}
