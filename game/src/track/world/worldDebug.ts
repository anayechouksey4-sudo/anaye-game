/**
 * `window.__WORLD__`: the island's scripting / debug surface (PLAN §4.14), installed by WorldRoot
 * while the island is mounted. Autopilots, budget probes and the respawn checks drive it.
 */
import { useWorldHud, worldLive } from '../../state/worldRuntime';
import { carRuntime } from '../../car/runtime';
import { onGameEvent } from '../../game/events';
import { worldEngine, type RespawnRecord } from './engine';
import { heightAt } from './gen/heightAt';
import { REGION_IDS, SURFACE_KINDS, type ProbePose, type TravelSpot as WorldSpot } from './gen/types';
import { TESSERA_HASH } from './golden';
import { cachedWorld, worldGenerations } from './loadWorld';
import { contactCounter } from './physics/WorldRules';
import { eventLayerStats, type EventLayerStats } from './scene/EventLayer';
import { roadSurfaceAt, type RoadIndex } from './physics/roadIndex';
import { pendingTravel, safePoses, type Pose } from './physics/safePose';

export interface WorldInfo {
  seed: number;
  hash: string;
  hashOk: boolean;
  goldenHash: string;
  genMs: number;
  wallMs: number;
  genWhere: 'worker' | 'main' | null;
  generations: number;
  state: string;
  chunks: { lod0: number; lod1: number; lod2: number; hidden: number };
  districts: { near: number; far: number };
  colliders: number;
  heightfieldHandle: number | null;
  stepMs: number;
  /** Mount → first layout registration, ms (0 until ready). */
  readyMs: number;
  /** Texture upload / shader link time per frame of the build warm-up, ms. */
  warmupMs: number[];
  warmupWhat: string[];
  /** Mount → data in hand / colliders built / programs linked, ms. */
  phases: { data: number; colliders: number; shaders: number };
  bytes: number;
  /** Upper-bound island GPU memory, MB (buffers + textures with mips). */
  gpuMB: { terrain: number; districts: number; events: number; textures: number; total: number };
}

export interface WorldDebugHandle {
  info(): WorldInfo;
  route(id: string): { points: [number, number, number][]; speeds: number[]; lengthM: number; gates: number[] } | null;
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): string;
  regionAt(x: number, z: number): string;
  events(): { id: string; name: string; mode: string; spawn: { position: number[]; yaw: number }; checkpoints: { position: number[]; yaw: number; size: number[] }[]; finish: { position: number[]; yaw: number; size: number[] }; lengthM: number }[];
  spots(): WorldSpot[];
  safePoses(): Pose[];
  pending(): Pose | null;
  validate(): Promise<{ errors: number; warnings: number; first: string[]; ms: number }>;
  probes(): ProbePose[];
  /** Mounted event layer: arches, chevron boards, holo arrows, pads, signs, voxel boxes, glow quads. */
  eventLayer(): EventLayerStats | null;
  /** Signs: id, text, kind, ramp, position, yaw. */
  signs(): { id: string; text: string; kind: string; rampId: string | null; position: number[]; yaw: number }[];
  /** Route indices of an event's junction turn-offs and tight-bend ranges. */
  guidance(id: string): { turnOffs: number[]; tightBends: [number, number][] } | null;
  /** Per wheel: contact point, the contact normal the vehicle saw, and the terrain under it (heightAt + its triangle normal). */
  wheelContacts(): { inContact: boolean; p: number[]; n: number[]; terrainY: number; terrainN: number[] }[];
  /** World colliders the car's chassis is touching right now (debug names, contact counts). */
  touching(): { name: string; contacts: number; depth: number }[];
  /** Chassis–heightfield contact steps while 4 wheels are on road (the first call enables counting). */
  chassisContacts(): number;
  resetChassisContacts(): void;
  actions(): { freeRoamHere(): void; travel(id: string): void } | null;
  /** Copy of worldLive (what the HUD / audio read after each step). */
  live(): typeof worldLive;
  /** HUD-facing slow state: region label, prompt, markers / route sizes. */
  hud(): { regionLabel: string; prompt: { trackId: string; title: string; detail: string } | null; markers: number; routePoints: number; loading: number | null };
  /** Last respawns (≤ 20, newest last): reason, the car's position before, the ground pose after. */
  respawns(): RespawnRecord[];
  /** Test hook: turn the car upside down where it is (the flip rule should respawn it). */
  debugFlip(): boolean;
  /** Test hook: a 1 × 1 m pillar `height` m tall at (x, z) on the world body (removed on the next respawn / restart). */
  debugPillar(x: number, z: number, height: number): number | null;
}

declare global {
  interface Window {
    __WORLD__?: WorldDebugHandle;
  }
}

