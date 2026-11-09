/**
 * FRIENDS rooms on the device (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/rooms.test.ts
 *
 * - results line in a room comes from the relay's times (the same on both phones), never a guessed gap
 *   while the friend is still driving, and follows the friend's time when it arrives
 * - a friend's pace in the standings comes from the speed its poses report (progress deltas that
 *   arrive in network bursts used to drag it to 0, so "AHEAD BY 208 S" for a 5 s gap)
 * - the seat this page was in is kept for a reload within the relay's grace, per tab (sessionStorage),
 *   and cleared on leave; the installed app also reads localStorage
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const sessionStorage = new MemoryStorage();
const localStorage = new MemoryStorage();
let standaloneMode = false;
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage,
  localStorage,
  matchMedia: (q: string) => ({ matches: standaloneMode && q.includes('standalone') }),
  location: { search: '', hash: '', href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', port: '', origin: 'http://localhost' },
};

const { roomPositionLine } = await import('../src/multiplayer/roomStore');
const { forgetSeat, rememberSeat, seatToRestore, ROOM_SEAT_STORAGE_KEY } = await import('../src/multiplayer/friendsProfile');
const standings = await import('../src/rivals/standings');
const { ROOM_SEAT_GRACE_MS } = await import('../../shared/protocol');

const race = (rows: [string, string, number | null][], startAt = 1000) => ({
  phase: 'racing' as const,
  track: 'strip',
  startAt,
  results: rows.map(([id, name, finishMs]) => ({ id, name, finishMs, falls: 0 })),
});

test('room results line: relay times, no guessed seconds, follows the friend’s finish', () => {
  // We finished first; the friend is still driving: no seconds yet.
  assert.equal(roomPositionLine(race([['a', 'Anaye', 44567], ['b', 'Anaye 2', null]]), 'a', 44567), 'P1 · AHEAD OF ANAYE 2');
  // Our own row not echoed yet: the local time stands in.
  assert.equal(roomPositionLine(race([['a', 'Anaye', null], ['b', 'Anaye 2', null]]), 'a', 44567), 'P1 · AHEAD OF ANAYE 2');
  // The friend's time arrives: the verifier's 44.567 vs 44.733 case reads 0.2 s (it used to say 6.2 s).
  assert.equal(roomPositionLine(race([['a', 'Anaye', 44567], ['b', 'Anaye 2', 44733]]), 'a', 44567), 'P1 · AHEAD OF ANAYE 2 BY 0.2 S');
  // The other phone says the same thing from its side.
  assert.equal(roomPositionLine(race([['a', 'Anaye', 44567], ['b', 'Anaye 2', 44733]]), 'b', 44733), 'P2 · 0.2 S BEHIND ANAYE');
  // Three players: nearest finished friend, position among the finishers.
  const three = race([['a', 'Ava', 40000], ['b', 'Bo', 41000], ['c', 'Cy', null]]);
  assert.equal(roomPositionLine(three, 'b', 41000), 'P2 · 1.0 S BEHIND AVA');
  assert.equal(roomPositionLine(race([['a', 'Ava', 40000], ['b', 'Bo', 41000], ['c', 'Cy', 41300]]), 'b', 41000), 'P2 · AHEAD OF CY BY 0.3 S');
  // No row for us (the race started without us) or alone in the race: no line.
  assert.equal(roomPositionLine(race([['a', 'Ava', 40000], ['b', 'Bo', null]]), 'z', 40000), null);
  assert.equal(roomPositionLine(race([['a', 'Ava', 40000]]), 'a', 40000), null);
  assert.equal(roomPositionLine(null, 'a', 40000), null);
});

test('a friend’s standings pace comes from its reported speed, not network-burst progress deltas', () => {
  standings.resetStandingsForTests();
  const route = { lengthM: 1000 } as unknown as Parameters<typeof standings.setStandingsRoute>[0];
  standings.setStandingsRoute(route);
  standings.registerParticipant({ id: standings.PLAYER_ID, name: 'Me', carId: 'hypercar', kind: 'player' });
  standings.registerParticipant({ id: 'f', name: 'Friend', carId: 'hypercar', kind: 'remote' });
  // Poses arrive in bursts: several with the same progress, then a jump. Reported speed 25 m/s throughout.
  let t = 0;
  let pm = 0;
  for (let i = 0; i < 60; i++) {
    t += 66;
    standings.setRaceClock(t);
    if (i % 4 === 3) pm += 25 * 0.264;
    standings.setProgress('f', pm);
    standings.setReportedSpeed('f', 25);
  }
  const friend = standings.participantsList().find((p) => p.id === 'f')!;
  assert.ok(Math.abs(friend.speedMps - 25) < 0.5, `speed ${friend.speedMps}`);
  // The player finishes; the friend has 100 m to go at 25 m/s: about 4 s behind, not 20 s at the 5 m/s floor.
  standings.setProgress('f', 900);
  standings.setFinished(standings.PLAYER_ID, t);
  standings.publishStandings(true);
  const row = standings.standingsSnapshot().order.find((r) => r.id === 'f')!;
  assert.ok(row.gapToPlayerS !== null && Math.abs(row.gapToPlayerS + 4) < 0.6, `gap ${row.gapToPlayerS}`);
  // Without a reported speed, a sample behind the best progress no longer resets the reference time.
  standings.registerParticipant({ id: 'g', name: 'Old', carId: 'hypercar', kind: 'remote' });
  standings.setRaceClock(t + 1000);
  standings.setProgress('g', 20);
  standings.setRaceClock(t + 2000);
  standings.setProgress('g', 19.5);
  standings.setRaceClock(t + 3000);
  standings.setProgress('g', 60);
  const g = standings.participantsList().find((p) => p.id === 'g')!;
  assert.ok(g.speedMps > 10, `delta-based speed ${g.speedMps}`);
});

test('the seat survives a reload within the grace, per tab; leave forgets it; the installed app reads localStorage', () => {
  sessionStorage.clear();
  localStorage.clear();
  const t0 = 1_700_000_000_000;
  rememberSeat('BCDF', t0);
  assert.deepEqual(seatToRestore(ROOM_SEAT_GRACE_MS, t0 + 30_000), { code: 'BCDF', leftMs: ROOM_SEAT_GRACE_MS - 30_000 });
  assert.equal(seatToRestore(ROOM_SEAT_GRACE_MS, t0 + ROOM_SEAT_GRACE_MS), null, 'past the grace the relay has freed it');
  // A new tab (no sessionStorage) in a browser does not take the seat over.
  sessionStorage.clear();
  assert.equal(seatToRestore(ROOM_SEAT_GRACE_MS, t0 + 1000), null);
  // The installed app (standalone) has one window: localStorage is enough.
  standaloneMode = true;
  assert.equal(seatToRestore(ROOM_SEAT_GRACE_MS, t0 + 1000)?.code, 'BCDF');
  standaloneMode = false;
  // Replaced by another tab: only this tab forgets; leave forgets everywhere.
  rememberSeat('BCDF', t0);
  forgetSeat(true);
  assert.equal(sessionStorage.getItem(ROOM_SEAT_STORAGE_KEY), null);
  assert.notEqual(localStorage.getItem(ROOM_SEAT_STORAGE_KEY), null);
  forgetSeat();
  assert.equal(localStorage.getItem(ROOM_SEAT_STORAGE_KEY), null);
  // Junk is ignored.
  sessionStorage.setItem(ROOM_SEAT_STORAGE_KEY, '{"code":5}');
  assert.equal(seatToRestore(ROOM_SEAT_GRACE_MS, t0), null);
});
