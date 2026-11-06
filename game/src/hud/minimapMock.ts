/**
 * DEV-ONLY test stubs for the open-world shell (HUD.tsx loads this module behind
 * `import.meta.env.DEV`, so production builds never contain it). Each stub is off unless its query
 * parameter is present. The two layout stubs only touch the `test` map (Proving Ground); the
 * minimap mock works on any map (its picture and route are always the `test` straight):
 *
 *   ?roamstub=1    re-registers the `test` layout as free roam (`mode: 'roam'`) and installs a test
 *                  respawn resolver that sends every ⟲ / travel to ROAM_STUB_POSE (logged).
 *   ?strictstub=1  re-registers it as a strict-order race: checkpoints at z 300 and z 600, finish at
 *                  z 150 (behind the first checkpoint, so only order decides when it counts).
 *   ?minimap=mock  fills `useWorldHud` / `worldLive` as an open world would: a painted minimap of the
 *                  straight, the route (race) or event flags (roam), a region label, travel spots,
 *                  actions that only log, and the car pose / next gate every frame.
 *   ?islandstub=1  (implies the minimap mock) the five island catalog ids render the `test` straight
 *                  under island layouts with their own ids: `tessera` is free roam, the races are
 *                  strict-order (gates at z 600 / 1200, finish 1800). FREE ROAM really switches to
 *                  `tessera`. For the MAPS island card, RACE tab and results tests before the world lands.
 *
 * `window.__WORLDMOCK__` drives the rest from tests or the console (prompt, loading, banner flags,
 * surface, resolver log). Nothing here runs without one of the parameters.
 */
import { createElement, Fragment, useLayoutEffect, type ComponentType } from 'react';
import { getQueryParam } from '../config';
import { carRuntime } from '../car/runtime';
import { selectionState, useSelection } from '../state/selection';
import { gameState, useGameStore } from '../state/store';
import { useWorldHud, worldLive, type MapMarker, type MinimapImage, type SurfaceKind, type WorldHudState } from '../state/worldRuntime';
import { TRACK_CATALOG } from '../track/catalog';
import { TRACKS } from '../track/registry';
import { setRespawnResolver } from '../track/respawn';
import { TEST_TRACK_LAYOUT, TestTrack } from '../track/test/TestTrack';
import type { TrackLayout, Vec3 } from '../track/types';

/** Where the roam stub's resolver puts the car (beside the spawn lane, past the first stripe block). */
export const ROAM_STUB_POSE: { position: Vec3; yaw: number } = { position: [6, 0, 250], yaw: 0 };

const STUB_GATE: Vec3 = [30, 9, 4];

const ROAM_LAYOUT: TrackLayout = { ...TEST_TRACK_LAYOUT, mode: 'roam' };

const STRICT_LAYOUT: TrackLayout = {
  ...TEST_TRACK_LAYOUT,
  strictOrder: true,
  checkpoints: [
    { index: 0, position: [0, 0, 0], yaw: 0, size: STUB_GATE },
    { index: 1, position: [0, 0, 300], yaw: 0, size: STUB_GATE },
    { index: 2, position: [0, 0, 600], yaw: 0, size: STUB_GATE },
  ],
  finish: { position: [0, 0, 150], yaw: 0, size: STUB_GATE },
};

/** Island stub: one layout per island catalog id (stable objects), on the test straight. */
const ISLAND_IDS = TRACK_CATALOG.filter((t) => t.world === 'tessera').map((t) => t.id);
const islandLayouts = new Map<string, TrackLayout>(
  TRACK_CATALOG.filter((t) => t.world === 'tessera').map((t) => [
    t.id,
    t.mode === 'roam' ? { ...TEST_TRACK_LAYOUT, id: t.id, name: t.name, mode: 'roam' } : { ...TEST_TRACK_LAYOUT, id: t.id, name: t.name, strictOrder: true },
  ]),
);

