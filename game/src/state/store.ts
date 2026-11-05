/**
 * Global game state (zustand). Holds everything that changes at human speed: physics params,
 * squad controls, link status, run progress, UI toggles. 60 Hz values (pose, speed, slip…)
 * live in `car/runtime.ts` instead, so nothing here re-renders React every frame.
 *
 * Physics callbacks read the latest params with `useGameStore.getState().physics`, so a
 * WebSocket update is applied on the very next fixed step with no remount.
 */
import { create } from 'zustand';
import {
  CAR_PHYSICS_KEYS,
  DEFAULT_CAR_PHYSICS,
  clampPhysics,
  clampSquadControls,
  mapSquadControlsToPhysics,
  type CarPhysicsKey,
  type CarPhysicsParams,
  type SquadControls,
} from '@shared/protocol';
import { emitGameEvent, type RespawnReason } from '../game/events';
import { resetRunClock, runClock } from '../game/runClock';
import { totalCheckpointsOf, type TrackLayout } from '../track/types';

export type LinkStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected';
/** Where a physics change came from: the relay, the relay's welcome snapshot, the HUD panel, or the debug handle. */
export type UpdateSource = 'ws' | 'snapshot' | 'local' | 'debug';
export type CameraMode = 'chase' | 'orbit' | 'hood';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'orbit', 'hood'];

export type UplinkKind = 'controls' | 'physics' | 'link' | 'presence' | 'error' | 'info';

export interface UplinkEvent {
  id: number;
  /** Epoch ms of the latest occurrence. */
  at: number;
  kind: UplinkKind;
  text: string;
  /** Identical consecutive events within a second are coalesced (slider drags arrive at ~30 Hz). */
  count: number;
}

export interface RunState {
  /** Highest checkpoint index reached (0 = spawn; totalCheckpoints once finished). */
  checkpoint: number;
  totalCheckpoints: number;
  falls: number;
  /** Mirror of runClock.elapsedMs, refreshed at ~10 Hz and on start/finish/restart. */
  elapsedMs: number;
  /** Timer running (first throttle seen, not finished yet). */
  started: boolean;
  finished: boolean;
  bestMs: number | null;
  /** Speed at the big-jump lip on the latest attempt, km/h. */
  speedTrapKmh: number | null;
}

export interface PhysicsChange {
  keys: CarPhysicsKey[];
  source: UpdateSource;
  /** performance.now() of the change. */
  at: number;
}

export interface GameState {
  physics: CarPhysicsParams;
  /** Squad controls last applied (null until a dashboard has spoken). */
  controls: SquadControls | null;
  physicsRevision: number;
  lastPhysicsChange: PhysicsChange | null;

  linkStatus: LinkStatus;
  serverUrl: string;
  serverUrlSource: 'query' | 'env' | 'default' | 'none';
  dashboards: number;
  /** Epoch ms of the last squad:controls / physics:set received over the link. */
  lastUpdateAt: number | null;
  rttMs: number | null;
  uplink: UplinkEvent[];

  run: RunState;
  trackLayout: TrackLayout | null;

  ui: { physicsPanelOpen: boolean; helpOpen: boolean; cameraMode: CameraMode };

  applySquadControls: (controls: SquadControls, source?: UpdateSource) => void;
  patchPhysics: (patch: Partial<CarPhysicsParams>, source?: UpdateSource) => void;
  /** Back to the mapping of the current squad controls (or the protocol defaults if none). */
  resetPhysics: () => void;

  setLinkStatus: (status: LinkStatus) => void;
  setServerUrl: (url: string, source: GameState['serverUrlSource']) => void;
  setDashboards: (count: number) => void;
  setRtt: (ms: number | null) => void;
  pushUplink: (kind: UplinkKind, text: string) => void;

