/**
 * Room state for the FRIENDS tab and the race flow (zustand; changes at human speed). Poses never
 * pass through here — they live in remotePlayers.ts and are read from useFrame.
 *
 * `status`: 'offline' (networking off or no relay yet), 'idle' (connected, not in a room),
 * 'joining' (create / join sent), 'in-room'. `race` mirrors the relay's room:race; `lastResults`
 * keeps the previous race's table while a new lobby forms.
 */
import { create } from 'zustand';
import type { RoomErrorCode, RoomLeftReason, RoomPlayer, RoomRace } from '@shared/protocol';

export type RoomStatus = 'offline' | 'idle' | 'joining' | 'in-room';

export interface RoomError {
  code: RoomErrorCode | 'link' | 'timeout';
  message: string;
  at: number;
}

export interface RoomState {
  status: RoomStatus;
  code: string | null;
  /** Our own player id in the room (the relay client id). */
  you: string | null;
  players: RoomPlayer[];
  race: RoomRace | null;
  /** The most recent race that reached 'results' (shown under the lobby). */
  lastResults: RoomRace | null;
  error: RoomError | null;
  /** Why the last room ended (cleared on the next join). */
  left: RoomLeftReason | 'link' | null;
  /** Relay clock sync, for the UI. */
  clock: { offsetMs: number; rttMs: number | null; samples: number };
  /** `?room=CODE` waiting for the link (null once attempted). */
  pendingCode: string | null;
  /** The code of the last join attempt (refills ROOM CODE after ROOM FULL and the like). */
  lastCode: string | null;
  /** Relay-clock ms of our lights-out on the current shared race (debug / tests). */
  goAt: number | null;
  /** Relay-clock ms when our lights were armed (startAt − 3 lights nominal; debug / tests). */
  armAt: number | null;
  /** Our role in the current race: a row in results = racing with everyone; else untimed. */
  participant: boolean;
  /** Seats: the room size (null from a relay that predates seats). */
  size: number | null;
  /** The relay keeps seats (sizes, REMOVE, MAKE HOST, reconnect grace); false on a relay that predates them. */
  seats: boolean;
  /**
   * The room we are getting back into after the link dropped (null otherwise). Rooms mode (no AI rivals,
   * no ghost) holds through the blip; cleared when we are back in, give up, or leave.
   */
  rejoining: string | null;
  /** How many times this page took its seat back after a reconnect (debug / tests). */
  restores: number;
  set: (patch: Partial<Omit<RoomState, 'set' | 'reset'>>) => void;
  reset: (status: RoomStatus, left?: RoomLeftReason | 'link' | null) => void;
}

const EMPTY = {
  code: null,
  you: null,
  players: [] as RoomPlayer[],
  race: null,
  participant: false,
  goAt: null,
  armAt: null,
  size: null,
  seats: false,
};

export const useRoom = create<RoomState>()((set) => ({
  status: 'offline',
  ...EMPTY,
  lastResults: null,
  error: null,
  left: null,
  clock: { offsetMs: 0, rttMs: null, samples: 0 },
  pendingCode: null,
  lastCode: null,
  rejoining: null,
  restores: 0,
  set: (patch) => set(patch),
  reset: (status, left = null) => set({ status, ...EMPTY, left }),
}));

export const roomState = (): RoomState => useRoom.getState();

/** In a room, or getting back into one after a link blip: friends races have no AI rivals and no ghost. */
export const inRoomMode = (s: Pick<RoomState, 'status' | 'rejoining'>): boolean => s.status === 'in-room' || s.rejoining !== null;

/** The member who would get the room if the host left now: the earliest present member other than `you`. */
export function nextHost(state: Pick<RoomState, 'players' | 'you'>): RoomPlayer | null {
  return state.players.find((p) => p.id !== state.you && !p.away) ?? null;
}

/** The player entry for `id` (or null). */
export function playerById(state: Pick<RoomState, 'players'>, id: string | null): RoomPlayer | null {
  return id === null ? null : (state.players.find((p) => p.id === id) ?? null);
}

export function isHost(state: Pick<RoomState, 'players' | 'you'>): boolean {
  return playerById(state, state.you)?.isHost === true;
}

/** Results rows sorted for the table: finishers by time, then the others in row order (DNF / still driving). */
export function sortedResults(race: RoomRace | null): RoomRace['results'] {
  if (!race) return [];
  return [...race.results].sort((a, b) => {
    if (a.finishMs === null && b.finishMs === null) return 0;
    if (a.finishMs === null) return 1;
    if (b.finishMs === null) return -1;
    return a.finishMs - b.finishMs;
  });
}

/** 1-based position of `id` among the finishers, or null while it has no time. */
export function positionOf(race: RoomRace | null, id: string | null): number | null {
  if (!race || id === null) return null;
  const rows = sortedResults(race);
  const index = rows.findIndex((r) => r.id === id);
  if (index < 0 || rows[index]!.finishMs === null) return null;
  return index + 1;
}

/**
 * The results-card position line in a room, from the relay's times, so both phones say the same:
 * "P1 · AHEAD OF ANAYE 2 BY 0.2 S" once the nearest friend has a time, "P1 · AHEAD OF ANAYE 2" while
 * every friend is still driving (no guessed seconds). `myFinishMs` stands in for our own row until the
 * relay echoes it. Null when we have no row in this race or raced alone.
 */
export function roomPositionLine(race: RoomRace | null, you: string | null, myFinishMs: number): string | null {
  if (!race || you === null) return null;
  const mine = race.results.find((r) => r.id === you);
  if (!mine) return null;
  const myMs = mine.finishMs ?? myFinishMs;
  const others = race.results.filter((r) => r.id !== you);
  if (others.length === 0) return null;
  const done = others.filter((r): r is RoomRace['results'][number] & { finishMs: number } => r.finishMs !== null);
  const position = 1 + done.filter((r) => r.finishMs < myMs).length;
  if (done.length === 0) return `P${position} · AHEAD OF ${others[0]!.name.toUpperCase()}`;
  const nearest = done.reduce((best, r) => (Math.abs(r.finishMs - myMs) < Math.abs(best.finishMs - myMs) ? r : best));
  const gapMs = nearest.finishMs - myMs;
  const secs = `${(Math.abs(gapMs) / 1000).toFixed(1)} S`;
  const name = nearest.name.toUpperCase();
  return gapMs < 0 ? `P${position} · ${secs} BEHIND ${name}` : `P${position} · AHEAD OF ${name} BY ${secs}`;
}
