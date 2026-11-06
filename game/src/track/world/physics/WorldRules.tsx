/**
 * Island rules, evaluated around every physics step (PLAN §4.9, §3.10):
 *   before: off-road rolling drag C·k·m·g per grounded wheel + shallow-water drag, one impulse;
 *   after:  wheel surfaces → per-wheel grip (applied on the next step) and worldLive; water,
 *           out-of-bounds and stuck respawns; the safe-pose ring; race guidance (next gate,
 *           distance, WRONG WAY, MISSED CHECKPOINT); region label; event-pad prompt; air and
 *           speed-trap records; pending travel.
 * Installs the wheel-grip, respawn and camera-floor resolvers while mounted. No allocation on the
 * per-step paths (scratch objects live in module scope).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useAfterPhysicsStep, useBeforePhysicsStep } from '@react-three/rapier';
import type { TempContactManifold, World } from '@dimforge/rapier3d-compat';
import { GRAVITY } from '@shared/protocol';
import { setCameraFloorResolver } from '../../../camera/cameraFloor';
import { resolveCarId } from '../../../car/catalog';
import { carRuntime } from '../../../car/runtime';
import { setChassisInertiaResolver, setWheelGripResolver } from '../../../car/surfaceGrip';
import { PHYSICS_DT } from '../../../config';
import { emitGameEvent, onGameEvent } from '../../../game/events';
import { selectionState, useSelection } from '../../../state/selection';
import { gameState } from '../../../state/store';
import { useWorldHud, worldLive, type SurfaceKind } from '../../../state/worldRuntime';
import { setRespawnResolver } from '../../respawn';
import { heightAt } from '../gen/heightAt';
import { OFFROAD_K, SURFACE_TABLE, WATER_DRAG_PER_M, effectiveGrip } from '../gen/surfaces';
import { rimAt } from '../gen/tessera';
import { waterLevelAt } from '../gen/textures';
import { REGION_IDS, REGION_LABELS, SURF, SURFACE_KINDS, rampDistance, type WorldData, type WorldEvent } from '../gen/types';
import { ROAM_ID } from '../gen/tessera';
import { worldEngine, type RespawnRecord } from '../engine';
import { recordAir, recordTrap } from './records';
import { stableRollInertia } from './rollStability';
import { hit, nearestRoad, roadSurfaceAt, type RoadIndex } from './roadIndex';
import { clearSafePoses, newestSafePose, pushSafePose, takePendingTravel, takeSafePose, setPendingTravel, pendingTravel, type Pose } from './safePose';

const DT = PHYSICS_DT;
const WATER_RESPAWN_DEPTH = 1.1;
const WATER_RESPAWN_S = 0.5;
const BOUNDS = 1000;
const STUCK_HINT_S = 4;
const STUCK_AUTO_S = 3;
const SAFE_EVERY = 30;
const REGION_EVERY = 15;
const PAD_EVERY = 6;
const PAD_RADIUS = 14;
const PAD_MAX_KMH = 40;
const AIR_MIN_S = 0.6;
/** A take-off within this distance of a ramp's footprint counts as off that ramp (the nearest one). */
const AIR_RAMP_FOOT_M = 6;
const TRAP_HALF_WIDTH = 12;
const WRONG_WAY_S = 3;
const WRONG_WAY_KMH = 30;
const MISSED_M = 60;
const PROGRESS_WINDOW = 40;
const SETTLE_STEPS = 3;

export interface PendingTravel {
  pose: Pose;
  /** Fire only once this layout is registered … */
  layoutId: string;
  /** … and (when set) once the car mounted with this body has been replaced. */
  replacedBody: number | null;
}

let pending: PendingTravel | null = null;

/** Queue a travel respawn (TRAVEL, FREE ROAM, car swap). */
export function queueTravel(pose: Pose, layoutId: string, replacedBody: number | null): void {
  pending = { pose, layoutId, replacedBody };
  setPendingTravel(pose);
}

export function clearPendingTravel(): void {
  pending = null;
  setPendingTravel(null);
}

