/**
 * Rival cars at medal pace, the live standings clock and the name-tag projector. Mounted once in
 * App.tsx after <RunController/> inside <Physics>, so it pauses with the menu and its after-step
 * callbacks run after the car's (same-step pose). Everything is keyed by the registered layout:
 * free roam (mode 'roam') and maps without medals get no rivals; a map switch unmounts them.
 *
 * Zero physics: rivals are poses on the route polyline (rivals/route.ts) driven by a speed plan
 * (speedPlan.ts) against the race clock (steps since GO × PHYSICS_DT, so the menu pause freezes
 * them and a finished player no longer stops the clock for them).
 */
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useAfterPhysicsStep, useRapier } from '@react-three/rapier';
import { create } from 'zustand';
import { Euler, Quaternion, Vector3 } from 'three';
import { QueryFilterFlags } from '@dimforge/rapier3d-compat';
import { isCarClassId, type CarClassId } from '@shared/protocol';
import { resolveCarId } from '../car/catalog';
import { carRuntime } from '../car/runtime';
import { getVehicleSpec } from '../car/vehicleSpec';
import { PHYSICS_DT } from '../config';
import { onGameEvent } from '../game/events';
import { activeDriver, useProfile } from '../state/profile';
import { useSelection } from '../state/selection';
import { gameState, useGameStore } from '../state/store';
import type { TrackLayout } from '../track/types';
import { worldEngine } from '../track/world/engine';
import { heightAt } from '../track/world/gen/heightAt';
import { GhostCar, GhostRecorderDriver, ghostDebug } from './GhostCar';
import KinematicCar, { type KinematicPose } from './KinematicCar';
import { projectTags } from './nameTags';
import { planRivals, type RivalSpec } from './rivals';
import { sampleRoute, type RaceRoute } from './route';
import { routeForLayout } from './routeCache';
import { speedAtTime, stationAtTime } from './speedPlan';
import {
  PLAYER_ID,
  participantsList,
  publishStandings,
  registerParticipant,
  rewindProgress,
  routeProgressOf,
  setFinished,
  setProgress,
  setRaceClock,
  setStandingsRoute,
  standingsRoute,
  standingsSnapshot,
} from './standings';
import { useRivalSettings } from './store';

/** Rivals fade to this within FADE_NEAR_M of the player so they never hide the road. */
const NEAR_OPACITY = 0.6;
const FADE_NEAR_M = 6;
/** Seconds a finished rival rolls on before fading out. */
const FINISH_LINGER_S = 1.5;
const FINISH_FADE_S = 0.6;
const MERGE_M = 60;

/** Race clock and run bookkeeping shared by the rivals, the ghost and the standings (module state). */
export const race = {
  layout: null as TrackLayout | null,
  route: null as RaceRoute | null,
  /** Steps since GO (0 before the lights go out). */
  steps: 0,
  live: false,
  /** Incremented on every restart / new layout: rotates the rival line-up. */
  serial: 0,
  playerFinished: false,
};

export const raceTimeS = (): number => race.steps * PHYSICS_DT;

/**
 * Keeps the race clock, the standings route and the player's own standing. Runs for every layout
 * (remote players rank against the player even with rivals OFF).
 */
