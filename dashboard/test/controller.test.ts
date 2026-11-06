import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { BIG_JUMP_LIP_KMH, mapSquadControlsToPhysics, type SquadControls } from '../../shared/protocol';
import { SquadController } from '../src/squad/controller';
import { FakeSocket } from './fakeSocket';

const PEERS = { game: 1, dashboard: 1, observer: 0 };
const CONTROLS: SquadControls = { frontWingAero: 20, engineTier: 5, chassisBalance: -20 };

function welcome(snapshot: object, peers = PEERS) {
  return {
    type: 'server:welcome',
    clientId: 'd1',
    role: 'dashboard',
    protocolVersion: 1,
    peers,
    snapshot: { controls: null, physics: null, telemetry: null, ...snapshot },
  };
}

function gameState(carId: string | undefined, extra: object = {}) {
  return {
    type: 'game:state',
    physics: mapSquadControlsToPhysics(CONTROLS, carId),
    controls: CONTROLS,
    ...(carId === undefined ? null : { carId }),
    ...extra,
  };
}

function setup() {
  const controller = new SquadController({ clientName: 'test', createSocket: (url) => new FakeSocket(url) });
  controller.connect('relay');
  const socket = FakeSocket.all.at(-1)!;
  socket.accept();
  return { controller, socket, session: () => controller.game.getState().session };
}

describe('SquadController session (car + map)', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  });
  afterEach(() => mock.timers.reset());

  it('starts on the default hypercar / chaos session and keeps it for an empty relay', () => {
    const t = setup();
    t.socket.deliver(welcome({}));
    assert.deepEqual(t.session(), { carId: 'hypercar', trackId: 'chaos', bigJumpKmh: BIG_JUMP_LIP_KMH, source: 'default' });
    t.controller.dispose();
  });

  it("adopts the relay's snapshot.session on connect", () => {
    const t = setup();
    t.socket.deliver(
      welcome({ physics: mapSquadControlsToPhysics(CONTROLS, 'muscle'), session: { carId: 'muscle', trackId: 'isles', bigJumpKmh: 163 } }),
    );
    assert.deepEqual(t.session(), { carId: 'muscle', trackId: 'isles', bigJumpKmh: 163, source: 'snapshot' });
    t.controller.dispose();
  });

  it('follows live game:state as the player switches car and map', () => {
    const t = setup();
    t.socket.deliver(welcome({}));
    t.socket.deliver(gameState('rally', { trackId: 'chaos', bigJumpKmh: 183 }));
    assert.deepEqual(t.session(), { carId: 'rally', trackId: 'chaos', bigJumpKmh: 183, source: 'game' });
    assert.deepEqual(t.controller.game.getState().appliedPhysics, mapSquadControlsToPhysics(CONTROLS, 'rally'));

    t.socket.deliver(gameState('formula', { trackId: 'strip', bigJumpKmh: null }));
    assert.deepEqual(t.session(), { carId: 'formula', trackId: 'strip', bigJumpKmh: null, source: 'game' });

    // Same session again: the store keeps its reference, so subscribed cards don't re-render.
    const before = t.session();
    t.socket.deliver(gameState('formula', { trackId: 'strip', bigJumpKmh: null }));
    assert.equal(t.session(), before);
    t.controller.dispose();
  });

  it('keeps the last known car when the game drops off the relay', () => {
    const t = setup();
    t.socket.deliver(welcome({}));
    t.socket.deliver(gameState('buggy', { trackId: 'cryo', bigJumpKmh: null }));
    t.socket.deliver({ type: 'server:presence', peers: { game: 0, dashboard: 1, observer: 0 } });
    assert.equal(t.session().carId, 'buggy');
    assert.equal(t.session().trackId, 'cryo');
    t.controller.dispose();
  });

  it('treats a game:state without session fields (pre-garage game) as the hypercar with the 183 km/h lip', () => {
    const t = setup();
    t.socket.deliver(welcome({ session: { carId: 'rally', trackId: 'strip', bigJumpKmh: null } }));
    t.socket.deliver(gameState(undefined));
    assert.deepEqual(t.session(), { carId: 'hypercar', trackId: null, bigJumpKmh: BIG_JUMP_LIP_KMH, source: 'game' });
    t.controller.dispose();
  });

  it('a relay snapshot with physics but no session (pre-garage game or relay) also means the hypercar', () => {
    const t = setup();
    t.socket.deliver(welcome({ physics: mapSquadControlsToPhysics(CONTROLS) }));
    assert.deepEqual(t.session(), { carId: 'hypercar', trackId: null, bigJumpKmh: BIG_JUMP_LIP_KMH, source: 'snapshot' });
    t.controller.dispose();
  });

  it('ignores a game:state whose ids are malformed (parseMessage rejects the frame)', () => {
    const t = setup();
    t.socket.deliver(welcome({}));
    t.socket.deliver(gameState('not a valid id!', { trackId: 'chaos' }));
    assert.equal(t.session().source, 'default');
    assert.equal(t.controller.game.getState().appliedPhysics, null);
    t.controller.dispose();
  });
});

describe('SquadController speed trap (jump outcome from telemetry)', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  });
  afterEach(() => mock.timers.reset());

  const frame = (speedTrapKmh: number | null, falls: number, finished: boolean) => ({
    speedKmh: 150,
    wheelsGrounded: 0,
    checkpoint: 5,
    totalCheckpoints: 6,
    elapsedMs: 40_000,
    falls,
    finished,
    bestMs: null,
    speedTrapKmh,
  });
  const telemetry = (speedTrapKmh: number | null, falls: number, finished: boolean) => ({
    type: 'game:telemetry',
    telemetry: frame(speedTrapKmh, falls, finished),
  });

  it('settles CLEARED on the finish and SHORT on a fall, and a restart clears it', () => {
    const t = setup();
    const jump = () => t.controller.telemetry.getState().jump;
    t.socket.deliver(welcome({}));
    assert.equal(jump(), null);
    t.socket.deliver(telemetry(null, 0, false));
    t.socket.deliver(telemetry(161.6, 0, false));
    assert.deepEqual(jump(), { trapKmh: 161.6, falls: 0, outcome: 'pending' });
    const inAir = jump();
    t.socket.deliver(telemetry(161.6, 0, false));
    assert.equal(jump(), inAir, 'same object between frames');
    t.socket.deliver(telemetry(161.6, 0, true));
    assert.equal(jump()?.outcome, 'cleared');

    t.socket.deliver(telemetry(null, 0, false)); // restart
    assert.equal(jump(), null);
    t.socket.deliver(telemetry(183, 0, false));
    t.socket.deliver(telemetry(183, 1, false));
    assert.deepEqual(jump(), { trapKmh: 183, falls: 0, outcome: 'short' });
    t.controller.dispose();
  });

  it("judges the relay's snapshot telemetry for a dashboard that joins mid-run", () => {
    const finished = setup();
    finished.socket.deliver(welcome({ telemetry: frame(188.1, 0, true) }));
    assert.deepEqual(finished.controller.telemetry.getState().jump, { trapKmh: 188.1, falls: 0, outcome: 'cleared' });
    finished.controller.dispose();

    const inAir = setup();
    inAir.socket.deliver(welcome({ telemetry: frame(183, 0, false) }));
    assert.equal(inAir.controller.telemetry.getState().jump?.outcome, 'pending');
    inAir.socket.deliver(telemetry(183, 1, false));
    assert.equal(inAir.controller.telemetry.getState().jump?.outcome, 'short');
    inAir.controller.dispose();
  });
});