/** Ground point under the car (wheel contacts when grounded, else the terrain). */
export function currentGroundPose(heights: Float32Array): Pose {
  const p = carRuntime.position;
  let y = 0;
  let n = 0;
  for (const w of carRuntime.wheels) {
    if (!w.inContact) continue;
    y += w.contactPointWorld.y;
    n++;
  }
  const ground = n > 0 ? y / n : heightAt(heights, p.x, p.z);
  const yaw = Math.atan2(carRuntime.forward.x, carRuntime.forward.z);
  return { x: p.x, y: Math.max(ground, heightAt(heights, p.x, p.z)), z: p.z, yaw, t: carRuntime.simTime };
}

const impulse = { x: 0, y: 0, z: 0 };
const SURF_NAME: readonly SurfaceKind[] = SURFACE_KINDS;
const REGION_TEXT: readonly string[] = REGION_IDS.map((id) => (id === 'sea' ? '' : REGION_LABELS[id].name.toUpperCase()));

interface RulesState {
  skip: number;
  waterT: number;
  stuckT: number;
  beachedT: number;
  safeCount: number;
  regionCount: number;
  padCount: number;
  region: number;
  promptPad: number;
  airT: number;
  airX: number;
  airZ: number;
  airRamp: string;
  trapAlong: number;
  progress: number;
  progressValid: boolean;
  prevGateM: number;
  /** +1 while the distance to the next gate grows, -1 while it shrinks. */
  trend: number;
  wrongT: number;
  carK: string;
  grip: Float32Array;
  drag: Float32Array;
  wheelSurf: Int8Array;
  waterDepth: number;
  waterLevel: number;
  stepAcc: number;
  stepN: number;
  contacts: boolean;
  /** Body handle of the car last seen (a new one = a freshly mounted car). */
  seenBody: number | null;
}

function newState(): RulesState {
  return {
    skip: SETTLE_STEPS,
    waterT: 0,
    stuckT: 0,
    beachedT: 0,
    safeCount: 0,
    regionCount: 0,
    padCount: 0,
    region: -1,
    promptPad: -1,
    airT: 0,
    airX: 0,
    airZ: 0,
    airRamp: '',
    trapAlong: Number.NaN,
    progress: 0,
    progressValid: false,
    prevGateM: Number.NaN,
    trend: 0,
    wrongT: 0,
    carK: '',
    grip: new Float32Array(SURFACE_KINDS.length).fill(1),
    drag: new Float32Array(SURFACE_KINDS.length),
    wheelSurf: new Int8Array(4).fill(-1),
    waterDepth: 0,
    waterLevel: 0,
    stepAcc: 0,
    stepN: 0,
    contacts: false,
    seenBody: null,
  };
}

/** Grip / drag per surface id for the mounted car class (recomputed when the car changes). */
function refreshCar(S: RulesState): void {
  if (S.carK === carRuntime.carId) return;
  S.carK = carRuntime.carId;
  const k = OFFROAD_K[carRuntime.carId] ?? 1;
  SURFACE_KINDS.forEach((s, i) => {
    S.grip[i] = effectiveGrip(s, k);
    S.drag[i] = SURFACE_TABLE[s].drag * k;
  });
}

const wheelGripNow = new Float32Array([1, 1, 1, 1]);
/** What the respawn resolver picked last (copied into the respawn log on the teleport that follows). */
const lastPick: { source: RespawnRecord['source']; ageS: number | null } = { source: null, ageS: null };

/** Enable the (allocating) chassis–heightfield contact counter; __WORLD__.chassisContacts() turns it on. */
export const contactCounter = { enabled: false };

function cumulative(route: Float32Array): Float32Array {
  const n = route.length / 3;
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = route[i * 3]! - route[i * 3 - 3]!;
    const dz = route[i * 3 + 2]! - route[i * 3 - 1]!;
    out[i] = out[i - 1]! + Math.hypot(dx, dz);
  }
  return out;
}