export function installWorldDebug(roads: RoadIndex): () => void {
  const data = () => {
    const w = worldEngine.data;
    if (!w) throw new Error('Tessera Isle is not loaded');
    return w;
  };
  const handle: WorldDebugHandle = {
    info: () => {
      const loaded = cachedWorld();
      const w = worldEngine.data;
      return {
        seed: w?.seed ?? 0,
        hash: w?.hash ?? '',
        hashOk: w?.hash === TESSERA_HASH,
        goldenHash: TESSERA_HASH,
        genMs: Math.round((loaded?.genMs ?? 0) * 10) / 10,
        wallMs: Math.round((loaded?.wallMs ?? 0) * 10) / 10,
        genWhere: loaded?.where ?? null,
        generations: worldGenerations(),
        state: worldEngine.state,
        chunks: { ...worldEngine.chunks },
        districts: { ...worldEngine.districts },
        colliders: worldEngine.colliders,
        heightfieldHandle: worldEngine.heightfieldHandle,
        stepMs: Math.round(worldEngine.stepMs * 10000) / 10000,
        readyMs: worldEngine.readyAt > 0 ? Math.round(worldEngine.readyAt - worldEngine.mountedAt) : 0,
        warmupMs: [...worldEngine.warmupMs],
        warmupWhat: [...worldEngine.warmupWhat],
        phases: {
          data: worldEngine.phases.data ? Math.round(worldEngine.phases.data - worldEngine.mountedAt) : 0,
          colliders: worldEngine.phases.colliders ? Math.round(worldEngine.phases.colliders - worldEngine.mountedAt) : 0,
          shaders: worldEngine.phases.shaders ? Math.round(worldEngine.phases.shaders - worldEngine.mountedAt) : 0,
        },
        bytes: w?.stats.bytes ?? 0,
        gpuMB: (() => {
          const g = worldEngine.gpu;
          const mb = (b: number) => Math.round((b / 1048576) * 100) / 100;
          return { terrain: mb(g.terrain), districts: mb(g.districts), events: mb(g.events), textures: mb(g.textures), total: mb(g.terrain + g.districts + g.events + g.textures) };
        })(),
      };
    },
    route: (id) => {
      const e = data().events.find((ev) => ev.id === id);
      if (!e) return null;
      const points: [number, number, number][] = [];
      for (let i = 0; i < e.route.length; i += 3) points.push([e.route[i]!, e.route[i + 1]!, e.route[i + 2]!]);
      return { points, speeds: Array.from(e.speeds), lengthM: e.lengthM, gates: [...e.gates] };
    },
    heightAt: (x, z) => heightAt(data().heights, x, z),
    surfaceAt: (x, z) => {
      const road = roadSurfaceAt(roads, x, z);
      if (road >= 0) return SURFACE_KINDS[road] ?? 'asphalt';
      const cx = Math.max(0, Math.min(511, Math.floor((x + 1024) / 4)));
      const cz = Math.max(0, Math.min(511, Math.floor((z + 1024) / 4)));
      return SURFACE_KINDS[data().surface[cz * 512 + cx]!] ?? 'grass';
    },
    regionAt: (x, z) => {
      const rx = Math.max(0, Math.min(127, Math.floor((x + 1024) / 16)));
      const rz = Math.max(0, Math.min(127, Math.floor((z + 1024) / 16)));
      return REGION_IDS[data().region[rz * 128 + rx]!] ?? 'sea';
    },
    events: () =>
      data().events.map((e) => ({
        id: e.id,
        name: e.name,
        mode: e.mode,
        spawn: { position: [...e.spawn.position], yaw: e.spawn.yaw },
        checkpoints: e.checkpoints.map((c) => ({ position: [...c.position], yaw: c.yaw, size: [...c.size] })),
        finish: { position: [...e.finish.position], yaw: e.finish.yaw, size: [...e.finish.size] },
        lengthM: e.lengthM,
      })),
    spots: () => data().spots.map((s) => ({ ...s, position: [...s.position] as WorldSpot['position'] })),
    safePoses: () => safePoses(),
    pending: () => pendingTravel(),
    validate: async () => {
      const [{ buildWorld }, { validateWorld }] = await Promise.all([import('./gen/generateWorld'), import('./gen/validate')]);
      const { world, internals } = buildWorld(data().seed);
      const report = validateWorld(world, internals);
      return {
        errors: report.errors.length,
        warnings: report.warnings.length,
        first: report.errors.slice(0, 8).map((e) => `${e.rule} ${e.where}: ${e.detail}`),
        ms: Math.round(report.ms),
      };
    },
    probes: () => data().probes.map((p) => ({ ...p, position: [...p.position] as ProbePose['position'] })),
    eventLayer: () => (eventLayerStats.current ? { ...eventLayerStats.current } : null),
    signs: () => data().signs.map((s) => ({ id: s.id, text: s.text, kind: s.kind, rampId: s.rampId, position: [...s.position], yaw: s.yaw })),
    guidance: (id) => {
      const e = data().events.find((ev) => ev.id === id);
      return e ? { turnOffs: [...e.turnOffs], tightBends: e.tightBends.map((b) => [b[0], b[1]] as [number, number]) } : null;
    },
    wheelContacts: () =>
      carRuntime.wheels.map((w) => {
        const p = w.contactPointWorld;
        const h = data().heights;
        const e = 0.05;
        const y0 = heightAt(h, p.x, p.z);
        const dx = (heightAt(h, p.x + e, p.z) - heightAt(h, p.x - e, p.z)) / (2 * e);
        const dz = (heightAt(h, p.x, p.z + e) - heightAt(h, p.x, p.z - e)) / (2 * e);
        const l = Math.hypot(dx, 1, dz);
        const r = (v: number) => Math.round(v * 10000) / 10000;
        return { inContact: w.inContact, p: [r(p.x), r(p.y), r(p.z)], n: [r(w.contactNormalWorld.x), r(w.contactNormalWorld.y), r(w.contactNormalWorld.z)], terrainY: r(y0), terrainN: [r(-dx / l), r(1 / l), r(-dz / l)] };
      }),
    touching: () => {
      const ph = worldEngine.physics;
      const ch = carRuntime.chassisColliderHandle;
      if (!ph || ch === null) return [];
      const chassis = ph.world.getCollider(ch);
      if (!chassis) return [];
      const out: { name: string; contacts: number; depth: number }[] = [];
      ph.world.contactPairsWith(chassis, (other) => {
        let contacts = 0;
        let depth = 0;
        ph.world.contactPair(chassis, other, (m) => {
          contacts += m.numContacts();
          for (let i = 0; i < m.numContacts(); i++) depth = Math.min(depth, m.contactDist(i));
        });
        if (contacts > 0) out.push({ name: worldEngine.colliderNames.get(other.handle) ?? `collider:${other.handle}`, contacts, depth: Math.round(depth * 1000) / 1000 });
      });
      return out;
    },
    chassisContacts: () => {
      contactCounter.enabled = true;
      return worldEngine.chassisContacts;
    },
    resetChassisContacts: () => {
      contactCounter.enabled = true;
      worldEngine.chassisContacts = 0;
    },
    actions: () => useWorldHud.getState().actions,
    live: () => ({ ...worldLive, wheelSurface: [...worldLive.wheelSurface], air: { ...worldLive.air }, trap: { ...worldLive.trap } }),
    hud: () => {
      const h = useWorldHud.getState();
      return { regionLabel: h.regionLabel, prompt: h.prompt, markers: h.markers.length, routePoints: h.route ? h.route.length / 2 : 0, loading: h.loading };
    },
    respawns: () => worldEngine.respawnLog.map((r) => ({ ...r, from: [...r.from] as RespawnRecord['from'], to: r.to ? ([...r.to] as RespawnRecord['from']) : null })),
    debugFlip: () => {
      const ph = worldEngine.physics;
      if (!ph || carRuntime.bodyHandle === null) return false;
      const body = ph.world.getRigidBody(carRuntime.bodyHandle);
      if (!body) return false;
      // half turn about the car's forward axis
      const f = carRuntime.forward;
      const q = carRuntime.quaternion;
      const fq = { x: f.x, y: f.y, z: f.z, w: 0 }; // 180° about f: (f, 0)
      const r = {
        w: fq.w * q.w - fq.x * q.x - fq.y * q.y - fq.z * q.z,
        x: fq.w * q.x + fq.x * q.w + fq.y * q.z - fq.z * q.y,
        y: fq.w * q.y - fq.x * q.z + fq.y * q.w + fq.z * q.x,
        z: fq.w * q.z + fq.x * q.y - fq.y * q.x + fq.z * q.w,
      };
      const p = body.translation();
      body.setTranslation({ x: p.x, y: p.y + 1.5, z: p.z }, true);
      body.setRotation(r, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return true;
    },
    debugPillar: (x, z, height) => {
      const ph = worldEngine.physics;
      if (!ph || worldEngine.bodyHandle === null) return null;
      const body = ph.world.getRigidBody(worldEngine.bodyHandle);
      if (!body) return null;
      const g = heightAt(data().heights, x, z);
      const c = ph.world.createCollider(ph.rapier.ColliderDesc.cuboid(0.5, height / 2, 0.5).setTranslation(x, g + height / 2, z), body);
      pillars.push(c.handle);
      return c.handle;
    },
  };
  const pillars: number[] = [];
  const dropPillars = () => {
    const ph = worldEngine.physics;
    for (const h of pillars.splice(0)) {
      const c = ph?.world.getCollider(h);
      if (ph && c) ph.world.removeCollider(c, true);
    }
  };
  const offs = [onGameEvent('respawn', dropPillars), onGameEvent('restart', dropPillars)];
  window.__WORLD__ = handle;
  return () => {
    dropPillars();
    offs.forEach((off) => off());
    if (window.__WORLD__ === handle) delete window.__WORLD__;
  };
}
