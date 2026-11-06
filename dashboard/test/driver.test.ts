/**
 * Driver / ride names on the wire (game:state driverName / rideName) and in the dashboard's session:
 *   - the protocol decoder keeps a clean name, cleans a dirty one (controls, bidi, markup, length),
 *     drops an empty one and rejects a non-string;
 *   - mergeSession keeps the driver across messages that omit it, treats a missing rideName as the
 *     stock car, and a pre-garage game:state carries neither;
 *   - the On track line text shows the driver when present and nothing when absent.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SQUAD_CONTROLS, MAX_DISPLAY_TEXT, mapSquadControlsToPhysics, parseMessage, sanitizeDisplayText, type GameStateMessage } from '../../shared/protocol';
import { DEFAULT_SESSION, driverLine, mergeSession, sessionEqual, sessionInfoOf } from '../src/squad/session';

const PHYSICS = mapSquadControlsToPhysics(DEFAULT_SQUAD_CONTROLS);

function state(extra: Record<string, unknown>): GameStateMessage | null {
  const msg = parseMessage(JSON.stringify({ v: 1, type: 'game:state', physics: PHYSICS, controls: null, carId: 'hypercar', trackId: 'chaos', bigJumpKmh: 183, ...extra }));
  return msg && msg.type === 'game:state' ? msg : null;
}

describe('driver and ride names in game:state', () => {
  it('keeps clean names and leaves absent ones absent', () => {
    const msg = state({ driverName: 'Anaye', rideName: 'Ember GT' });
    assert.ok(msg);
    assert.equal(msg.driverName, 'Anaye');
    assert.equal(msg.rideName, 'Ember GT');
    const plain = state({});
    assert.ok(plain);
    assert.equal('driverName' in plain, false);
    assert.equal('rideName' in plain, false);
  });

  it('cleans a dirty name: controls, bidi overrides, markup, runs of spaces, 14 code points', () => {
    assert.equal(sanitizeDisplayText('‮evil​<b>x'), 'evilbx');
    assert.equal(sanitizeDisplayText('  Zoë   🚗  '), 'Zoë 🚗');
    assert.equal(sanitizeDisplayText('अनय'), 'अनय');
    assert.equal([...sanitizeDisplayText('a'.repeat(40))!].length, MAX_DISPLAY_TEXT);
    assert.equal([...sanitizeDisplayText('🚗'.repeat(30))!].length, MAX_DISPLAY_TEXT, 'code points, not UTF-16 units');
    assert.equal(sanitizeDisplayText(''), '');
    assert.equal(sanitizeDisplayText(42), null);
    const msg = state({ driverName: '\u0000‮ Anaye<script>', rideName: '   ' });
    assert.ok(msg, 'a dirty but string name does not reject the message');
    assert.equal(msg.driverName, 'Anayescript');
    assert.equal('rideName' in msg, false, 'an empty name is left out');
  });

  it('rejects a non-string name like a malformed id', () => {
    assert.equal(state({ driverName: 7 }), null);
    assert.equal(state({ rideName: { name: 'x' } }), null);
    assert.equal(state({ driverName: null }), null);
  });
});

describe('play session with a driver', () => {
  it('keeps the driver while a map loads and forgets the ride when it is left out', () => {
    const withBoth = mergeSession(DEFAULT_SESSION, { carId: 'coupe', trackId: 'isles', bigJumpKmh: 163, driverName: 'Anaye', rideName: 'Ember GT' }, 'game');
    assert.equal(withBoth.driverName, 'Anaye');
    assert.equal(withBoth.rideName, 'Ember GT');
    const loading = mergeSession(withBoth, { carId: 'coupe', driverName: 'Anaye' }, 'game');
    assert.equal(loading.trackId, 'isles');
    assert.equal(loading.driverName, 'Anaye');
    assert.equal('rideName' in loading, false, 'no rideName = stock car');
    const renamed = mergeSession(loading, { carId: 'coupe', driverName: 'Volt' }, 'game');
    assert.equal(renamed.driverName, 'Volt');
    const quiet = mergeSession(renamed, { carId: 'rally' }, 'game');
    assert.equal(quiet.driverName, 'Volt', 'a message without the field keeps the last driver');
    assert.ok(!sessionEqual(renamed, quiet));
    assert.ok(sessionEqual(quiet, { ...quiet }));
  });

  it('a pre-garage game:state (no session fields) carries no driver and no ride', () => {
    const before = mergeSession(DEFAULT_SESSION, { carId: 'coupe', driverName: 'Anaye', rideName: 'Ember GT' }, 'game');
    const old = mergeSession(before, {}, 'game');
    assert.equal('driverName' in old, false);
    assert.equal('rideName' in old, false);
    assert.deepEqual(sessionInfoOf({ carId: 'rally', driverName: 'Anaye', physics: {} } as never), { carId: 'rally', driverName: 'Anaye' });
  });

  it('the On track line shows the driver when present and nothing when absent', () => {
    assert.equal(driverLine(DEFAULT_SESSION, 'Neon Hypercar'), null);
    assert.equal(driverLine({ driverName: 'Anaye' }, 'Neon Hypercar'), 'DRIVER ANAYE');
    assert.equal(driverLine({ driverName: 'Anaye', rideName: 'Ember GT' }, 'Ember Swallowtail'), 'DRIVER ANAYE · MY RIDE "EMBER GT" (EMBER SWALLOWTAIL HANDLING)');
    assert.equal(driverLine({ rideName: 'Ember GT' }, 'Neon Hypercar'), 'MY RIDE "EMBER GT" (NEON HYPERCAR HANDLING)');
    assert.equal(driverLine({ driverName: '' }, 'Neon Hypercar'), null);
  });
});
