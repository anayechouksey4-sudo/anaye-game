import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SquadControls } from '../../shared/protocol';
import { ControlsThrottle, type ThrottleClock } from '../src/net/controlsThrottle';

/** Deterministic clock: timers fire only when advance() passes their due time. */
function fakeClock() {
  let now = 1_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ThrottleClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { clock, advance, pending: () => timers.size };
}

const c = (frontWingAero: number, engineTier = 3, chassisBalance = 0): SquadControls => ({
  frontWingAero,
  engineTier,
  chassisBalance,
});

describe('ControlsThrottle', () => {
  it('sends the first value immediately and at most once per interval while dragging', () => {
    const { clock, advance } = fakeClock();
    const sent: { at: number; v: SquadControls }[] = [];
    const throttle = new ControlsThrottle((v) => (sent.push({ at: clock.now(), v }), true), 33, clock);

    // 60 Hz drag for one second: a new value every ~16.7 ms.
    for (let i = 0; i <= 60; i++) {
      throttle.push(c(i));
      advance(1000 / 60);
    }
    advance(100);

    assert.deepEqual(sent[0]?.v, c(0));
    for (let i = 1; i < sent.length; i++) {
      assert.ok(sent[i]!.at - sent[i - 1]!.at >= 33 - 1e-9, `gap ${sent[i]!.at - sent[i - 1]!.at} ms`);
    }
    assert.ok(sent.length <= 32, `${sent.length} frames in ~1 s`);
    assert.deepEqual(sent.at(-1)?.v, c(60), 'trailing send carries the final value');
  });

  it('never drops the trailing value even when the drag stops mid-window', () => {
    const { clock, advance } = fakeClock();
    const sent: SquadControls[] = [];
    const throttle = new ControlsThrottle((v) => (sent.push(v), true), 33, clock);
    throttle.push(c(10));
    advance(5);
    throttle.push(c(11));
    throttle.push(c(12));
    assert.deepEqual(sent, [c(10)]);
    advance(40);
    assert.deepEqual(sent, [c(10), c(12)]);
  });

  it('flush sends now, cancels the pending trailing send, and skips exact duplicates', () => {
    const { clock, advance, pending } = fakeClock();
    const sent: SquadControls[] = [];
    const throttle = new ControlsThrottle((v) => (sent.push(v), true), 33, clock);
    throttle.push(c(20));
    throttle.push(c(21));
    assert.equal(pending(), 1);
    throttle.flush(c(22));
    assert.equal(pending(), 0);
    assert.deepEqual(sent, [c(20), c(22)]);
    throttle.flush(c(22));
    assert.deepEqual(sent, [c(20), c(22)], 'identical value already on the wire');
    advance(100);
    assert.deepEqual(sent, [c(20), c(22)]);
  });

  it('force always sends; a failed send is retried by the next flush', () => {
    const { clock } = fakeClock();
    const sent: SquadControls[] = [];
    let online = false;
    const throttle = new ControlsThrottle((v) => (online ? (sent.push(v), true) : false), 33, clock);
    throttle.flush(c(30));
    assert.deepEqual(sent, []);
    online = true;
    throttle.flush(c(30));
    assert.deepEqual(sent, [c(30)]);
    throttle.force(c(30));
    assert.deepEqual(sent, [c(30), c(30)]);
  });

  it('reset forgets the last value so a new connection re-sends it', () => {
    const { clock } = fakeClock();
    const sent: SquadControls[] = [];
    const throttle = new ControlsThrottle((v) => (sent.push(v), true), 33, clock);
    throttle.flush(c(40));
    throttle.reset();
    throttle.flush(c(40));
    assert.equal(sent.length, 2);
  });
});