/** Re-registers the selected island id's layout over the test straight's own (sibling layout effect runs after TestTrack's). */
function IslandStubLayout({ id }: { id: string }) {
  useLayoutEffect(() => {
    const layout = islandLayouts.get(id);
    if (layout) gameState().setTrackLayout(layout);
  }, [id]);
  return null;
}

/** Mounted for every island id (one component, so switching between entries keeps it, like OpenWorld). */
function IslandStub() {
  const id = useSelection((s) => s.trackId);
  return createElement(Fragment, null, createElement(TestTrack), createElement(IslandStubLayout, { id }));
}

interface ResolverCall {
  checkpoint: number;
  reason: string;
  stepCount: number;
}

export interface WorldMockHandle {
  /** Which stubs are on. */
  flags(): { roam: boolean; strict: boolean; minimap: boolean; island: boolean };
  /** Respawns the roam stub's resolver answered (oldest first, last 32). */
  resolverCalls(): ResolverCall[];
  /** The roam stub's respawn pose. */
  roamPose(): { position: Vec3; yaw: number };
  /** Show / hide the free-roam event prompt. */
  prompt(on: boolean): void;
  /** Loading fraction 0…1, or null (drivable). */
  loading(value: number | null): void;
  region(label: string): void;
  /** Banner flags on worldLive (wrongWay, missedGate, stuckHint). */
  live(patch: Partial<Pick<typeof worldLive, 'wrongWay' | 'missedGate' | 'stuckHint' | 'waterDepth'>>): void;
  /** worldLive.surface (null = off the island: audio behaves as today). */
  surface(kind: SurfaceKind | null): void;
  /** Bump worldLive.air / trap serials (banner triggers). */
  air(seconds: number, metres: number, best?: boolean): void;
  trap(kmh: number, best?: boolean): void;
  /** Actions the HUD called (freeRoamHere / travel), oldest first. */
  actionLog(): string[];
  /** Snapshot of the faked state. */
  state(): { hud: Omit<WorldHudState, 'set' | 'reset' | 'minimap' | 'route'> & { minimap: boolean; route: number }; live: typeof worldLive };
}

declare global {
  interface Window {
    __WORLDMOCK__?: WorldMockHandle;
  }
}

const isOn = (name: string): boolean => {
  const v = getQueryParam(name)?.toLowerCase();
  return v !== undefined && v !== null && !['0', 'off', 'false', 'no'].includes(v);
};

let installed = false;