function RaceClock() {
  const carId = useSelection((s) => resolveCarId(s.carId));
  const driverName = useProfile((s) => activeDriver(s).name);
  const driverColor = useProfile((s) => activeDriver(s).avatar.color);
  const bump = useRivalsRun((s) => s.bump);
  useEffect(
    () => registerParticipant({ id: PLAYER_ID, name: driverName, carId: isCarClassId(carId) ? carId : 'hypercar', kind: 'player', color: driverColor }),
    [carId, driverName, driverColor],
  );
  useEffect(() => {
    const reset = () => {
      race.live = false;
      race.steps = 0;
      race.playerFinished = false;
      race.serial++;
      setRaceClock(0);
      if (race.route) setStandingsRoute(race.route);
      bump();
    };
    const offs = [
      onGameEvent('restart', reset),
      onGameEvent('respawn', ({ checkpoint }) => {
        if (race.route) rewindProgress(PLAYER_ID, routeProgressOf(carRuntime.position, checkpoint));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bump]);

  useAfterPhysicsStep(() => {
    const s = gameState();
    const layout = s.trackLayout;
    if (!layout || layout.mode === 'roam') {
      if (race.route) {
        race.route = null;
        race.layout = null;
        race.live = false;
        race.steps = 0;
        setStandingsRoute(null);
      }
      return;
    }
    if (race.layout !== layout) {
      const route = routeForLayout(layout);
      if (!route) return; // island still building
      race.layout = layout;
      race.route = route;
      race.live = false;
      race.steps = 0;
      race.playerFinished = false;
      race.serial++;
      setRaceClock(0);
      setStandingsRoute(route);
      bump();
    }
    if (!race.live && (s.run.started || s.run.finished)) race.live = true;
    if (race.live) {
      race.steps++;
      setRaceClock(race.steps * PHYSICS_DT * 1000);
    }
    if (race.steps % 6 === 0 && carRuntime.ready) {
      setProgress(PLAYER_ID, routeProgressOf(carRuntime.position, s.run.checkpoint));
      if (s.run.finished && !race.playerFinished) {
        race.playerFinished = true;
        setFinished(PLAYER_ID, s.run.elapsedMs);
      }
      publishStandings();
    }
  });
  return null;
}

// A tiny store so the rival pack re-plans (new line-up) on every run.
const useRivalsRun = create<{ serial: number; bump: () => void }>()((set) => ({ serial: 0, bump: () => set((s) => ({ serial: s.serial + 1 })) }));

interface RivalRuntime {
  spec: RivalSpec;
  pose: KinematicPose;
  fade: { opacity: number };
  s: number;
  speed: number;
  finished: boolean;
  finishedAtS: number;
  pitch: number;
  rideHeight: number;
  lastProgressStep: number;
}

const _sample = { x: 0, y: 0, z: 0, yaw: 0 };
const _ahead = { x: 0, y: 0, z: 0, yaw: 0 };
const _euler = new Euler();
const _v = new Vector3();

/** The three (or one) rivals of the current run on `layout`. */
function RivalPack({ layout, count }: { layout: TrackLayout; count: 1 | 3 }) {
  const serial = useRivalsRun((s) => s.serial);
  const playerCarId = useSelection((s) => resolveCarId(s.carId));
  // Stable selections (a selector returning a fresh array every render would loop React).
  const drivers = useProfile((s) => s.drivers);
  const activeDriverId = useProfile((s) => s.activeDriverId);
  const others = useMemo(() => drivers.filter((d) => d.id !== activeDriverId), [drivers, activeDriverId]);
  const route = race.route && race.layout === layout ? race.route : routeForLayout(layout);
  const rivals = useMemo<RivalRuntime[]>(() => {
    if (!route) return [];
    const specs = planRivals({ route, trackId: layout.id, playerCarId, others, serial: race.serial, count });
    return specs.map((spec) => ({
      spec,
      pose: { position: new Vector3(), quaternion: new Quaternion(), speedKmh: 0, steer: 0 },
      fade: { opacity: 1 },
      s: 0,
      speed: 0,
      finished: false,
      finishedAtS: 0,
      pitch: 0,
      rideHeight: getVehicleSpec(spec.carId).rideHeight,
      lastProgressStep: -1,
    }));
    // `serial` is the dependency that re-plans; race.serial is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, layout.id, playerCarId, others, serial, count]);

  useEffect(() => {
    rivalsDebug.pack = rivals;
    const offs = rivals.map((r) => registerParticipant({ id: r.spec.id, name: r.spec.name, carId: r.spec.carId, kind: 'rival', color: r.spec.color }));
    // Place everyone on the grid at once (before the first step).
    for (const r of rivals) placeRival(r, route, 0, 0);
    publishStandings(true);
    return () => {
      offs.forEach((off) => off());
      if (rivalsDebug.pack === rivals) rivalsDebug.pack = [];
    };
  }, [rivals, route]);

  useAfterPhysicsStep(() => {
    if (!route || rivals.length === 0) return;
    const t = raceTimeS();
    for (const r of rivals) {
      const drive = race.live ? t - r.spec.reactionS : 0;
      if (drive <= 0) {
        if (r.s !== 0) placeRival(r, route, 0, 0);
        continue;
      }
      if (!r.finished) {
        r.s = stationAtTime(r.spec.plan, drive);
        r.speed = speedAtTime(r.spec.plan, drive);
        if (r.s >= route.lengthM - 1e-3) {
          r.finished = true;
          r.finishedAtS = t;
          r.s = route.lengthM;
          setFinished(r.spec.id, r.spec.targetMs);
        } else if (race.steps - r.lastProgressStep >= 6) {
          r.lastProgressStep = race.steps;
          setProgress(r.spec.id, r.s, r.spec.targetMs);
        }
      } else {
        // Roll on, slow down, fade out.
        r.speed = Math.max(0, r.speed - 5 * PHYSICS_DT);
        r.s += r.speed * PHYSICS_DT;
        const since = t - r.finishedAtS;
        if (since > FINISH_LINGER_S) r.fade.opacity = Math.max(0, 1 - (since - FINISH_LINGER_S) / FINISH_FADE_S);
      }
      placeRival(r, route, r.s, r.speed);
    }
  });

  return (
    <>
      {rivals.map((r) => (
        <KinematicCar key={r.spec.id} carId={r.spec.carId} look={r.spec.look} plate={r.spec.plate} label={r.spec.name} labelColor={r.spec.color} pose={r.pose} fade={r.fade} />
      ))}
    </>
  );
}

/** Pose at station `s` of the route with the grid offset, the lateral wander and the surface height. */
function placeRival(r: RivalRuntime, route: RaceRoute | null, s: number, speed: number): void {
  if (!route) return;
  const spec = r.spec;
  const merge = Math.min(1, Math.max(0, s / MERGE_M));
  const sDisplay = s - spec.gridBack * (1 - merge);
  sampleRoute(route, sDisplay, _sample);
  sampleRoute(route, sDisplay + 4, _ahead);
  const lateral = spec.gridSide * (1 - merge) + spec.lateralAmp * Math.sin((2 * Math.PI * s) / spec.lateralPeriod + spec.lateralPhase) * merge;
  const yaw = _sample.yaw;
  // Left = (cos yaw, 0, −sin yaw) in this game's frame (+X is the driver's left at yaw 0).
  const x = _sample.x + Math.cos(yaw) * lateral;
  const z = _sample.z - Math.sin(yaw) * lateral;
  let y = _sample.y;
  let pitch = 0;
  if (route.world === 'island') {
    const data = worldEngine.data;
    if (data) {
      y = heightAt(data.heights, x, z);
      const yAhead = heightAt(data.heights, _ahead.x + Math.cos(_ahead.yaw) * lateral, _ahead.z - Math.sin(_ahead.yaw) * lateral);
      pitch = -Math.atan2(yAhead - y, 4);
    }
  } else {
    pitch = -Math.atan2(_ahead.y - y, 4);
  }
  // Smooth the pitch (a route sampled every 2 m has small kinks).
  r.pitch += (pitch - r.pitch) * 0.2;
  r.pose.position.set(x, y + r.rideHeight, z);
  _euler.set(r.pitch, yaw, 0, 'YXZ');
  r.pose.quaternion.setFromEuler(_euler);
  r.pose.speedKmh = speed * 3.6;
  // Steer from the heading change over the next 4 m (visual only).
  let dyaw = _ahead.yaw - yaw;
  if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  r.pose.steer = Math.max(-1, Math.min(1, -dyaw * 6));
  // Near the player: translucent (never while fading out after the finish).
  if (!r.finished) {
    const d = _v.copy(r.pose.position).sub(carRuntime.position).length();
    const target = d < FADE_NEAR_M ? NEAR_OPACITY : 1;
    r.fade.opacity += (target - r.fade.opacity) * 0.15;
  }
}

/**
 * Projects every name tag into screen pixels (HUD's <NameTags/> draws them). Default priority: a
 * positive useFrame priority would switch R3F to manual rendering. Runs before ChaseCamera's frame
 * callback (mount order), so a tag uses the previous frame's camera: with a chase camera that moves
 * with the car the difference is invisible.
 */
function TagProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => projectTags(camera, size.width, size.height));
  return null;
}

// ── Debug handle (window.__RIVALS__) ─────────────────────────────────────────
export const rivalsDebug: { pack: RivalRuntime[] } = { pack: [] };

export interface RivalsDebugHandle {
  rivals(): { id: string; name: string; carId: CarClassId; medal: string; targetMs: number; reactionS: number; s: number; speedKmh: number; x: number; y: number; z: number; rideHeight: number; finished: boolean; opacity: number }[];
  standings(): ReturnType<typeof standingsSnapshot>;
  participants(): ReturnType<typeof participantsList>;
  route(): { id: string; lengthM: number; gateS: number[]; world: string; points: number } | null;
  raceMs(): number;
  live(): boolean;
  /** Physics raycast straight down from (x, fromY, z) ignoring the player's colliders and sensors → ground y, or null. */
  castDown(x: number, z: number, fromY?: number): number | null;
  ghost(): { recording: number; tape: { trackId: string; carId: string; n: number; finishMs: number } | null; pose: { x: number; y: number; z: number } | null; lastSave: { trackId: string; carId: string; n: number; ms: number } | null };
  settings(): { rivals: number; ghost: boolean };
  setSettings(patch: { rivals?: 0 | 1 | 3; ghost?: boolean }): void;
}

declare global {
  interface Window {
    __RIVALS__?: RivalsDebugHandle;
  }
}

function RivalsDebugHandle() {
  const { world, rapier } = useRapier();
  useLayoutEffect(() => {
    const handle: RivalsDebugHandle = {
      rivals: () =>
        rivalsDebug.pack.map((r) => ({
          id: r.spec.id,
          name: r.spec.name,
          carId: r.spec.carId,
          medal: r.spec.medal,
          targetMs: r.spec.targetMs,
          reactionS: r.spec.reactionS,
          s: r.s,
          speedKmh: r.pose.speedKmh,
          x: r.pose.position.x,
          y: r.pose.position.y,
          z: r.pose.position.z,
          rideHeight: r.rideHeight,
          finished: r.finished,
          opacity: r.fade.opacity,
        })),
      standings: () => standingsSnapshot(),
      participants: () => participantsList(),
      route: () => {
        const r = standingsRoute();
        return r ? { id: r.id, lengthM: r.lengthM, gateS: r.gateS, world: r.world, points: r.cum.length } : null;
      },
      raceMs: () => race.steps * PHYSICS_DT * 1000,
      live: () => race.live,
      castDown: (x, z, fromY = 60) => {
        const ray = new rapier.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, 400, true, QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => c.handle !== carRuntime.chassisColliderHandle);
        return hit ? fromY - hit.timeOfImpact : null;
      },
      ghost: () => ({
        recording: ghostDebug.recorder?.n ?? 0,
        tape: ghostDebug.tape ? { trackId: ghostDebug.tape.trackId, carId: ghostDebug.tape.carId, n: ghostDebug.tape.n, finishMs: ghostDebug.tape.finishMs } : null,
        pose: ghostDebug.pose ? { x: ghostDebug.pose.position.x, y: ghostDebug.pose.position.y, z: ghostDebug.pose.position.z } : null,
        lastSave: ghostDebug.lastSave,
      }),
      settings: () => ({ rivals: useRivalSettings.getState().rivals, ghost: useRivalSettings.getState().ghost }),
      setSettings: (patch) => {
        if (patch.rivals !== undefined) useRivalSettings.getState().setRivals(patch.rivals);
        if (patch.ghost !== undefined) useRivalSettings.getState().setGhost(patch.ghost);
      },
    };
    window.__RIVALS__ = handle;
    return () => {
      if (window.__RIVALS__ === handle) delete window.__RIVALS__;
    };
  }, [world, rapier]);
  return null;
}

/** Mounted once in App.tsx (inside <Physics>, after <RunController/>). */
export function RivalsLayer() {
  const layout = useGameStore((s) => s.trackLayout);
  const carId = useSelection((s) => s.carId);
  const count = useRivalSettings((s) => s.rivals);
  const ghost = useRivalSettings((s) => s.ghost);
  const timed = layout !== null && layout.mode !== 'roam';
  return (
    <>
      <TagProjector />
      <RaceClock />
      {timed && <GhostRecorderDriver />}
      {timed && count !== 0 && <RivalPack key={`${layout.id}:${carId}`} layout={layout} count={count} />}
      {timed && ghost && <GhostCar key={`ghost:${layout.id}:${carId}`} layout={layout} />}
      <RivalsDebugHandle />
    </>
  );
}
