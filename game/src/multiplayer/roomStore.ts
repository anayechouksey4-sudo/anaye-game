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
  /** Relay-clock ms of our lights-out on the current shared race (debug / tests). */
  goAt: number | null;
  /** Relay-clock ms when our lights were armed (startAt − 3 lights nominal; debug / tests). */
  armAt: number | null;
  /** Our role in the current race: a row in results = racing with everyone; else untimed. */
  participant: boolean;
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
};

export const useRoom = create<RoomState>()((set) => ({
  status: 'offline',
  ...EMPTY,
  lastResults: null,
  error: null,
  left: null,
  clock: { offsetMs: 0, rttMs: null, samples: 0 },
  pendingCode: null,
  set: (patch) => set(patch),
  reset: (status, left = null) => set({ status, ...EMPTY, left }),
}));

export const roomState = (): RoomState => useRoom.getState();

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
