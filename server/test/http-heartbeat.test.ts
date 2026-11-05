import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { PROTOCOL_VERSION } from '../../shared/protocol';
import type { RelayServer } from '../src/relay';
import { TestClient, connect, startRelay } from './helpers';

let relay: RelayServer | undefined;
let clients: TestClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await relay?.close();
  relay = undefined;
});

describe('http', () => {
  it('GET /health reports ok, protocol version, peers, snapshot and uptime', async () => {
    relay = await startRelay();
    const dash = await connect(relay, 'dashboard');
    clients.push(dash);
    dash.send({ type: 'squad:controls', controls: { frontWingAero: 30, engineTier: 5, chassisBalance: 12 } });
    await dash.sync();

    const res = await fetch(`http://127.0.0.1:${relay.port}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(body.peers, { game: 0, dashboard: 1, observer: 0 });
    assert.deepEqual(body.snapshot, {
      controls: { frontWingAero: 30, engineTier: 5, chassisBalance: 12 },
      physics: null,
      telemetry: null,
    });
    assert.equal(typeof body.uptimeSec, 'number');
  });

  it('GET / serves an info page; unknown paths 404; other methods 405', async () => {
    relay = await startRelay();
    const base = `http://127.0.0.1:${relay.port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SquadHQ relay/);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    const post = await fetch(`${base}/health`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  });
});

describe('heartbeat', () => {
  it('terminates a client that stops answering pings and tells the others', async () => {
    relay = await startRelay({ heartbeatMs: 100 });
    const healthy = await connect(relay, 'dashboard');
    clients.push(healthy);
    const silent = new TestClient(`ws://127.0.0.1:${relay.port}/?role=game`, { autoPong: false });
    clients.push(silent);
    await silent.waitForWelcome();
    const closed = silent.closed(3000);

    // Terminated (no closing handshake) → the client sees 1006.
    assert.equal((await closed).code, 1006);
    const presence = await healthy.take('server:presence', (m) => m.peers.game === 0);
    assert.deepEqual(presence.peers, { game: 0, dashboard: 1, observer: 0 });
    assert.equal(relay.stats().counters.heartbeatTerminations, 1);

    // The responsive client survives several more heartbeat rounds.
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(healthy.ws.readyState, healthy.ws.OPEN);
    await healthy.sync();
  });
});