  setTrackLayout: (layout: TrackLayout) => void;
  startRun: () => void;
  syncElapsed: () => void;
  reachCheckpoint: (index: number) => void;
  finishRun: () => void;
  recordSpeedTrap: (kmh: number) => void;
  /** Put the car back at the last checkpoint. `fall` counts toward `falls`. */
  respawn: (reason?: RespawnReason) => void;
  /** Full reset to checkpoint 0 with a fresh timer. */
  restart: () => void;
  /** Debug: make checkpoint `index` the current one and put the car there. */
  teleportToCheckpoint: (index: number) => void;

  togglePhysicsPanel: (open?: boolean) => void;
  toggleHelp: (open?: boolean) => void;
  cycleCamera: () => void;
  setCameraMode: (mode: CameraMode) => void;
}

const UPLINK_LIMIT = 40;
const COALESCE_MS = 1000;
let uplinkId = 0;

const bestKey = (trackId: string) => `gamerfleet.best.${trackId}`;

function loadBest(trackId: string): number | null {
  try {
    const raw = window.localStorage.getItem(bestKey(trackId));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveBest(trackId: string, ms: number): void {
  try {
    window.localStorage.setItem(bestKey(trackId), String(Math.round(ms)));
  } catch {
    // Storage blocked (private mode / sandboxed iframe): best time just isn't persisted.
  }
}

function changedKeys(a: CarPhysicsParams, b: CarPhysicsParams): CarPhysicsKey[] {
  return CAR_PHYSICS_KEYS.filter((k) => a[k] !== b[k]);
}

function freshRun(totalCheckpoints: number, bestMs: number | null): RunState {
  return {
    checkpoint: 0,
    totalCheckpoints,
    falls: 0,
    elapsedMs: 0,
    started: false,
    finished: false,
    bestMs,
    speedTrapKmh: null,
  };
}

export const useGameStore = create<GameState>()((set, get) => {
  const commitPhysics = (next: CarPhysicsParams, source: UpdateSource, extra: Partial<GameState> = {}) => {
    const prev = get().physics;
    const keys = changedKeys(prev, next);
    if (keys.length === 0) {
      if (Object.keys(extra).length > 0) set(extra);
      return;
    }
    set({
      ...extra,
      physics: next,
      physicsRevision: get().physicsRevision + 1,
      lastPhysicsChange: { keys, source, at: performance.now() },
    });
  };

  return {
    physics: { ...DEFAULT_CAR_PHYSICS },
    controls: null,
    physicsRevision: 0,
    lastPhysicsChange: null,

    linkStatus: 'disabled',
    serverUrl: '',
    serverUrlSource: 'none',
    dashboards: 0,
    lastUpdateAt: null,
    rttMs: null,
    uplink: [],

    run: freshRun(0, null),
    trackLayout: null,

    ui: { physicsPanelOpen: false, helpOpen: true, cameraMode: 'chase' },

    applySquadControls: (controls, source = 'ws') => {
      const clean = clampSquadControls(controls);
      const extra: Partial<GameState> = { controls: clean };
      if (source === 'ws' || source === 'snapshot') extra.lastUpdateAt = Date.now();
      commitPhysics(mapSquadControlsToPhysics(clean), source, extra);
    },

    patchPhysics: (patch, source = 'ws') => {
      const extra: Partial<GameState> = {};
      if (source === 'ws') extra.lastUpdateAt = Date.now();
      commitPhysics(clampPhysics({ ...get().physics, ...patch }), source, extra);
    },

    resetPhysics: () => {
      const { controls } = get();
      commitPhysics(controls ? mapSquadControlsToPhysics(controls) : { ...DEFAULT_CAR_PHYSICS }, 'local');
    },

    setLinkStatus: (status) => {
      if (get().linkStatus !== status) set({ linkStatus: status });
    },
    setServerUrl: (url, source) => set({ serverUrl: url, serverUrlSource: source }),
    setDashboards: (count) => {
      if (get().dashboards !== count) set({ dashboards: count });
    },
    setRtt: (ms) => set({ rttMs: ms }),

    pushUplink: (kind, text) => {
      const now = Date.now();
      const list = get().uplink;
      const last = list[0];
      const mergeable = last && last.kind === kind && (last.text === text || kind === 'controls' || kind === 'physics');
      if (last && mergeable && now - last.at < COALESCE_MS) {
        set({ uplink: [{ ...last, at: now, text, count: last.count + 1 }, ...list.slice(1)] });
        return;
      }
      set({ uplink: [{ id: ++uplinkId, at: now, kind, text, count: 1 }, ...list].slice(0, UPLINK_LIMIT) });
    },

    setTrackLayout: (layout) => {
      resetRunClock();
      set({ trackLayout: layout, run: freshRun(totalCheckpointsOf(layout), loadBest(layout.id)) });
    },

    startRun: () => {
      const { run } = get();
      if (run.started || run.finished) return;
      runClock.running = true;
      set({ run: { ...run, started: true } });
    },

    syncElapsed: () => {
      const { run } = get();
      const elapsedMs = Math.round(runClock.elapsedMs);
      if (run.elapsedMs !== elapsedMs) set({ run: { ...run, elapsedMs } });
    },

    reachCheckpoint: (index) => {
      const { run } = get();
      if (run.finished || index <= run.checkpoint) return;
      set({ run: { ...run, checkpoint: index, elapsedMs: Math.round(runClock.elapsedMs) } });
      emitGameEvent('checkpoint', { index, elapsedMs: runClock.elapsedMs });
    },

    finishRun: () => {
      const { run, trackLayout } = get();
      if (run.finished) return;
      runClock.running = false;
      const elapsedMs = Math.round(runClock.elapsedMs);
      const isBest = run.bestMs === null || elapsedMs < run.bestMs;
      const bestMs = isBest ? elapsedMs : run.bestMs;
      if (isBest && trackLayout) saveBest(trackLayout.id, elapsedMs);
      set({ run: { ...run, finished: true, started: false, elapsedMs, checkpoint: run.totalCheckpoints, bestMs } });
      emitGameEvent('finish', { elapsedMs, bestMs, isBest });
    },

    recordSpeedTrap: (kmh) => {
      const { run } = get();
      set({ run: { ...run, speedTrapKmh: Math.round(kmh * 10) / 10 } });
    },

    respawn: (reason = 'manual') => {
      const { run, trackLayout } = get();
      const maxIndex = trackLayout ? trackLayout.checkpoints.length - 1 : 0;
      const checkpoint = Math.min(run.checkpoint, Math.max(0, maxIndex));
      if (reason === 'fall') set({ run: { ...run, falls: run.falls + 1 } });
      emitGameEvent('respawn', { checkpoint, reason });
    },

    restart: () => {
      const { run, trackLayout } = get();
      resetRunClock();
      set({ run: freshRun(run.totalCheckpoints, run.bestMs) });
      emitGameEvent('restart', { trackId: trackLayout?.id ?? null });
    },

    teleportToCheckpoint: (index) => {
      const { run, trackLayout } = get();
      if (!trackLayout) return;
      const checkpoint = Math.max(0, Math.min(Math.round(index), trackLayout.checkpoints.length - 1));
      set({ run: { ...run, checkpoint, finished: false } });
      emitGameEvent('respawn', { checkpoint, reason: 'debug' });
    },

    togglePhysicsPanel: (open) =>
      set((s) => ({ ui: { ...s.ui, physicsPanelOpen: open ?? !s.ui.physicsPanelOpen } })),
    toggleHelp: (open) => set((s) => ({ ui: { ...s.ui, helpOpen: open ?? !s.ui.helpOpen } })),
    cycleCamera: () =>
      set((s) => {
        const i = CAMERA_MODES.indexOf(s.ui.cameraMode);
        return { ui: { ...s.ui, cameraMode: CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? 'chase' } };
      }),
    setCameraMode: (mode) => set((s) => ({ ui: { ...s.ui, cameraMode: mode } })),
  };
});

/** Non-hook accessor for physics callbacks and other imperative code. */
export const gameState = (): GameState => useGameStore.getState();
