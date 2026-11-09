/**
 * The shared race, driven by the room's `race` state (roomStore) and the game's own events:
 *
 *   track    — the host's MAPS pick goes out as room:race {phase: 'lobby', track}; every member's
 *              selection store follows room:race.track (the normal map switch: new layout, new car)
 *   start    — the host's START sets startAt = relayNow + 4 s; each client restarts its run at
 *              startAt − 3 × COUNTDOWN_STEP_S on the relay clock, so the normal local lights
 *              (game/countdown.ts, counted in physics steps) reach GO at startAt
 *   finish   — our 'finish' event becomes room:finish; the host closes the race (phase 'results')
 *              when every present participant has a time, or ROOM_RESULTS_GRACE_MS after the first
 *   results  — owned by the relay (shared/protocol.ts); this module never edits them
 *
 * Late joiners (no results row) drive the track untimed and are in from the next START.
 */
import { ROOM_RESULTS_GRACE_MS, type RoomRace } from '@shared/protocol';
import { COUNTDOWN_STEP_S, getCountdownSnapshot } from '../game/countdown';
import { onGameEvent } from '../game/events';
import { closeMenu } from '../hud/uiStore';
import { selectionState, useSelection } from '../state/selection';
import { gameState } from '../state/store';
import { resolveTrackId } from '../track/registry';
import { isHost, roomState, useRoom, type RoomState } from './roomStore';

/** Lights: 3 · 2 · 1 take this long before GO (game/countdown.ts). */
export const LIGHTS_MS = Math.round(3 * COUNTDOWN_STEP_S * 1000);
/** A start this far in the past is not restarted into any more (we just drive on, untimed). */
const TOO_LATE_MS = 8000;

export interface RaceFlowContext {
  relayNow: () => number;
  sendRace: (race: Omit<RoomRace, 'results'>) => boolean;
  finish: (finishMs: number, falls: number) => boolean;
}