export function WorldRules({ data, roads, entryId }: { data: WorldData; roads: RoadIndex; entryId: string }) {
  const S = useMemo(newState, []);
  const event = useMemo<WorldEvent | null>(() => data.events.find((e) => e.id === entryId) ?? null, [data, entryId]);
  const race = event && event.mode === 'race' ? event : null;
  const cum = useMemo(() => (race ? cumulative(race.route) : null), [race]);
  const ctx = useRef({ race, cum });
  ctx.current = { race, cum };

  const pads = useMemo(
    () =>
      data.pads.map((p) => {
        const ev = data.events.find((e) => e.id === p.eventId);
        const name = (ev?.name ?? p.eventId).toUpperCase();
        return { pad: p, prompt: { trackId: p.eventId, title: name, detail: `${((ev?.lengthM ?? 0) / 1000).toFixed(1)} KM` } };
      }),
    [data],
  );
  const trap = useMemo(() => {
    const [tx, tz] = rimAt(33);
    nearestRoad(roads, tx, tz, 40);
    const yaw = Math.atan2(hit.tx, hit.tz);
    return { x: hit.x, y: hit.y, z: hit.z, s: Math.sin(yaw), c: Math.cos(yaw) };
  }, [roads]);

  // Resolvers.
  useEffect(() => {
    const heights = data.heights;
    const offGrip = setWheelGripResolver((i) => wheelGripNow[i] ?? 1);
    const offFloor = setCameraFloorResolver((x, z) => heightAt(heights, x, z) + 1.0);
    const offInertia = setChassisInertiaResolver(stableRollInertia);
    const fallback = (): { position: [number, number, number]; yaw: number } => {
      const safe = takeSafePose(carRuntime.simTime);
      if (safe) {
        lastPick.source = 'safe';
        lastPick.ageS = Math.round((carRuntime.simTime - safe.t) * 100) / 100;
        return { position: [safe.x, safe.y, safe.z], yaw: safe.yaw };
      }
      lastPick.ageS = null;
      const p = carRuntime.position;
      if (nearestRoad(roads, p.x, p.z, 400, true)) {
        lastPick.source = 'nearest-road';
        const yaw = Math.atan2(hit.tx, hit.tz);
        return { position: [hit.x, hit.y, hit.z], yaw };
      }
      lastPick.source = 'spawn';
      const roam = data.events[0]!;
      return { position: [...roam.spawn.position], yaw: roam.spawn.yaw };
    };
    const offRespawn = setRespawnResolver((_checkpoint, reason) => {
      const roam = gameState().trackLayout?.mode === 'roam';
      lastPick.source = null;
      lastPick.ageS = null;
      if (reason === 'travel') {
        const p = takePendingTravel();
        pending = null;
        if (p) {
          lastPick.source = 'travel';
          return { position: [p.x, p.y, p.z], yaw: p.yaw };
        }
        return roam ? fallback() : null;
      }
      return roam ? fallback() : null;
    });
    return () => {
      offGrip();
      offFloor();
      offRespawn();
      offInertia();
      wheelGripNow.fill(1);
    };
  }, [data, roads]);

  // Respawn / restart bookkeeping; car swap in free roam keeps the place.
  useEffect(() => {
    const settle = () => {
      S.skip = SETTLE_STEPS;
      S.waterT = 0;
      S.stuckT = 0;
      S.beachedT = 0;
      S.airT = 0;
      S.wrongT = 0;
      S.trapAlong = Number.NaN;
      S.progressValid = false;
      S.prevGateM = Number.NaN;
      S.trend = 0;
      worldLive.stuckHint = false;
      worldLive.wrongWay = false;
      worldLive.missedGate = false;
    };
    const offRespawn = onGameEvent('respawn', ({ reason }) => {
      settle();
      const p = carRuntime.position;
      const log = worldEngine.respawnLog;
      log.push({ reason, t: carRuntime.simTime, from: [p.x, p.y, p.z], to: null, yaw: 0, layoutId: gameState().trackLayout?.id ?? '', source: null, ageS: null });
      if (log.length > 20) log.shift();
    });
    const offTeleported = onGameEvent('teleported', ({ position, yaw }) => {
      const last = worldEngine.respawnLog[worldEngine.respawnLog.length - 1];
      if (last && last.to === null) {
        last.to = [position[0], position[1], position[2]];
        last.yaw = yaw;
        last.source = lastPick.source;
        last.ageS = lastPick.ageS;
      }
    });
    const offRestart = onGameEvent('restart', () => {
      settle();
      const layout = gameState().trackLayout;
      // carChanged() emits 'restart' while the old car is still mounted: a car swap, not RESTART.
      const swap = carRuntime.bodyHandle !== null && carRuntime.carId !== resolveCarId(gameState().carId);
      if (swap && layout?.mode === 'roam') {
        const pose = newestSafePose() ?? currentGroundPose(data.heights);
        queueTravel(pose, layout.id, carRuntime.bodyHandle);
        return;
      }
      clearSafePoses();
    });
    return () => {
      offRespawn();
      offTeleported();
      offRestart();
    };
  }, [S, data]);

  useBeforePhysicsStep((w: World) => {
    const t0 = performance.now();
    const handle = carRuntime.bodyHandle;
    if (!carRuntime.ready || handle === null) return;
    const body = w.getRigidBody(handle);
    if (!body) return;
    refreshCar(S);
    const v = carRuntime.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > 0.3) {
      const mg = body.mass() * GRAVITY;
      let force = 0;
      for (let i = 0; i < 4; i++) {
        const s = S.wheelSurf[i]!;
        if (s >= 0 && carRuntime.wheels[i]!.inContact) force += (S.drag[s]! * mg) / 4;
      }
      if (S.waterDepth > 0.02 && carRuntime.position.y < S.waterLevel + 1.5) force += WATER_DRAG_PER_M * Math.min(S.waterDepth, WATER_RESPAWN_DEPTH) * mg;
      if (force > 0) {
        const j = Math.min(force * DT, body.mass() * speed * 0.5) / speed;
        impulse.x = -v.x * j;
        impulse.y = -v.y * j;
        impulse.z = -v.z * j;
        body.applyImpulse(impulse, true);
      }
    }
    S.stepAcc += performance.now() - t0;
  });

  const contactCb = useMemo(
    () => (manifold: TempContactManifold) => {
      if (manifold.numContacts() > 0) S.contacts = true;
    },
    [S],
  );

  useAfterPhysicsStep((w: World) => {
    const t0 = performance.now();
    const s = gameState();
    const layout = s.trackLayout;
    if (!layout || !carRuntime.ready || carRuntime.bodyHandle === null) return;
    refreshCar(S);
    const pos = carRuntime.position;
    if (carRuntime.bodyHandle !== S.seenBody) {
      // A freshly mounted car (map / entry / car switch): cameras snap to it instead of gliding
      // across the island from wherever they were (and the LODs that glide would upload).
      S.seenBody = carRuntime.bodyHandle;
      emitGameEvent('teleported', { position: [pos.x, pos.y - carRuntime.spec.rideHeight, pos.z], yaw: Math.atan2(carRuntime.forward.x, carRuntime.forward.z) });
    }
    const x = pos.x;
    const z = pos.z;
    const v = carRuntime.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    const roam = layout.mode === 'roam';

    // Pose for the minimap.
    worldLive.x = x;
    worldLive.z = z;
    worldLive.yaw = Math.atan2(carRuntime.forward.x, carRuntime.forward.z);

    // Wheel surfaces → grip for the next step.
    const hf = worldEngine.heightfieldHandle;
    let onRoad = 0;
    let grounded = 0;
    const counts = SURF_COUNTS;
    counts.fill(0);
    for (let i = 0; i < 4; i++) {
      const wh = carRuntime.wheels[i]!;
      if (!wh.inContact) {
        S.wheelSurf[i] = -1;
        wheelGripNow[i] = 1;
        worldLive.wheelSurface[i] = null;
        continue;
      }
      grounded++;
      let sid: number;
      if (wh.groundColliderHandle !== hf) {
        sid = SURF.asphalt; // ramps, roofs, the castle: built surfaces
        onRoad++;
      } else {
        const px = wh.contactPointWorld.x;
        const pz = wh.contactPointWorld.z;
        sid = roadSurfaceAt(roads, px, pz);
        if (sid >= 0) onRoad++;
        else sid = data.surface[cellIndex(px, pz)] ?? SURF.grass;
      }
      S.wheelSurf[i] = sid;
      wheelGripNow[i] = S.grip[sid] ?? 1;
      worldLive.wheelSurface[i] = SURF_NAME[sid] ?? null;
      counts[sid]!++;
    }
    if (grounded > 0) {
      let best = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
      worldLive.surface = SURF_NAME[best] ?? null;
    } else if (worldLive.surface === null) worldLive.surface = 'asphalt';

    // Water at the car.
    const wl = waterLevelAt(x, z);
    const ground = heightAt(data.heights, x, z);
    const depth = wl - ground > 0 ? wl - ground : 0;
    S.waterDepth = depth;
    S.waterLevel = wl;
    worldLive.waterDepth = pos.y < wl + 1.5 ? depth : 0;

    // Chassis on the heightfield while 4 wheels are on road (debug counter, opt-in).
    if (contactCounter.enabled && onRoad === 4 && hf !== null && carRuntime.chassisColliderHandle !== null) {
      const chassis = w.getCollider(carRuntime.chassisColliderHandle);
      const terrain = w.getCollider(hf);
      if (chassis && terrain) {
        S.contacts = false;
        w.contactPair(chassis, terrain, contactCb);
        if (S.contacts) worldEngine.chassisContacts++;
      }
    }

    // Rules (skipped for a few steps after any respawn / restart).
    if (S.skip > 0) {
      S.skip--;
    } else {
      if (depth > WATER_RESPAWN_DEPTH && pos.y < wl + 0.2) {
        S.waterT += DT;
        if (S.waterT >= WATER_RESPAWN_S) {
          S.waterT = 0;
          s.respawn('water');
          return finish(S, t0);
        }
      } else S.waterT = 0;
      if (Math.abs(x) > BOUNDS || Math.abs(z) > BOUNDS) {
        s.respawn('bounds');
        return finish(S, t0);
      }
      if (grounded > 0 && carRuntime.throttle > 0.5 && carRuntime.speedKmh < 2) S.stuckT += DT;
      else S.stuckT = 0;
      worldLive.stuckHint = S.stuckT > STUCK_HINT_S;
      if (grounded === 0 && speed < 1) {
        S.beachedT += DT;
        if (S.beachedT > STUCK_AUTO_S) {
          S.beachedT = 0;
          s.respawn('stuck');
          return finish(S, t0);
        }
      } else S.beachedT = 0;
    }

    // Safe-pose ring.
    if (++S.safeCount >= SAFE_EVERY) {
      S.safeCount = 0;
      if (onRoad === 4 && carRuntime.up.y > 0.92 && speed > 1 && depth <= 0.05 && nearestRoad(roads, x, z, 12) && hit.grade <= 0.06 && !nearRamp(data, x, z, 15)) {
        let yaw = Math.atan2(hit.tx, hit.tz);
        if (v.x * hit.tx + v.z * hit.tz < 0) yaw += Math.PI;
        pushSafePose(hit.x, hit.y, hit.z, yaw, carRuntime.simTime);
      }
    }

    // Race guidance.
    const { race: rc, cum: cu } = ctx.current;
    if (rc && cu && !roam) guidance(S, rc, cu, s.run.checkpoint, s.run.finished, x, z);
    else if (worldLive.nextGate !== -1) {
      worldLive.nextGate = -1;
      worldLive.totalGates = 0;
      worldLive.nextGateM = Number.NaN;
      worldLive.wrongWay = false;
      worldLive.missedGate = false;
    }

    // Region label.
    if (++S.regionCount >= REGION_EVERY) {
      S.regionCount = 0;
      const rx = clampI(Math.floor((x + 1024) / 16), 0, 127);
      const rz = clampI(Math.floor((z + 1024) / 16), 0, 127);
      const r = data.region[rz * 128 + rx] ?? 0;
      if (r !== S.region) {
        S.region = r;
        useWorldHud.getState().set({ regionLabel: REGION_TEXT[r] ?? '' });
      }
    }

    // Event pads (free roam).
    if (++S.padCount >= PAD_EVERY) {
      S.padCount = 0;
      let at = -1;
      if (roam && carRuntime.speedKmh < PAD_MAX_KMH) {
        for (let k = 0; k < pads.length; k++) {
          const p = pads[k]!.pad.position;
          if (Math.hypot(p[0] - x, p[2] - z) < PAD_RADIUS) {
            at = k;
            break;
          }
        }
      }
      if (at !== S.promptPad) {
        S.promptPad = at;
        useWorldHud.getState().set({ prompt: at >= 0 ? pads[at]!.prompt : null });
      }
    }

    // Air time.
    if (grounded === 0) {
      if (S.airT === 0) {
        S.airX = x;
        S.airZ = z;
        S.airRamp = '';
        // footprint, not RampInfo.lip: for a table-top the lip field is the end of the landing slope
        let bestD = AIR_RAMP_FOOT_M;
        for (const r of data.rampInfo) {
          const d = rampDistance(r, x, z);
          if (d < bestD) {
            bestD = d;
            S.airRamp = r.id.startsWith('hay-hop') ? 'hay-hop-1' : r.id;
          }
        }
      }
      S.airT += DT;
    } else if (S.airT > 0) {
      if (S.airT > AIR_MIN_S) {
        const a = worldLive.air;
        a.seconds = Math.round(S.airT * 10) / 10;
        a.metres = Math.round(Math.hypot(x - S.airX, z - S.airZ));
        a.rampId = S.airRamp;
        a.best = S.airRamp !== '' && recordAir(carRuntime.carId, S.airRamp, S.airT, a.metres);
        a.serial++;
      }
      S.airT = 0;
    }

    // Saltglass speed trap (free roam): crossing the gantry plane on the Rimway.
    if (roam) {
      const dx = x - trap.x;
      const dz = z - trap.z;
      const along = dx * trap.s + dz * trap.c;
      const across = dx * trap.c - dz * trap.s;
      if (!Number.isNaN(S.trapAlong) && Math.sign(along) !== Math.sign(S.trapAlong) && Math.abs(across) < TRAP_HALF_WIDTH && Math.abs(pos.y - trap.y) < 4) {
        const kmh = carRuntime.speedKmh;
        if (kmh > 5) {
          const t = worldLive.trap;
          t.kmh = Math.round(kmh);
          t.best = recordTrap(carRuntime.carId, kmh);
          t.serial++;
        }
      }
      S.trapAlong = Math.abs(along) < 30 ? along : Number.NaN;
    }

    // Pending travel: once the target layout is up and (if a remount was expected) the new car stepped.
    const p = pending;
    if (p && layout.id === p.layoutId && (p.replacedBody === null || carRuntime.bodyHandle !== p.replacedBody) && pendingTravel()) {
      s.respawn('travel');
    }
    finish(S, t0);
  });

  // Keep stale pending travel from firing into another world entry.
  useEffect(() => {
    const off = useSelection.subscribe((sel, prev) => {
      if (sel.trackId !== prev.trackId && pending && pending.layoutId !== sel.trackId) clearPendingTravel();
    });
    return off;
  }, []);

  return null;
}

