import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ClientRole, type SquadControls } from '../../shared/protocol';
import type { RelayServer } from '../src/relay';
import { TestClient, connect, sampleTelemetry, startRelay } from './helpers';

let relay: RelayServer;
let clients: TestClient[] = [];

async function join(role?: ClientRole | string, path?: string): Promise<TestClient> {
  const client = await connect(relay, role, path);
  clients.push(client);
  return client;
}

/** Parses the raw relayed frame of `type` (to check exactly what went over the wire). */
function rawFrame(client: TestClient, type: string): Record<string, unknown> {
  const frame = client.raw.map((r) => JSON.parse(r) as Record<string, unknown>).find((f) => f.type === type);
  assert.ok(frame, `no raw ${type} frame`);
  return frame;
}

const controls: SquadControls = { frontWingAero: 80, engineTier: 4, chassisBalance: -10 };

beforeEach(async () => {
  relay = await startRelay();
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await relay.close();
});

describe('welcome and roles', () => {
  it('welcomes with clientId, role, protocol version, snapshot and peers that include the newcomer', async () => {
    const game = await join('game');
    const w = game.welcome;
    assert.match(w.clientId, /^c\d+$/);
    assert.equal(w.role, 'game');
    assert.equal(w.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(w.snapshot, { controls: null, physics: null, telemetry: null });
    assert.deepEqual(w.peers, { game: 1, dashboard: 0, observer: 0 });
    const raw = rawFrame(game, 'server:welcome');
    assert.equal(raw.v, PROTOCOL_VERSION);
    assert.equal(raw.from, undefined);
  });

  it('takes the role from ?role=, defaults to observer, ignores unknown roles and accepts any path', async () => {
    const plain = await join();
    const bogus = await join('pilot');
    const pathed = await join('dashboard', '/squad/hq/');
    assert.equal(plain.welcome.role, 'observer');
    assert.equal(bogus.welcome.role, 'observer');
    assert.equal(pathed.welcome.role, 'dashboard');
    assert.equal(new Set([plain, bogus, pathed].map((c) => c.welcome.clientId)).size, 3);
  });
});

describe('presence', () => {
  it('broadcasts to everyone, including the newcomer, on join and to the rest on leave', async () => {
    const dash = await join('dashboard');
    assert.deepEqual(dash.joinPresence?.peers, { game: 0, dashboard: 1, observer: 0 });
    const game = await join('game');
    assert.deepEqual(game.joinPresence?.peers, { game: 1, dashboard: 1, observer: 0 });
    assert.deepEqual((await dash.take('server:presence')).peers, { game: 1, dashboard: 1, observer: 0 });

    await game.close();
    assert.deepEqual((await dash.take('server:presence')).peers, { game: 0, dashboard: 1, observer: 0 });
  });

  it('hello changes the role: re-sends welcome to the sender and broadcasts presence', async () => {
    const a = await join();
    const b = await join();
    a.send({ type: 'hello', role: 'game', name: 'Racer One' });
    const again = await a.take('server:welcome');
    assert.equal(again.role, 'game');
    assert.equal(again.clientId, a.welcome.clientId);
    assert.deepEqual(again.peers, { game: 1, dashboard: 0, observer: 1 });
    const afterHello = (m: { peers: { game: number } }): boolean => m.peers.game === 1;
    assert.deepEqual((await b.take('server:presence', afterHello)).peers, { game: 1, dashboard: 0, observer: 1 });
    assert.deepEqual((await a.take('server:presence', afterHello)).peers, { game: 1, dashboard: 0, observer: 1 });
    assert.equal(relay.stats().clients.find((c) => c.id === a.welcome.clientId)?.name, 'Racer One');
  });

  it('hello is never relayed', async () => {
    const a = await join();
    const b = await join('game');
    a.send({ type: 'hello', role: 'dashboard' });
    await a.take('server:welcome');
    await b.sync();
    assert.equal(b.count('hello'), 0);
  });
});

describe('routing (RELAY_RULES)', () => {
  it('squad:controls → every other client, stored as snapshot.controls', async () => {
    const dash = await join('dashboard');
    const game = await join('game');
    const obs = await join('observer');
    const dash2 = await join('dashboard');
    dash.send({ type: 'squad:controls', controls });

    for (const receiver of [game, obs, dash2]) {
      const m = await receiver.take('squad:controls');
      assert.deepEqual(m.controls, controls);
      assert.equal(m.from, dash.welcome.clientId);
    }
    await dash.sync();
    assert.equal(dash.count('squad:controls'), 0, 'sender must not get its own frame back');
    assert.deepEqual(relay.stats().snapshot.controls, controls);
  });

  it('physics:set → every other client, not stored', async () => {
    const obs = await join('observer');
    const game = await join('game');
    const dash = await join('dashboard');
    obs.send({ type: 'physics:set', params: { traction: 0.6, drag: 8 } });

    for (const receiver of [game, dash]) {
      const m = await receiver.take('physics:set');
      assert.deepEqual(m.params, { traction: 0.6, drag: 8 });
      assert.equal(m.from, obs.welcome.clientId);
    }
    await obs.sync();
    assert.equal(obs.count('physics:set'), 0);
    assert.equal(relay.stats().snapshot.physics, null);
  });

  it('game:state → non-game clients only, stored as snapshot.physics', async () => {
    const game = await join('game');
    const game2 = await join('game');
    const dash = await join('dashboard');
    const obs = await join('observer');
    const physics = { mass: 1200, traction: 1.45, drag: 4, frontDownforce: 3.25, engineTorque: 2100, balance: 0 };
    game.send({ type: 'game:state', physics, controls });

    for (const receiver of [dash, obs]) {
      const m = await receiver.take('game:state');
      assert.deepEqual(m.physics, physics);
      assert.deepEqual(m.controls, controls);
      assert.equal(m.from, game.welcome.clientId);
    }
    await game.sync();
    await game2.sync();
    assert.equal(game.count('game:state'), 0);
    assert.equal(game2.count('game:state'), 0, 'other games must not receive game:state');
    assert.deepEqual(relay.stats().snapshot.physics, physics);
  });

  it('game:telemetry → non-game clients only, stored as snapshot.telemetry', async () => {
    const game = await join('game');
    const game2 = await join('game');
    const dash = await join('dashboard');
    const obs = await join('observer');
    game.sendRaw(
      JSON.stringify({
        type: 'game:telemetry',
        telemetry: { ...sampleTelemetry, throttle: 1, noseLift: true, speedTrapKmh: 187 },
      }),
    );

    for (const receiver of [dash, obs]) {
      const m = await receiver.take('game:telemetry');
      assert.equal(m.telemetry.speedKmh, 123.4);
      assert.equal(m.telemetry.noseLift, true);
      assert.equal(m.telemetry.speedTrapKmh, 187);
      assert.equal(m.from, game.welcome.clientId);
    }
    await game.sync();
    await game2.sync();
    assert.equal(game.count('game:telemetry'), 0);
    assert.equal(game2.count('game:telemetry'), 0);
    assert.equal(relay.stats().snapshot.telemetry?.speedKmh, 123.4);
  });

  it('ping → pong to the sender only, echoing the nonce', async () => {
    const a = await join('dashboard');
    const b = await join('game');
    const before = Date.now();
    a.send({ type: 'ping', nonce: 4242 });
    const pong = await a.take('pong');
    assert.equal(pong.nonce, 4242);
    assert.ok(pong.serverTime >= before && pong.serverTime <= Date.now());
    await b.sync();
    assert.equal(b.received.filter((m) => m.type === 'pong' && m.nonce === 4242).length, 0);
  });
});

describe('snapshot', () => {
  it('a late-joining game gets snapshot.controls even after the dashboard disconnected', async () => {
    const dash = await join('dashboard');
    dash.send({ type: 'squad:controls', controls });
    await dash.sync();
    await dash.close();

    const game = await join('game');
    assert.deepEqual(game.welcome.snapshot.controls, controls);
  });

  it('a late-joining dashboard gets the last physics and telemetry after the game left', async () => {
    const game = await join('game');
    const physics = { mass: 1290, traction: 1.45, drag: 3, frontDownforce: 1.625, engineTorque: 3200, balance: 0.2 };
    game.send({ type: 'game:state', physics, controls: null });
    game.sendRaw(JSON.stringify({ type: 'game:telemetry', telemetry: sampleTelemetry }));
    await game.sync();
    await game.close();

    const dash = await join('dashboard');
    assert.deepEqual(dash.welcome.snapshot.physics, physics);
    assert.equal(dash.welcome.snapshot.telemetry?.elapsedMs, sampleTelemetry.elapsedMs);
  });
});

describe('car / map session (game:state carId, trackId, bigJumpKmh)', () => {
  const physics = { mass: 1020, traction: 1.7, drag: 2.97, frontDownforce: 0.25, engineTorque: 2640, balance: -1 };

  it('relays the session fields, keeps them in snapshot.session for late dashboards', async () => {
    const game = await join('game');
    const dash = await join('dashboard');
    game.send({ type: 'game:state', physics, controls, carId: 'rally', trackId: 'chaos', bigJumpKmh: 183 });
    const m = await dash.take('game:state');
    assert.equal(m.carId, 'rally');
    assert.equal(m.trackId, 'chaos');
    assert.equal(m.bigJumpKmh, 183);
    // A map without a big jump reports null, which is stored as-is.
    game.send({ type: 'game:state', physics, controls, carId: 'buggy', trackId: 'test', bigJumpKmh: null });
    await dash.take('game:state');
    assert.deepEqual(relay.stats().snapshot.session, { carId: 'buggy', trackId: 'test', bigJumpKmh: null });
    const late = await join('dashboard');
    assert.deepEqual(late.welcome.snapshot.session, { carId: 'buggy', trackId: 'test', bigJumpKmh: null });
  });

  it('old games (no session fields) still relay and leave the snapshot without a session', async () => {
    const game = await join('game');
    const dash = await join('dashboard');
    game.send({ type: 'game:state', physics, controls: null });
    const m = await dash.take('game:state');
    assert.equal('carId' in m, false);
    assert.equal(relay.stats().snapshot.session, undefined);
  });

  it('rejects a game:state whose session fields are junk', async () => {
    const game = await join('game');
    const dash = await join('dashboard');
    for (const junk of [{ carId: 42 }, { carId: '../../etc' }, { trackId: 'x'.repeat(33) }, { bigJumpKmh: 'fast' }, { bigJumpKmh: -5 }]) {
      game.sendRaw(JSON.stringify({ type: 'game:state', physics, controls: null, ...junk }));
      const err = await game.take('server:error');
      assert.equal(err.code, 'bad_message');
    }
    await dash.sync();
    assert.equal(dash.count('game:state'), 0);
  });
});

describe('sanitization', () => {
  it('relays a clamped, snapped copy with unknown fields stripped and `from` set by the server', async () => {
    const dash = await join('dashboard');
    const game = await join('game');
    dash.sendRaw(
      JSON.stringify({
        type: 'squad:controls',
        v: 1,
        seq: 7,
        from: 'spoofed',
        junk: true,
        controls: { frontWingAero: 150, engineTier: 2.6, chassisBalance: -99, turbo: 9 },
      }),
    );
    await game.take('squad:controls');
    assert.deepEqual(rawFrame(game, 'squad:controls'), {
      type: 'squad:controls',
      v: 1,
      seq: 7,
      from: dash.welcome.clientId,
      controls: { frontWingAero: 100, engineTier: 3, chassisBalance: -50 },
    });
  });

  it('clamps physics:set params into CAR_PHYSICS_SPECS and drops unknown keys', async () => {
    const obs = await join();
    const game = await join('game');
    obs.sendRaw(JSON.stringify({ type: 'physics:set', params: { traction: 99, drag: -5, engineForce: 10 } }));
    await game.take('physics:set');
    assert.deepEqual(rawFrame(game, 'physics:set').params, { traction: 4, drag: 0 });
  });

  it('fills the optional race telemetry channels with defaults and clamps them', async () => {
    const game = await join('game');
    const dash = await join('dashboard');
    game.sendRaw(JSON.stringify({ type: 'game:telemetry', telemetry: sampleTelemetry }));
    await dash.take('game:telemetry');
    const first = rawFrame(dash, 'game:telemetry').telemetry as Record<string, unknown>;
    assert.deepEqual(
      {
        throttle: first.throttle,
        brake: first.brake,
        frontAeroN: first.frontAeroN,
        rearAeroN: first.rearAeroN,
        noseLift: first.noseLift,
        rearSlip: first.rearSlip,
        speedTrapKmh: first.speedTrapKmh,
      },
      { throttle: 0, brake: 0, frontAeroN: 0, rearAeroN: 0, noseLift: false, rearSlip: 0, speedTrapKmh: null },
    );

    game.sendRaw(
      JSON.stringify({
        type: 'game:telemetry',
        telemetry: { ...sampleTelemetry, throttle: 3, rearSlip: -1, wheelsGrounded: 9, noseLift: 'yes', secret: 1 },
      }),
    );
    const second = await dash.take('game:telemetry');
    assert.equal(second.telemetry.throttle, 1);
    assert.equal(second.telemetry.rearSlip, 0);
    assert.equal(second.telemetry.wheelsGrounded, 4);
    assert.equal(second.telemetry.noseLift, false);
    assert.equal('secret' in second.telemetry, false);
  });
});

describe('bad input', () => {
  it('answers invalid JSON with bad_message and keeps the socket open', async () => {
    const c = await join('dashboard');
    c.sendRaw('{not json');
    const err = await c.take('server:error');
    assert.equal(err.code, 'bad_message');
    await c.sync();
    assert.equal(c.ws.readyState, c.ws.OPEN);
  });

  it('rejects malformed shapes, unknown types, wrong versions, non-objects and binary frames', async () => {
    const c = await join('dashboard');
    const other = await join('game');
    const frames = [
      JSON.stringify({ type: 'squad:controls', controls: { frontWingAero: 50, engineTier: 3 } }),
      JSON.stringify({ type: 'squad:controls', controls: { frontWingAero: '50', engineTier: 3, chassisBalance: 0 } }),
      JSON.stringify({ type: 'teleport', x: 1 }),
      JSON.stringify({ type: 'squad:controls', v: 2, controls }),
      JSON.stringify({ controls }),
      JSON.stringify([1, 2, 3]),
      '42',
    ];
    for (const f of frames) c.sendRaw(f);
    c.sendRaw(Buffer.from(JSON.stringify({ type: 'squad:controls', controls })), true);

    for (let i = 0; i < frames.length + 1; i++) assert.equal((await c.take('server:error')).code, 'bad_message');
    await c.sync();
    await other.sync();
    assert.equal(other.count('squad:controls'), 0, 'nothing invalid may be relayed');
    assert.equal(relay.stats().counters.badFrames, frames.length + 1);
  });

  it('answers server:* and pong from clients with forbidden and relays nothing', async () => {
    const c = await join('dashboard');
    const other = await join('observer');
    const frames = [
      { type: 'server:welcome', clientId: 'x', role: 'game', protocolVersion: 1, snapshot: {}, peers: {} },
      { type: 'server:presence', peers: { game: 9, dashboard: 9, observer: 9 } },
      { type: 'server:error', code: 'forbidden', message: 'fake' },
      { type: 'server:anything' },
      { type: 'pong', nonce: 1, serverTime: 1 },
    ];
    for (const f of frames) c.sendRaw(JSON.stringify(f));
    for (let i = 0; i < frames.length; i++) assert.equal((await c.take('server:error')).code, 'forbidden');
    await c.sync();
    await other.sync();
    assert.equal(other.count('server:error'), 0);
    assert.equal(other.received.filter((m) => m.type === 'server:presence' && m.peers.game === 9).length, 0);
  });

  it('closes with 1008 after 20 consecutive bad frames', async () => {
    const c = await join('dashboard');
    const closed = c.closed();
    for (let i = 0; i < 20; i++) c.sendRaw('nope');
    assert.equal((await closed).code, 1008);
  });

  it('a valid frame resets the consecutive bad-frame counter', async () => {
    const c = await join('dashboard');
    for (let i = 0; i < 19; i++) c.sendRaw('nope');
    await c.sync();
    for (let i = 0; i < 19; i++) c.sendRaw('nope');
    await c.sync();
    assert.equal(c.ws.readyState, c.ws.OPEN);
    assert.equal(c.count('server:error'), 38);
  });

  it(`closes with 1009 when a frame exceeds MAX_MESSAGE_BYTES (${MAX_MESSAGE_BYTES})`, async () => {
    const c = await join('dashboard');
    const closed = c.closed();
    c.sendRaw(JSON.stringify({ type: 'ping', nonce: 1, pad: 'x'.repeat(MAX_MESSAGE_BYTES) }));
    assert.equal((await closed).code, 1009);
  });
});

describe('rate limiting', () => {
  it('drops frames beyond the token bucket and reports rate_limited at most once per second', async () => {
    const dash = await join('dashboard');
    const game = await join('game');
    for (let i = 0; i < 400; i++) {
      dash.send({ type: 'squad:controls', controls: { ...controls, frontWingAero: i % 101 } });
    }
    const err = await dash.take('server:error');
    assert.equal(err.code, 'rate_limited');

    await new Promise((resolve) => setTimeout(resolve, 100)); // let a token refill for the sync ping
    await dash.sync();
    await game.sync();
    const relayed = game.count('squad:controls');
    // 240 burst + whatever refilled (120/s) while the relay worked through the backlog.
    assert.ok(relayed >= 240 && relayed <= 360, `expected ~240 relayed frames, got ${relayed}`);
    assert.equal(dash.count('server:error'), 0, 'only one rate_limited error per second');
    assert.equal(relay.stats().counters.rateLimitedFrames, 400 - relayed);
  });
});

describe('shutdown', () => {
  it('close() disconnects clients with 1001 and is idempotent', async () => {
    const c = await join('game');
    const closed = c.closed();
    await Promise.all([relay.close(), relay.close()]);
    assert.equal((await closed).code, 1001);
  });
});