export function installRaceFlow(ctx: RaceFlowContext): () => void {
  const offs: (() => void)[] = [];
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The startAt we armed our lights for (null = none pending or done). */
  let armedFor: number | null = null;
  /** Serial of the countdown our restart armed (game/countdown.ts); a GO from any other lights is not ours. */
  let armedSerial: number | null = null;
  /** The startAt whose GO we saw. */
  let goFor: number | null = null;
  let restartedSinceGo = false;
  let closeKey: number | null = null;
  let hostTrackPending = false;

  const clearArm = () => {
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
  };
  const clearClose = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    closeKey = null;
  };

  /** Every member: switch to the room's track when it changes. */
  const followTrack = (race: RoomRace | null) => {
    if (!race?.track) return;
    const track = resolveTrackId(race.track);
    if (track !== race.track) return; // unknown to this build
    if (resolveTrackId(selectionState().trackId) !== track) selectionState().setTrack(track);
  };

  /** Host: announce our track when the room has none (a fresh room, or we inherited one without a track). */
  const announceTrack = (s: RoomState) => {
    if (s.status !== 'in-room' || !isHost(s) || !s.race) return;
    const mine = resolveTrackId(selectionState().trackId);
    if (s.race.track === null) {
      ctx.sendRace({ phase: 'lobby', track: mine, startAt: null });
      return;
    }
    if (hostTrackPending && (s.race.phase === 'lobby' || s.race.phase === 'results') && s.race.track !== mine) {
      hostTrackPending = false;
      ctx.sendRace({ phase: 'lobby', track: mine, startAt: null });
    }
  };

  /** Arm our lights so GO lands on startAt. */
  const scheduleStart = (race: RoomRace, participant: boolean) => {
    if (race.phase !== 'countdown' || race.startAt === null || armedFor === race.startAt || goFor === race.startAt) return;
    if (!participant) return;
    const startAt = race.startAt;
    const delay = startAt - LIGHTS_MS - ctx.relayNow();
    if (delay < -TOO_LATE_MS) return;
    clearArm();
    armedFor = startAt;
    armedSerial = null;
    restartedSinceGo = false;
    useRoom.getState().set({ goAt: null, armAt: null });
    armTimer = setTimeout(
      () => {
        armTimer = null;
        useRoom.getState().set({ armAt: ctx.relayNow() });
        if (selectionState().menuOpen) closeMenu();
        gameState().restart();
        // restart → 'restart' event → armCountdown (synchronous): this serial is ours. Free roam arms nothing.
        const lights = getCountdownSnapshot();
        armedSerial = lights.active ? lights.serial : null;
      },
      Math.max(0, delay),
    );
  };

  /** Host: close the race when everyone present has a time, or ROOM_RESULTS_GRACE_MS after the first finisher. */
  const maybeClose = (s: RoomState) => {
    if (s.status !== 'in-room' || !isHost(s) || !s.race) return clearClose();
    const race = s.race;
    if (race.phase !== 'countdown' && race.phase !== 'racing') return clearClose();
    const present = new Set(s.players.map((p) => p.id));
    const rows = race.results.filter((r) => present.has(r.id));
    const finished = race.results.filter((r) => r.finishMs !== null);
    if (rows.length > 0 && rows.every((r) => r.finishMs !== null)) {
      clearClose();
      ctx.sendRace({ phase: 'results', track: race.track, startAt: race.startAt });
      return;
    }
    if (finished.length === 0) return clearClose();
    const key = race.startAt ?? 0;
    if (closeKey === key && closeTimer) return;
    clearClose();
    closeKey = key;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      const now = roomState();
      if (now.status === 'in-room' && isHost(now) && now.race && (now.race.phase === 'countdown' || now.race.phase === 'racing') && (now.race.startAt ?? 0) === key) {
        ctx.sendRace({ phase: 'results', track: now.race.track, startAt: now.race.startAt });
      }
    }, ROOM_RESULTS_GRACE_MS);
  };

  offs.push(
    useRoom.subscribe((s, prev) => {
      if (s.status !== 'in-room') {
        // A link blip keeps our record of this race (the seat comes back with the same results row):
        // no restart into a race we are already driving, and our own clock still times it.
        if (prev.status === 'in-room' && s.left !== 'link') {
          clearArm();
          clearClose();
          armedFor = null;
          armedSerial = null;
          goFor = null;
        }
        if (prev.status === 'in-room') clearClose();
        return;
      }
      if (s.race !== prev.race || s.status !== prev.status) {
        followTrack(s.race);
        if (s.race) scheduleStart(s.race, s.participant);
      }
      if (s.race !== prev.race || s.players !== prev.players || s.status !== prev.status) {
        announceTrack(s);
        maybeClose(s);
      }
    }),
  );

  // The host's map pick follows into the room (only between races).
  offs.push(
    useSelection.subscribe((s, prev) => {
      if (s.trackId === prev.trackId) return;
      const room = roomState();
      if (room.status !== 'in-room' || !isHost(room) || !room.race) return;
      const mine = resolveTrackId(s.trackId);
      if (room.race.track === mine) return;
      if (room.race.phase === 'lobby' || room.race.phase === 'results') ctx.sendRace({ phase: 'lobby', track: mine, startAt: null });
      else hostTrackPending = true;
    }),
  );

  offs.push(
    onGameEvent('countdown', ({ step }) => {
      if (step !== 0 || armedFor === null || armedSerial === null || getCountdownSnapshot().serial !== armedSerial) return;
      const s = roomState();
      goFor = armedFor;
      armedFor = null;
      armedSerial = null;
      restartedSinceGo = false;
      const goAt = ctx.relayNow();
      useRoom.getState().set({ goAt });
      if (s.status === 'in-room' && isHost(s) && s.race && s.race.phase === 'countdown') {
        ctx.sendRace({ phase: 'racing', track: s.race.track, startAt: s.race.startAt });
      }
    }),
  );

  offs.push(
    onGameEvent('restart', () => {
      if (goFor !== null && armedFor === null) restartedSinceGo = true;
    }),
  );

  offs.push(
    onGameEvent('finish', ({ elapsedMs }) => {
      const s = roomState();
      if (s.status !== 'in-room' || !s.participant || !s.race || s.race.startAt === null) return;
      if (s.race.phase !== 'countdown' && s.race.phase !== 'racing') return;
      // Our clock measured the shared race unless we restarted after GO (or never saw this GO): then the relay clock does.
      const shared = goFor === s.race.startAt && !restartedSinceGo;
      const finishMs = shared ? elapsedMs : Math.max(0, ctx.relayNow() - s.race.startAt);
      ctx.finish(finishMs, gameState().run.falls);
    }),
  );

  return () => {
    for (const off of offs.splice(0)) off();
    clearArm();
    clearClose();
  };
}