const SURF_COUNTS = new Uint8Array(SURFACE_KINDS.length);

function finish(S: RulesState, t0: number): void {
  S.stepAcc += performance.now() - t0;
  S.stepN++;
  if (S.stepN >= 600) {
    worldEngine.stepMs = S.stepAcc / S.stepN;
    S.stepAcc = 0;
    S.stepN = 0;
  }
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function cellIndex(x: number, z: number): number {
  return clampI(Math.floor((z + 1024) / 4), 0, 511) * 512 + clampI(Math.floor((x + 1024) / 4), 0, 511);
}

function nearRamp(data: WorldData, x: number, z: number, r: number): boolean {
  for (const ramp of data.rampInfo) if (rampDistance(ramp, x, z) < r) return true;
  return false;
}

function guidance(S: RulesState, ev: WorldEvent, cum: Float32Array, checkpoint: number, finished: boolean, x: number, z: number): void {
  const route = ev.route;
  const n = cum.length;
  const gates = ev.gates;
  const total = gates.length;
  worldLive.totalGates = total;
  if (finished || n === 0) {
    worldLive.nextGate = -1;
    worldLive.nextGateM = Number.NaN;
    worldLive.wrongWay = false;
    worldLive.missedGate = false;
    return;
  }
  const next = Math.min(checkpoint, total - 1);
  const gi = gates[next]!;
  // Progress: nearest route point in a window (a global search, bounded by the current leg, after a respawn).
  let lo: number;
  let hi: number;
  if (S.progressValid) {
    lo = Math.max(0, S.progress - PROGRESS_WINDOW);
    hi = Math.min(n - 1, S.progress + PROGRESS_WINDOW);
  } else {
    lo = next > 0 ? Math.max(0, gates[next - 1]! - PROGRESS_WINDOW) : 0;
    hi = Math.min(n - 1, gi + PROGRESS_WINDOW);
  }
  let best = Infinity;
  let bi = S.progress;
  for (let i = lo; i <= hi; i++) {
    const dx = route[i * 3]! - x;
    const dz = route[i * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bi = i;
    }
  }
  S.progress = bi;
  S.progressValid = true;
  // continuous station: project onto the segment after the nearest point, or the one before it
  const station = routeStation(route, cum, bi, x, z);
  const m = cum[gi]! - station;
  worldLive.nextGate = next + 1;
  worldLive.nextGateM = m > 0 ? m : 0;
  const gate = next < ev.checkpoints.length - 1 ? ev.checkpoints[next + 1]! : ev.finish;
  worldLive.nextGateX = gate.position[0];
  worldLive.nextGateZ = gate.position[2];
  if (!Number.isNaN(S.prevGateM)) {
    if (m > S.prevGateM + 0.005) S.trend = 1;
    else if (m < S.prevGateM - 0.005) S.trend = -1;
  }
  if (carRuntime.speedKmh > WRONG_WAY_KMH && S.trend > 0) S.wrongT += DT;
  else S.wrongT = 0;
  S.prevGateM = m;
  worldLive.wrongWay = S.wrongT > WRONG_WAY_S;
  worldLive.missedGate = -m > MISSED_M;
}

/** Distance along the route at (x, z), given the nearest route point bi (projection on an adjacent segment). */
function routeStation(route: Float32Array, cum: Float32Array, bi: number, x: number, z: number): number {
  const n = cum.length;
  const proj = (a: number, b: number): number => {
    const ax = route[a * 3]!;
    const az = route[a * 3 + 2]!;
    const sx = route[b * 3]! - ax;
    const sz = route[b * 3 + 2]! - az;
    const l2 = sx * sx + sz * sz;
    return l2 > 1e-6 ? ((x - ax) * sx + (z - az) * sz) / l2 : 0;
  };
  if (bi + 1 < n) {
    const t = proj(bi, bi + 1);
    if (t >= 0 || bi === 0) return cum[bi]! + Math.min(1, Math.max(0, t)) * (cum[bi + 1]! - cum[bi]!);
  }
  if (bi > 0) {
    const t = proj(bi - 1, bi);
    return cum[bi - 1]! + Math.min(1, Math.max(0, t)) * (cum[bi]! - cum[bi - 1]!);
  }
  return cum[bi]!;
}

/** The actions the HUD calls (results FREE ROAM, RACE tab EXIT TO FREE ROAM / TRAVEL). */
export function createWorldActions(data: WorldData): { freeRoamHere: () => void; travel: (spotId: string) => void } {
  return {
    freeRoamHere: () => {
      const layout = gameState().trackLayout;
      const pose = currentGroundPose(data.heights);
      if (layout?.mode === 'roam') {
        queueTravel(pose, layout.id, null);
        return;
      }
      queueTravel(pose, ROAM_ID, carRuntime.bodyHandle);
      selectionState().setTrack(ROAM_ID);
    },
    travel: (spotId) => {
      const spot = data.spots.find((sp) => sp.id === spotId);
      const layout = gameState().trackLayout;
      if (!spot || !layout) return;
      queueTravel({ x: spot.position[0], y: spot.position[1], z: spot.position[2], yaw: spot.yaw, t: carRuntime.simTime }, layout.id, null);
    },
  };
}
