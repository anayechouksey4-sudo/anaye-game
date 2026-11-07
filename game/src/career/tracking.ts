/**
 * Career tracking: the one place that listens to the game for the career store.
 *
 *   finish / respawn / restart   → game/events.ts (the run store emits them)
 *   position vs rivals / friends → rivals/standings.ts participants ranked at the finish instant
 *                                  (finishPosition; the published snapshot can lag a physics step)
 *   friends races                → multiplayer/roomStore.ts phase changes (countdown as host, results)
 *   distance, time, top speed    → a 10 Hz sampler over carRuntime (speedKmh × simulated time from
 *                                  the physics step counter, so the paused menu and background tabs
 *                                  add nothing); accumulated in module scalars, flushed every 3 s
 *   island regions / AIR records → state/worldRuntime.ts (useWorldHud.regionLabel, worldLive.air)
 *
 * No allocation on the sampler's hot path; a flush builds one new Career. Every commit runs the
 * trophy rules; new unlocks are stamped and queued for the toast.
 */
import { carRuntime } from '../car/runtime';
import { PHYSICS_DT } from '../config';
import { onGameEvent } from '../game/events';
import { positionOf, isHost, useRoom } from '../multiplayer/roomStore';
import { participantsList, standingsSnapshot } from '../rivals/standings';
import { inputSettings } from '../state/inputSettings';
import { medalFor, medalsFor } from '../state/records';
import { gameState } from '../state/store';
import { useWorldHud, worldLive } from '../state/worldRuntime';
import {
  addSample,
  finishPosition,
  recordAir,
  recordFall,
  recordFinish,
  recordFriendsRace,
  recordRestart,
  unlockTrophies,
  useCareer,
  visitRegion,
  type Career,
} from './store';
import { enqueueTrophyToast } from './toastStore';
import { evaluateTrophies } from './trophies';

/** Sampler period, ms (10 Hz). */
export const SAMPLE_MS = 100;
/** Ticks between flushes of the accumulated distance / time (30 × 100 ms = 3 s). */
export const FLUSH_TICKS = 30;
/** A single tick never credits more simulated time than this (a long `advance()` is capped, a stall adds nothing). */
const MAX_STEPS_PER_TICK = 60 * 120;

/** Counters for tests / the debug console. */
export const careerTrackingStats = { ticks: 0, flushes: 0, commits: 0, unlocks: 0 };

let stop: (() => void) | null = null;

/** Apply trophy rules to `next`, stamp new unlocks, persist (through the store) and queue toasts. */
export function commitCareer(next: Career): Career {
  const store = useCareer.getState();
  if (next === store.career) return next;
  const ids = evaluateTrophies(next);
  const stamped = ids.length > 0 ? unlockTrophies(next, ids, Date.now()) : next;
  store.commit(stamped);
  careerTrackingStats.commits++;
  for (const id of ids) {
    careerTrackingStats.unlocks++;
    enqueueTrophyToast(id);
  }
  return stamped;
}

const career = (): Career => useCareer.getState().career;

/**
 * Subscribes to the event bus and the stores. Call once at app start; returns an unsubscribe.
 * A second call while running returns the running instance's unsubscribe.
 */
