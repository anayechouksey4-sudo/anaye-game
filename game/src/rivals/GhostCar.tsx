/**
 * The shadow ghost: records the player's run at 10 Hz from GO (rivals/ghost.ts) and, when the run is
 * a new best for this car on this map, saves it; on the next run the saved best is replayed as a
 * translucent copy of the player's own car ("YOU · BEST"), ranked never (kind 'ghost'), no contact.
 * Recording always runs on timed races (cheap); playback follows SETTINGS · GHOST.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAfterPhysicsStep } from '@react-three/rapier';
import { Quaternion, Vector3 } from 'three';
import { isCarClassId, type CarClassId } from '@shared/protocol';
import { resolveCarId } from '../car/catalog';
import { plateFor } from '../car/plates/platePick';
import { carRuntime } from '../car/runtime';
import { onGameEvent } from '../game/events';
import { activeDriver, useProfile } from '../state/profile';
import { useSelection } from '../state/selection';
import { gameState } from '../state/store';
import type { TrackLayout } from '../track/types';
import { GhostRecorder, loadGhost, sampleTape, saveGhost, type GhostTape } from './ghost';
import KinematicCar, { type KinematicPose } from './KinematicCar';
import { race, raceTimeS } from './RivalsLayer';
import { registerParticipant } from './standings';

const GHOST_OPACITY = 0.4;
const GHOST_ID = 'ghost';
/** Seconds the ghost holds its last pose after its tape ends before fading. */
const HOLD_S = 1;

export const ghostDebug = {
  recorder: null as GhostRecorder | null,
  tape: null as GhostTape | null,
  pose: null as KinematicPose | null,
  lastSave: null as { trackId: string; carId: string; n: number; ms: number } | null,
};

const _s = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

/** Records every timed run; saves on a best. Mounted with the layer (not keyed), reads the race clock. */
export function GhostRecorderDriver() {
  const rec = useMemo(() => new GhostRecorder(), []);
  const lastStep = useRef(-1);
  useEffect(() => {
    ghostDebug.recorder = rec;
    const offs = [
      onGameEvent('restart', () => rec.reset()),
      onGameEvent('finish', ({ elapsedMs, isBest }) => {
        const layout = gameState().trackLayout;
        if (!isBest || !layout || layout.mode === 'roam' || rec.n < 2) return;
        const carId = resolveCarId(useSelection.getState().carId);
        const tape = rec.tape(layout.id, carId, elapsedMs);
        if (saveGhost(tape)) {
          ghostDebug.lastSave = { trackId: layout.id, carId, n: tape.n, ms: elapsedMs };
          bumpGhostSerial();
        }
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      if (ghostDebug.recorder === rec) ghostDebug.recorder = null;
    };
  }, [rec]);
  useAfterPhysicsStep(() => {
    const s = gameState();
    if (!race.live || !carRuntime.ready || s.run.finished) {
      if (!race.live) {
        rec.reset();
        lastStep.current = -1;
      }
      return;
    }
    // Sample k sits at t = k / GHOST_HZ: sample 0 on the first live step (the car is still at the line),
    // then every 6th step (race.steps = 6, 12, …) → sample 1 at 0.1 s, 2 at 0.2 s …
    const first = race.steps === 1 && rec.n === 0;
    if (!first && (race.steps % 6 !== 0 || race.steps === lastStep.current)) return;
    lastStep.current = race.steps;
    const p = carRuntime.position;
    const q = carRuntime.quaternion;
    rec.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
  });
  return null;
}

// Bumped after a save so the player reloads the new tape at the next run.
let ghostSerial = 0;
const serialListeners = new Set<() => void>();
function bumpGhostSerial(): void {
  ghostSerial++;
  for (const fn of serialListeners) fn();
}

/** Replays the saved best of (layout, car) as a translucent copy of the player's car. */
export function GhostCar({ layout }: { layout: TrackLayout }) {
  const carId = useSelection((s) => resolveCarId(s.carId));
  const classId: CarClassId = isCarClassId(carId) ? carId : 'hypercar';
  const ride = useProfile((s) => (s.rideActive && s.ride.base === carId ? s.ride : null));
  const avatar = useProfile((s) => activeDriver(s).avatar);
  const look = useMemo(() => ({ ride, driver: avatar }), [ride, avatar]);
  const driverName = useProfile((s) => activeDriver(s).name);
  const [serial, setSerial] = useState(ghostSerial);
  useEffect(() => {
    const fn = () => setSerial(ghostSerial);
    serialListeners.add(fn);
    return () => {
      serialListeners.delete(fn);
    };
  }, []);
  // Reload the tape at the start of each run (a save during this run shows from the next one).
  const [runSerial, setRunSerial] = useState(0);
  useEffect(() => onGameEvent('restart', () => setRunSerial((v) => v + 1)), []);
  const tape = useMemo(() => loadGhost(layout.id, carId), [layout.id, carId, serial, runSerial]);
  const pose = useMemo<KinematicPose>(() => ({ position: new Vector3(), quaternion: new Quaternion(), speedKmh: 0, steer: 0 }), []);
  const fade = useMemo(() => ({ opacity: GHOST_OPACITY }), []);
  const prev = useRef(new Vector3());
  useEffect(() => {
    ghostDebug.tape = tape;
    ghostDebug.pose = tape ? pose : null;
    if (!tape) return;
    sampleTape(tape, 0, _s);
    pose.position.set(_s.x, _s.y, _s.z);
    pose.quaternion.set(_s.qx, _s.qy, _s.qz, _s.qw);
    prev.current.copy(pose.position);
    fade.opacity = GHOST_OPACITY;
    return registerParticipant({ id: GHOST_ID, name: `${driverName} · BEST`, carId: classId, kind: 'ghost', color: '#d8f7ff' });
  }, [tape, pose, fade, classId, driverName]);

  useAfterPhysicsStep(() => {
    if (!tape) return;
    const t = race.live ? raceTimeS() : 0;
    const end = (tape.n - 1) / 10;
    if (!sampleTape(tape, t, _s)) return;
    prev.current.copy(pose.position);
    pose.position.set(_s.x, _s.y, _s.z);
    pose.quaternion.set(_s.qx, _s.qy, _s.qz, _s.qw);
    pose.speedKmh = t > 0 && t < end ? prev.current.distanceTo(pose.position) * 60 * 3.6 : 0;
    const over = t - end;
    fade.opacity = over <= HOLD_S ? GHOST_OPACITY : Math.max(0, GHOST_OPACITY * (1 - (over - HOLD_S) / 0.6));
  });

  if (!tape) return null;
  return <KinematicCar carId={classId} look={look} plate={plateFor(carId)} label={`${driverName} · BEST`} labelColor="#d8f7ff" opacity={GHOST_OPACITY} fade={fade} pose={pose} />;
}