/** Install the stubs selected by the query string (idempotent; no-op without parameters). */
export function installDevStubs(): void {
  if (installed || !import.meta.env.DEV) return;
  installed = true;
  const island = isOn('islandstub');
  const roam = !island && isOn('roamstub');
  const strict = !island && !roam && isOn('strictstub');
  const minimap = island || getQueryParam('minimap')?.toLowerCase() === 'mock';
  if (!roam && !strict && !minimap) return;

  if (island) {
    const tracks = TRACKS as Record<string, ComponentType>;
    for (const id of ISLAND_IDS) tracks[id] = IslandStub;
    // Loaded straight onto an island id: remount the map so the stub replaces the world shell.
    const current = selectionState().trackId;
    if (ISLAND_IDS.includes(current)) {
      useSelection.setState({ trackId: 'test' });
      setTimeout(() => useSelection.setState({ trackId: current }), 50);
    }
  }

  const calls: ResolverCall[] = [];
  const actions: string[] = [];
  const stub = roam ? ROAM_LAYOUT : strict ? STRICT_LAYOUT : null;

  // ── Layout stubs: swap the registered `test` layout for the stub copy (same id, so the car stays). ──
  let uninstallResolver: (() => void) | null = null;
  const syncLayout = () => {
    const layout = gameState().trackLayout;
    if (stub && layout === TEST_TRACK_LAYOUT) {
      // Deferred out of the store's notification; still before the next frame (no physics step between).
      queueMicrotask(() => {
        if (gameState().trackLayout === TEST_TRACK_LAYOUT) gameState().setTrackLayout(stub);
      });
    }
    const wantResolver = roam && layout === ROAM_LAYOUT;
    if (wantResolver && !uninstallResolver) {
      uninstallResolver = setRespawnResolver((checkpoint, reason) => {
        calls.push({ checkpoint, reason, stepCount: carRuntime.stepCount });
        if (calls.length > 32) calls.shift();
        return { position: [...ROAM_STUB_POSE.position], yaw: ROAM_STUB_POSE.yaw };
      });
    } else if (!wantResolver && uninstallResolver) {
      uninstallResolver();
      uninstallResolver = null;
    }
  };
  if (stub) {
    useGameStore.subscribe((s, prev) => {
      if (s.trackLayout !== prev.trackLayout) syncLayout();
    });
    syncLayout();
  }

  // ── Minimap mock: fake what an open world writes. ──
  if (minimap) installMinimapMock(actions, island);

  window.__WORLDMOCK__ = {
    flags: () => ({ roam, strict, minimap, island }),
    resolverCalls: () => calls.slice(),
    roamPose: () => ({ position: [...ROAM_STUB_POSE.position], yaw: ROAM_STUB_POSE.yaw }),
    prompt: (on) =>
      useWorldHud.getState().set({
        prompt: on
          ? island
            ? { trackId: 'tessera-rim', title: 'RIMWAY LOOP', detail: '' }
            : { trackId: 'test', title: 'PROVING GROUND', detail: '1.9 KM · BEST --:--' }
          : null,
      }),
    loading: (value) => useWorldHud.getState().set({ loading: value }),
    region: (label) => useWorldHud.getState().set({ regionLabel: label }),
    live: (patch) => {
      Object.assign(worldLive, patch);
    },
    surface: (kind) => {
      worldLive.surface = kind;
      worldLive.wheelSurface.fill(kind);
    },
    air: (seconds, metres, best = false) => {
      worldLive.air.serial += 1;
      worldLive.air.seconds = seconds;
      worldLive.air.metres = metres;
      worldLive.air.rampId = '';
      worldLive.air.best = best;
    },
    trap: (kmh, best = false) => {
      worldLive.trap.serial += 1;
      worldLive.trap.kmh = kmh;
      worldLive.trap.best = best;
    },
    actionLog: () => actions.slice(),
    state: () => {
      const { set: _set, reset: _reset, minimap: image, route, ...rest } = useWorldHud.getState();
      return { hud: { ...rest, minimap: image !== null, route: route ? route.length / 2 : 0 }, live: worldLive };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

const MPP = 4;
const SIZE = 512;
/** North-up: v grows toward +z. The straight (x ±15, z −50…1850) runs down the middle. */
const ORIGIN_X = -1024;
const ORIGIN_Z = -124;

function paintMinimap(): MinimapImage {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let v = 0; v < SIZE; v++) {
    const z = ORIGIN_Z + (v + 0.5) * MPP;
    for (let u = 0; u < SIZE; u++) {
      const x = ORIGIN_X + (u + 0.5) * MPP;
      // A long island around the straight, with a wobbly coast so rotation is visible.
      const coast = 260 + 70 * Math.sin(z / 140) + 40 * Math.cos(z / 57);
      const land = Math.abs(x) < coast && z > -100 && z < 1900;
      let r = 18;
      let g = 52;
      let b = 92;
      if (land) {
        const beach = coast - Math.abs(x) < 24;
        [r, g, b] = beach ? [214, 196, 140] : (Math.floor(x / 64) + Math.floor(z / 64)) & 1 ? [92, 150, 84] : [80, 138, 74];
        if (Math.abs(x) <= 15) [r, g, b] = [52, 56, 66];
        if (Math.abs(x) <= 1.5 && Math.floor(z / 8) % 2 === 0) [r, g, b] = [230, 230, 220];
        if (Math.abs(x - 140) < 8 && z > 100 && z < 1500) [r, g, b] = [150, 112, 70];
      }
      const i = (v * SIZE + u) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data, originX: ORIGIN_X, originZ: ORIGIN_Z, metresPerPixel: MPP };
}

function installMinimapMock(actions: string[], island: boolean): void {
  const image = paintMinimap();
  const route = new Float32Array(Array.from({ length: 476 }, (_, k) => [0, -50 + k * 4]).flat());
  const roamMarkers: MapMarker[] = island
    ? [
        ...TRACK_CATALOG.filter((t) => t.world === 'tessera' && t.mode !== 'roam').map((t, i) => ({
          id: `pad-${t.id}`,
          kind: 'event' as const,
          x: i % 2 === 0 ? 0 : 140,
          z: 40 + i * 380,
          label: t.name.toUpperCase(),
          accent: t.accent,
          trackId: t.id,
        })),
        { id: 'lm-tower', kind: 'landmark', x: -120, z: 600, label: 'TOWER' },
      ]
    : [
        { id: 'pad-test', kind: 'event', x: 0, z: 40, label: 'PROVING GROUND', accent: '#25e7f2', trackId: 'test' },
        { id: 'pad-far', kind: 'event', x: 140, z: 900, label: 'DIRT TRAIL', accent: '#ff6a3d', trackId: 'test' },
        { id: 'lm-tower', kind: 'landmark', x: -120, z: 600, label: 'TOWER' },
      ];
  const raceMarkers = (layout: TrackLayout): MapMarker[] => [
    ...layout.checkpoints.slice(1).map((cp) => ({ id: `cp${cp.index}`, kind: 'checkpoint' as const, x: cp.position[0], z: cp.position[2], label: `CP ${cp.index}` })),
    { id: 'finish', kind: 'finish', x: layout.finish.position[0], z: layout.finish.position[2], label: 'FINISH' },
  ];

  const applyLayout = (layout: TrackLayout | null) => {
    const isRoam = layout?.mode === 'roam';
    useWorldHud.getState().set({
      active: true,
      worldId: island ? 'tessera' : 'mock',
      loading: null,
      minimap: image,
      route: layout && !isRoam ? route : null,
      markers: layout ? (isRoam ? roamMarkers : raceMarkers(layout)) : [],
      travelSpots: [
        { id: 'spawn', label: 'Spawn' },
        { id: 'far-end', label: 'Far end' },
        { id: 'kicker', label: 'Kicker' },
      ],
      regionLabel: isRoam ? (island ? 'PRISM CITY' : 'PROVING GROUND') : '',
      actions: {
        freeRoamHere: () => {
          actions.push('freeRoamHere');
          if (island) selectionState().setTrack('tessera');
        },
        travel: (spotId) => actions.push(`travel:${spotId}`),
      },
    });
  };
  applyLayout(gameState().trackLayout);
  useGameStore.subscribe((s, prev) => {
    if (s.trackLayout !== prev.trackLayout) applyLayout(s.trackLayout);
  });

  // Per-frame pose + next gate, as WorldRules would write after each step (no allocation).
  const frame = () => {
    const s = gameState();
    const layout = s.trackLayout;
    worldLive.x = carRuntime.position.x;
    worldLive.z = carRuntime.position.z;
    worldLive.yaw = Math.atan2(carRuntime.forward.x, carRuntime.forward.z);
    if (layout && layout.mode !== 'roam' && !s.run.finished) {
      const nextIndex = s.run.checkpoint + 1;
      const gate = layout.checkpoints[nextIndex]?.position ?? layout.finish.position;
      worldLive.nextGate = nextIndex;
      worldLive.totalGates = layout.checkpoints.length;
      worldLive.nextGateX = gate[0];
      worldLive.nextGateZ = gate[2];
      worldLive.nextGateM = Math.abs(gate[2] - worldLive.z);
    } else {
      worldLive.nextGate = -1;
      worldLive.totalGates = 0;
      worldLive.nextGateM = Number.NaN;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
