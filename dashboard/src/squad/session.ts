import {
  BIG_JUMP_LIP_KMH,
  DEFAULT_CAR_CLASS_ID,
  assessBigJump,
  estimateFrontLiftOffKmh,
  estimateTopSpeedKmh,
  getCarClass,
  mapSquadControlsToPhysics,
  type BigJumpAssessment,
  type CarClass,
  type CarPhysicsParams,
  type GameSessionInfo,
  type SquadControls,
} from '../../../shared/protocol';
import { DEFAULT_TRACK_ID } from './garage';

/** Where the dashboard learned what the game is playing. */
export type SessionSource =
  /** Nothing reported yet: previews use the hypercar on the chaos map. */
  | 'default'
  /** The relay's copy from `server:welcome.snapshot.session` (the game may have left since). */
  | 'snapshot'
  /** A live `game:state`. */
  | 'game';

/** The car and map every preview, verdict and preset on this screen is computed for. */
export interface PlaySession {
  /** Car class id as the game reported it. An id this build doesn't know is kept for display; its physics use the hypercar. */
  carId: string;
  /** Map id, or null when the game didn't say (builds from before the garage). */
  trackId: string | null;
  /** Lip speed the map's big jump needs, km/h; null = this map has no big jump. */
  bigJumpKmh: number | null;
  /** Driver name the game reported (its DRIVERS tab); absent when no game has said. */
  driverName?: string;
  /** Name of the mounted custom car (MY RIDE); absent = the stock car of `carId`. */
  rideName?: string;
  source: SessionSource;
}

/** "DRIVER ANAYE · MY RIDE "EMBER" (NEON HYPERCAR HANDLING)" for the On track block; null when the game reported neither. */
export function driverLine(session: Pick<PlaySession, 'driverName' | 'rideName'>, baseCarName: string): string | null {
  const parts: string[] = [];
  if (session.driverName) parts.push(`DRIVER ${session.driverName.toUpperCase()}`);
  if (session.rideName) parts.push(`MY RIDE "${session.rideName.toUpperCase()}" (${baseCarName.toUpperCase()} HANDLING)`);
  return parts.length ? parts.join(' · ') : null;
}

export const DEFAULT_SESSION: Readonly<PlaySession> = Object.freeze({
  carId: DEFAULT_CAR_CLASS_ID,
  trackId: DEFAULT_TRACK_ID,
  bigJumpKmh: BIG_JUMP_LIP_KMH,
  source: 'default',
});

function hasSessionFields(info: GameSessionInfo): boolean {
  return info.carId !== undefined || info.trackId !== undefined || info.bigJumpKmh !== undefined || info.driverName !== undefined || info.rideName !== undefined;
}

/**
 * Fold the session fields of a `game:state` (or of `snapshot.session`) into what we know.
 *
 *   - None of the fields: a game from before the garage. The protocol says to treat that as the hypercar
 *     with the chaos jump's 183 km/h lip; the map is unknown.
 *   - Some of them: take those and keep the rest. The game leaves out the map for a moment while one
 *     loads, and that must not flash the screen back to the chaos map.
 */
export function mergeSession(prev: Readonly<PlaySession>, info: GameSessionInfo, source: 'snapshot' | 'game'): PlaySession {
  if (!hasSessionFields(info)) {
    return { carId: DEFAULT_CAR_CLASS_ID, trackId: null, bigJumpKmh: BIG_JUMP_LIP_KMH, source };
  }
  const next: PlaySession = {
    carId: info.carId ?? prev.carId,
    trackId: info.trackId ?? prev.trackId,
    bigJumpKmh: info.bigJumpKmh !== undefined ? info.bigJumpKmh : prev.bigJumpKmh,
    source,
  };
  // The driver name is kept across messages that leave it out (like the map while one loads); the
  // ride name is sent only while a custom car is mounted, so leaving it out means the stock car.
  const driverName = info.driverName ?? prev.driverName;
  if (driverName !== undefined) next.driverName = driverName;
  if (info.rideName !== undefined) next.rideName = info.rideName;
  return next;
}

/** Just the session fields of a message (parseMessage leaves absent ones undefined). */
export function sessionInfoOf(message: GameSessionInfo): GameSessionInfo {
  const info: GameSessionInfo = {};
  if (message.carId !== undefined) info.carId = message.carId;
  if (message.trackId !== undefined) info.trackId = message.trackId;
  if (message.bigJumpKmh !== undefined) info.bigJumpKmh = message.bigJumpKmh;
  if (message.driverName !== undefined) info.driverName = message.driverName;
  if (message.rideName !== undefined) info.rideName = message.rideName;
  return info;
}

export function sessionEqual(a: Readonly<PlaySession>, b: Readonly<PlaySession>): boolean {
  return (
    a.carId === b.carId &&
    a.trackId === b.trackId &&
    a.bigJumpKmh === b.bigJumpKmh &&
    a.source === b.source &&
    a.driverName === b.driverName &&
    a.rideName === b.rideName
  );
}

export interface SetupPreview {
  car: Readonly<CarClass>;
  physics: CarPhysicsParams;
  topSpeedKmh: number;
  liftOffKmh: number | null;
  /** The big-jump verdict for this car on this map, or null when the map has no big jump. */
  jump: BigJumpAssessment | null;
}

/**
 * The one place the screen turns sliders into numbers: the session's car class maps the controls, and
 * the map's lip speed (scaled for the car by assessBigJump) decides the jump verdict.
 */
export function previewSetup(controls: SquadControls, session: Pick<PlaySession, 'carId' | 'bigJumpKmh'>): SetupPreview {
  const car = getCarClass(session.carId);
  const physics = mapSquadControlsToPhysics(controls, car);
  const jump = session.bigJumpKmh === null ? null : assessBigJump(physics, car, session.bigJumpKmh);
  return {
    car,
    physics,
    topSpeedKmh: jump ? jump.topSpeedKmh : estimateTopSpeedKmh(physics, car),
    liftOffKmh: jump ? jump.liftOffKmh : estimateFrontLiftOffKmh(physics, car),
    jump,
  };
}