export function startCareerTracking(): () => void {
  if (stop) return stop;
  const offs: (() => void)[] = [];

  // ── 10 Hz sampler: scalars only, flushed as one Career every FLUSH_TICKS ──
  let lastSteps = carRuntime.stepCount;
  let pendTrack: string | null = null;
  let pendCar: string | null = null;
  let pendDistanceM = 0;
  let pendSeconds = 0;
  let pendTopKmh = 0;
  let ticks = 0;
  let airSerial = worldLive.air.serial;

  const flush = () => {
    if (pendDistanceM === 0 && pendSeconds === 0 && pendTopKmh === 0) return;
    careerTrackingStats.flushes++;
    commitCareer(addSample(career(), { trackId: pendTrack, carId: pendCar, distanceM: pendDistanceM, seconds: pendSeconds, topSpeedKmh: pendTopKmh }));
    pendDistanceM = 0;
    pendSeconds = 0;
    pendTopKmh = 0;
  };

  const tick = () => {
    careerTrackingStats.ticks++;
    const steps = carRuntime.stepCount;
    const d = steps - lastSteps;
    lastSteps = steps;
    if (worldLive.air.serial !== airSerial) {
      airSerial = worldLive.air.serial;
      commitCareer(recordAir(career(), worldLive.air.seconds, worldLive.air.metres));
    }
    if (d <= 0 || !carRuntime.ready) return;
    const s = gameState();
    const trackId = s.trackLayout ? s.trackLayout.id : null;
    const carId = carRuntime.carId;
    if (trackId !== pendTrack || carId !== pendCar) {
      flush();
      pendTrack = trackId;
      pendCar = carId;
    }
    const dt = Math.min(d, MAX_STEPS_PER_TICK) * PHYSICS_DT;
    const kmh = carRuntime.speedKmh;
    pendSeconds += dt;
    pendDistanceM += (kmh / 3.6) * dt;
    if (kmh > pendTopKmh) pendTopKmh = kmh;
    if (++ticks >= FLUSH_TICKS) {
      ticks = 0;
      flush();
    }
  };
  const interval = setInterval(tick, SAMPLE_MS);
  offs.push(() => clearInterval(interval));

  // ── Race events ──
  offs.push(
    onGameEvent('finish', ({ elapsedMs }) => {
      tick();
      flush();
      const s = gameState();
      const trackId = s.trackLayout?.id;
      if (!trackId) return;
      const carId = s.carId;
      // Ranked from the participants at this instant: the published snapshot can be a physics step behind.
      const rows = participantsList();
      const ranked = rows.some((r) => r.kind === 'player') ? finishPosition(rows, elapsedMs) : null;
      const snap = standingsSnapshot();
      const position = ranked ? ranked.position : snap.total >= 2 && snap.playerPosition > 0 ? snap.playerPosition : null;
      commitCareer(
        recordFinish(career(), {
          trackId,
          carId,
          ms: elapsedMs,
          falls: s.run.falls,
          medal: medalFor(elapsedMs, medalsFor(trackId, carId)),
          position,
          steering: inputSettings().steering,
        }),
      );
    }),
  );
  offs.push(
    onGameEvent('respawn', ({ reason }) => {
      if (reason === 'fall' || reason === 'water' || reason === 'bounds') commitCareer(recordFall(career()));
    }),
  );
  offs.push(onGameEvent('restart', () => commitCareer(recordRestart(career()))));

  // ── Friends races: hosted when our lights go out as host; played / won when the results close ──
  offs.push(
    useRoom.subscribe((s, prev) => {
      const phase = s.race?.phase ?? null;
      if (phase === (prev.race?.phase ?? null)) return;
      if (phase === 'countdown' && isHost(s)) commitCareer(recordFriendsRace(career(), { played: false, won: false, players: 0, hosted: true }));
      if (phase === 'results' && s.race) {
        const row = s.race.results.find((r) => r.id === s.you);
        if (!row) return;
        const won = row.finishMs !== null && positionOf(s.race, s.you) === 1;
        commitCareer(recordFriendsRace(career(), { played: true, won, players: s.race.results.length, hosted: false }));
      }
    }),
  );

  // ── Island regions ──
  offs.push(
    useWorldHud.subscribe((s, prev) => {
      if (s.regionLabel && s.regionLabel !== prev.regionLabel) commitCareer(visitRegion(career(), s.regionLabel));
    }),
  );

  // ── Keep the last seconds when the page goes away ──
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  offs.push(() => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
  });

  // Rules may already pass for a loaded career whose trophies predate a rule (or a reset of the
  // trophy list): stamp them silently, no toast.
  const loaded = career();
  const owed = evaluateTrophies(loaded);
  if (owed.length > 0) useCareer.getState().commit(unlockTrophies(loaded, owed, Date.now()));

  stop = () => {
    flush();
    for (const off of offs) off();
    stop = null;
  };
  return stop;
}
