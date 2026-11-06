/**
 * Module-level state of the mounted open world, shared by WorldRoot, the scene pieces, the
 * colliders, WorldRules and window.__WORLD__. Plain mutable data (no React): written by the piece
 * that owns each field, read by the others and the debug handle. Reset on unmount.
 */
import type { World } from '@dimforge/rapier3d-compat';
import type { RapierContext } from '@react-three/rapier';
import type { WorldData } from './gen/types';

export interface RespawnRecord {
  reason: string;
  /** Simulated time of the respawn, s. */
  t: number;
  from: [number, number, number];
  /** Ground pose the car was placed at (filled by the teleport that follows). */
  to: [number, number, number] | null;
  yaw: number;
  layoutId: string;
  /** Where the resolver took the pose from (null: the layout checkpoint, i.e. races) and its age, s. */
  source: 'safe' | 'nearest-road' | 'spawn' | 'travel' | null;
  ageS: number | null;
}

export type WorldState = 'idle' | 'loading' | 'building' | 'ready' | 'error';

export interface WorldEngine {
  /** The generated island (cached across mounts by loadWorld). */
  data: WorldData | null;
  genWhere: 'worker' | 'main' | null;
  /** Wall time of the generation that produced `data` (worker or main thread), ms. */
  genMs: number;
  state: WorldState;
  /** Fixed body holding every world collider, and its heightfield collider. */
  bodyHandle: number | null;
  heightfieldHandle: number | null;
  /** Colliders created on the world body (heightfield + trimeshes + ramp cuboids). */
  colliders: number;
  /** Debug names of the world colliders by handle ('heightfield', 'ramp:<id>', 'district:<ix>,<iz>'). */
  colliderNames: Map<number, string>;
  /** Terrain chunks drawn last frame, per LOD, and hidden ones. */
  chunks: { lod0: number; lod1: number; lod2: number; hidden: number };
  /** District meshes drawn last frame. */
  districts: { near: number; far: number };
  /** Mean WorldRules cost per physics step (before + after), ms, over the last 600 steps. */
  stepMs: number;
  /** Steps with a chassis–heightfield contact while all 4 wheels were on road surfaces. */
  chassisContacts: number;
  /** Shader link time per island program during the build (ms, one per frame). */
  warmupMs: number[];
  /** What each warmupMs entry was ('tasks', 'texture:<name>', 'program:<name>'). */
  warmupWhat: string[];
  /** Scene parts the build warm-up has revealed (each first draw lands in its own frame). */
  reveal: { terrain: boolean; districts: boolean; water: boolean };
  /** Last respawns (newest last, ≤ 20) for tests: reason, from, to. */
  respawnLog: RespawnRecord[];
  /** The Rapier world while the island is mounted (debug hooks). */
  physics: { world: World; rapier: RapierContext['rapier'] } | null;
  /** Build phase timestamps (performance.now): data in hand, colliders done, programs linked. */
  phases: { data: number; colliders: number; shaders: number };
  /** Mount time (performance.now) and when the layout was first registered after it. */
  mountedAt: number;
  readyAt: number;
}

export const worldEngine: WorldEngine = {
  data: null,
  genWhere: null,
  genMs: 0,
  state: 'idle',
  bodyHandle: null,
  heightfieldHandle: null,
  colliders: 0,
  colliderNames: new Map(),
  chunks: { lod0: 0, lod1: 0, lod2: 0, hidden: 0 },
  districts: { near: 0, far: 0 },
  stepMs: 0,
  chassisContacts: 0,
  warmupMs: [],
  warmupWhat: [],
  reveal: { terrain: false, districts: false, water: false },
  respawnLog: [],
  physics: null,
  phases: { data: 0, colliders: 0, shaders: 0 },
  mountedAt: 0,
  readyAt: 0,
};

export function resetWorldEngine(): void {
  worldEngine.state = 'idle';
  worldEngine.bodyHandle = null;
  worldEngine.heightfieldHandle = null;
  worldEngine.colliders = 0;
  worldEngine.colliderNames = new Map();
  worldEngine.chunks = { lod0: 0, lod1: 0, lod2: 0, hidden: 0 };
  worldEngine.districts = { near: 0, far: 0 };
  worldEngine.stepMs = 0;
  worldEngine.chassisContacts = 0;
  worldEngine.reveal = { terrain: false, districts: false, water: false };
  worldEngine.respawnLog = [];
  worldEngine.physics = null;
  worldEngine.phases = { data: 0, colliders: 0, shaders: 0 };
}
