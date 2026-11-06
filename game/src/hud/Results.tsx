import { useEffect, useRef, useState } from 'react';
import { getCarEntry } from '../car/catalog';
import { plateFor } from '../car/plates/platePick';
import { onGameEvent } from '../game/events';
import { activeDriver, profileState } from '../state/profile';
import { MEDAL_LABEL, medalFor, medalsFor, nextMedal, type Medal } from '../state/records';
import { selectionState, useSelection } from '../state/selection';
import { gameState, useGameStore } from '../state/store';
import { useWorldHud } from '../state/worldRuntime';
import { TRACK_CATALOG, getTrackEntry, type TrackCatalogEntry } from '../track/catalog';
import { formatRaceTime } from './hudUtils';
import { openMenu, useHudUi } from './uiStore';

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
  /** Number plate the car wore (car/plates), the driver at the wheel and MY RIDE's name when it was mounted. */
  plate: string;
  driverName: string;
  rideName: string | null;
  accent: string;
}

/** MY RIDE's name when it is mounted on `carId` (the ride's base class), else null. */
function rideNameOn(carId: string): string | null {
  const p = profileState();
  return p.rideActive && p.ride.base === carId ? p.ride.name : null;
}

/** The map after `trackId` in the catalog (wraps around). */
export function nextTrackId(trackId: string): string {
  const i = TRACK_CATALOG.findIndex((t) => t.id === trackId);
  return TRACK_CATALOG[(i + 1) % TRACK_CATALOG.length]?.id ?? trackId;
}

/** An open-world race (not its free-roam entry). */
export function isWorldRace(entry: TrackCatalogEntry): boolean {
  return entry.world !== undefined && entry.mode !== 'roam';
}

/** Leave a world race for free roam where the car is (the world's action), else at the world's spawn. */
export function exitToFreeRoam(world: string): void {
  const actions = useWorldHud.getState().actions;
  if (actions) actions.freeRoamHere();
  else {
    const roam = TRACK_CATALOG.find((t) => t.world === world && t.mode === 'roam');
    if (roam) selectionState().setTrack(roam.id);
  }
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
  // The minimap steps aside while the card is up (✕ brings it back).
  const showing = result !== null && !hidden;
  useEffect(() => {
    useHudUi.getState().setResultsOpen(showing);
  }, [showing]);
  useEffect(() => () => useHudUi.getState().setResultsOpen(false), []);

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
          // Flavour: the plate the car wore and who drove (MY RIDE's name stands in for the class when mounted).
          plate: plateFor(s.carId),
          driverName: activeDriver().name,
          rideName: rideNameOn(s.carId),
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
  const nextEntry = getTrackEntry(nextId);
  const nextName = nextEntry.name;
  // Open-world races: RETRY · FREE ROAM · NEXT EVENT (the next catalog entry is a race in the same world) · GARAGE.
  const entry = getTrackEntry(r.trackId);
  const worldRace = entry.id === r.trackId && isWorldRace(entry) ? entry.world! : null;
  const nextIsEvent = worldRace !== null && nextEntry.world === worldRace && isWorldRace(nextEntry);

  return (
    <div className="hud-results" data-testid="results" role="dialog" aria-label="Run results">
      <div className="hud-results__card" style={{ ['--accent' as string]: r.accent }}>
        <button type="button" className="hud-results__close" onClick={() => setHidden(true)} aria-label="Hide results">
          ✕
        </button>
        <div className="hud-results__head">
          <b>FINISH</b>
          {/* Two pieces, so a narrow card wraps at the dot and still names the car its medals are for.
              The dot leads the car piece, so the map piece is as short as it can be. */}
          <span className="hud-results__sub" data-testid="results-sub">
            <span>{r.trackName}</span>{' '}
            <span>
              · <span data-testid="results-car">{r.rideName ? `${r.rideName} (${r.carName})` : r.carName}</span>
            </span>{' '}
            <span>
              · <span data-testid="results-plate">{r.plate}</span>
            </span>{' '}
            <span>
              · <span data-testid="results-driver">{r.driverName}</span>
            </span>
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
        <div className={`hud-results__actions${worldRace ? ' hud-results__actions--world' : ''}`}>
          <button type="button" className="gm-btn gm-btn--primary" onClick={() => gameState().restart()} data-testid="results-retry">
            ⟲ RETRY
          </button>
          {worldRace && (
            <button type="button" className="gm-btn" onClick={() => exitToFreeRoam(worldRace)} data-testid="results-freeroam">
              FREE ROAM
            </button>
          )}
          <button
            type="button"
            className="gm-btn"
            onClick={() => selectionState().setTrack(nextId)}
            data-testid="results-next"
            data-next={nextId}
            title={nextName}
          >
            {nextIsEvent ? 'NEXT EVENT ▸' : 'NEXT MAP ▸'}
          </button>
          <button type="button" className="gm-btn" onClick={() => openMenu('garage')} data-testid="results-garage">
            GARAGE
          </button>
        </div>
      </div>
    </div>
  );
}
