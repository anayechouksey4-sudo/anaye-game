import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { RECONNECT_MAX_MS, RECONNECT_MIN_MS, type ProtocolMessage } from '../../shared/protocol';
import { SquadLink, type LinkState, type SocketLike } from '../src/net/squadLink';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // server side
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(message: object) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}

function setup() {
  const states: LinkState[] = [];
  const messages: ProtocolMessage[] = [];
  const latencies: number[] = [];
  let opens = 0;
  const link = new SquadLink(
    {
      onState: (s) => states.push(s),
      onOpen: () => opens++,
      onMessage: (m) => messages.push(m),
      onLatency: (ms) => latencies.push(ms),
    },
    { name: 'test', createSocket: (url) => new FakeSocket(url), random: () => 0.5, now: () => Date.now() },
  );
  return { link, states, messages, latencies, opens: () => opens, last: () => states.at(-1)! };
}

describe('SquadLink', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  });
  afterEach(() => mock.timers.reset());

  it('connects as role=dashboard, says hello, pings, and measures latency', () => {
    const t = setup();
    t.link.connect('192.168.1.9');
    const socket = FakeSocket.all[0]!;
    assert.equal(socket.url, 'ws://192.168.1.9:8787?role=dashboard');
    assert.equal(t.last().status, 'connecting');
    socket.accept();
    assert.equal(t.last().status, 'online');
    assert.equal(socket.sent[0]?.type, 'hello');
    assert.equal(socket.sent[0]?.role, 'dashboard');
    const ping = socket.sent.find((m) => m.type === 'ping');
    assert.ok(ping);
    mock.timers.tick(12);
    socket.deliver({ type: 'pong', nonce: ping.nonce, serverTime: Date.now() });
    assert.deepEqual(t.latencies, [12]);
    socket.deliver({ type: 'server:presence', peers: { game: 1, dashboard: 1, observer: 0 } });
    socket.deliver({ type: 'squad:controls', controls: { frontWingAero: 'nope' } });
    assert.deepEqual(
      t.messages.map((m) => m.type),
      ['server:presence'],
      'invalid frames are dropped by parseMessage',
    );
  });

  it('reconnects with exponential backoff and jitter, then resets after a good open', () => {
    const t = setup();
    t.link.connect('ws://relay:8787');
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      FakeSocket.all.at(-1)!.drop();
      const state = t.last();
      assert.equal(state.status, 'retrying');
      const delay = state.retryAt! - Date.now();
      delays.push(delay);
      mock.timers.tick(delay);
    }
    const expected = [0, 1, 2, 3, 4, 5].map((n) => Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** n));
    assert.deepEqual(delays, expected, 'random()=0.5 → no jitter offset');
    FakeSocket.all.at(-1)!.accept();
    assert.equal(t.last().attempt, 0);
  });

  it('stays down after disconnect()', () => {
    const t = setup();
    t.link.connect('relay');
    FakeSocket.all[0]!.accept();
    t.link.disconnect();
    assert.equal(FakeSocket.all[0]!.closedWith, 1000);
    assert.equal(t.last().status, 'offline');
    mock.timers.tick(60_000);
    assert.equal(FakeSocket.all.length, 1);
  });

  it('drops a silent (half-open) socket and a socket stuck connecting', () => {
    const t = setup();
    t.link.connect('relay');
    mock.timers.tick(8_000);
    assert.equal(t.last().status, 'retrying');
    assert.equal(t.last().error, 'Connection timed out');
    mock.timers.tick(t.last().retryAt! - Date.now());
    const second = FakeSocket.all[1]!;
    second.accept();
    mock.timers.tick(8_000); // pings go unanswered
    assert.equal(second.closedWith, 4000);
    assert.equal(t.last().status, 'retrying');
  });

  it('wake() retries immediately instead of waiting out the backoff', () => {
    const t = setup();
    t.link.connect('relay');
    FakeSocket.all[0]!.drop();
    assert.equal(t.last().status, 'retrying');
    t.link.wake();
    assert.equal(FakeSocket.all.length, 2);
    assert.equal(t.last().status, 'connecting');
  });
});
