/**
 * Open-world runtime shared by the world (writer: track/world/**) and the HUD / audio (readers).
 * Off the island everything here is inactive / null, and every reader behaves exactly as before.
 *
 *   - useWorldHud: slow state (changes at human speed) for React: loading, minimap image, route,
 *     markers, region label, event prompt, travel spots, actions.
 *   - worldLive: 60 Hz values written by the world after each physics step. Read from rAF / audio
 *     frames; never replace the object, mutate it in place.
 */
import { create } from 'zustand';

export type SurfaceKind = 'asphalt' | 'cobble' | 'dirt' | 'grass' | 'sand' | 'salt' | 'rock' | 'snow' | 'water';

/** North-up RGBA image of the world: pixel (u, v) covers x = originX + u·mpp, z = originZ + v·mpp. */
export interface MinimapImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  originX: number;
  originZ: number;
  metresPerPixel: number;
}

export interface MapMarker {
  id: string;
  kind: 'event' | 'checkpoint' | 'finish' | 'landmark' | 'travel';
  x: number;
  z: number;
  label: string;
  accent?: string;
  /** kind 'event': the catalog id that starts it. */
  trackId?: string;
}

export interface TravelSpot {
  id: string;
  label: string;
}

export interface WorldActions {
  /** Switch to the world's free-roam entry and keep the car where it is (results FREE ROAM, EXIT TO FREE ROAM). */
  freeRoamHere: () => void;
  /** Free roam only: put the car at a travel spot (RACE tab TRAVEL list). */
  travel: (spotId: string) => void;
}

export interface WorldHudState {
  /** An open world is mounted (also while it loads). */
  active: boolean;
  worldId: string | null;
  /** 0…1 while generating / building, null once drivable. */
  loading: number | null;
  minimap: MinimapImage | null;
  /** Active race route [x0, z0, x1, z1, …] every ~4 m; null in free roam. */
  route: Float32Array | null;
  markers: readonly MapMarker[];
  travelSpots: readonly TravelSpot[];
  /** Region under the car ('' = none), e.g. 'CINNABAR REACH'. */
  regionLabel: string;
  /** Free-roam event start the car is at, or null. */
  prompt: { trackId: string; title: string; detail: string } | null;
  actions: WorldActions | null;
  set: (patch: Partial<Omit<WorldHudState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const INACTIVE = {
  active: false,
  worldId: null,
  loading: null,
  minimap: null,
  route: null,
  markers: [],
  travelSpots: [],
  regionLabel: '',
  prompt: null,
  actions: null,
} satisfies Partial<WorldHudState>;

export const useWorldHud = create<WorldHudState>()((set) => ({
  ...INACTIVE,
  set: (patch) => set(patch),
  reset: () => set(INACTIVE),
}));

/** 60 Hz values (world writes after each physics step; HUD/audio read). Reset by the world on unmount. */
export const worldLive = {
  wheelSurface: [null, null, null, null] as (SurfaceKind | null)[],
  /** Dominant surface under the grounded wheels; null off the island (audio then behaves as today). */
  surface: null as SurfaceKind | null,
  /** Water depth at the car, m (0 = dry). */
  waterDepth: 0,
  /** Race guidance: next gate index (1-based like run.checkpoint + 1; -1 in free roam). */
  nextGate: -1,
  totalGates: 0,
  /** Distance to the next gate along the route, m (NaN in free roam). */
  nextGateM: Number.NaN,
  nextGateX: 0,
  nextGateZ: 0,
  wrongWay: false,
  missedGate: false,
  stuckHint: false,
  /** Car pose for the minimap (copied from carRuntime after each step). */
  x: 0,
  z: 0,
  yaw: 0,
  /** Last landing after > 0.6 s of air; serial increments on each. */
  air: { serial: 0, seconds: 0, metres: 0, rampId: '', best: false },
  /** Saltglass speed trap pass; serial increments on each. */
  trap: { serial: 0, kmh: 0, best: false },
};
