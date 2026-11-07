// Input composition, tilt mapping and gamepad reading (src/input/*, src/state/inputSettings.ts).
// Run: dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/input.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeInput, emptyPadFrame } from '../src/input/compose';
import { PAD_BUTTON, firstStandardPad, readPad, shapeStick, STICK_DEADZONE, type PadLike } from '../src/input/gamepad';
import { screenAngleOf, smoothTowards, TILT_DEADZONE_DEG, TILT_SMOOTHING_MS, tiltRollDeg, tiltSteer } from '../src/input/tilt';
import { DEFAULT_INPUT_SETTINGS, sanitizeInputSettings, TILT_MAX_DEG_MAX, TILT_MAX_DEG_MIN } from '../src/state/inputSettings';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);
const input = (p: Partial<{ throttle: number; brake: number; steer: number; handbrake: number }> = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, ...p });

// ── Composition ──────────────────────────────────────────────────────────────

test('compose: tilt off and no pad passes the touch input through unchanged', () => {
  const cases = [input(), input({ throttle: 1 }), input({ brake: 1, steer: -0.37 }), input({ handbrake: 1, steer: 1 }), input({ throttle: 1, brake: 1, steer: 0.5, handbrake: 1 })];
  for (const touch of cases) {
    const out = composeInput(touch, null, null, input());
    assert.deepEqual(out, touch);
  }
});

test('compose: tilt replaces the (hidden) pad steer, pedals untouched', () => {
  const out = composeInput(input({ throttle: 1, steer: 0.9 }), -0.4, null, input());
  assert.deepEqual(out, input({ throttle: 1, steer: -0.4 }));
  // Tilt on but inside its dead zone steers 0 even if the hidden pad reported something.
  assert.equal(composeInput(input({ steer: 0.9 }), 0, null, input()).steer, 0);
});

test('compose: stick outside its dead zone beats tilt and touch; pedals are the max; handbrake is any', () => {
  const pad = { ...emptyPadFrame(), steer: 0.25, throttle: 0.6, brake: 0.1, handbrake: true };
  const out = composeInput(input({ throttle: 0.2, brake: 1, steer: -1 }), 0.8, pad, input());
  assert.deepEqual(out, { throttle: 0.6, brake: 1, steer: 0.25, handbrake: 1 });
  // Stick at rest: tilt wins, then touch.
  const rest = { ...emptyPadFrame(), throttle: 1 };
  assert.equal(composeInput(input({ steer: -1 }), 0.3, rest, input()).steer, 0.3);
  assert.equal(composeInput(input({ steer: -1 }), null, rest, input()).steer, -1);
  assert.equal(composeInput(input({ steer: -1 }), null, rest, input()).throttle, 1);
});

test('compose: clamps to the pedal/steer ranges', () => {
  const pad = { ...emptyPadFrame(), steer: 3, throttle: 2, brake: -1 };
  const out = composeInput(input({ handbrake: 5 }), null, pad, input());
  assert.deepEqual(out, { throttle: 1, brake: 0, steer: 1, handbrake: 1 });
});

// ── Tilt mapping ─────────────────────────────────────────────────────────────

test('tilt: dead zone, linear ramp, full lock at maxDeg', () => {
  const m = { offsetDeg: 0, maxDeg: 22, invert: false };
  assert.equal(tiltSteer(0, m), 0);
  assert.equal(tiltSteer(TILT_DEADZONE_DEG, m), 0);
  assert.equal(tiltSteer(-TILT_DEADZONE_DEG, m), 0);
  near(tiltSteer(12, m), (12 - 2) / 20);
  near(tiltSteer(-12, m), -(12 - 2) / 20);
  assert.equal(tiltSteer(22, m), 1);
  assert.equal(tiltSteer(40, m), 1);
  assert.equal(tiltSteer(-90, m), -1);
  assert.equal(tiltSteer(Number.NaN, m), 0);
});

test('tilt: the setting range changes the ramp (14° quick, 35° gentle)', () => {
  near(tiltSteer(8, { offsetDeg: 0, maxDeg: 14, invert: false }), 6 / 12);
  near(tiltSteer(8, { offsetDeg: 0, maxDeg: 35, invert: false }), 6 / 33);
  assert.equal(tiltSteer(14, { offsetDeg: 0, maxDeg: 14, invert: false }), 1);
});

test('tilt: calibration offset shifts the neutral point; invert flips the sign', () => {
  const m = { offsetDeg: 10, maxDeg: 22, invert: false };
  assert.equal(tiltSteer(10, m), 0);
  assert.equal(tiltSteer(11.5, m), 0);
  near(tiltSteer(22, m), (12 - 2) / 20);
  near(tiltSteer(-2, m), -(12 - 2) / 20);
  near(tiltSteer(22, { ...m, invert: true }), -(12 - 2) / 20);
  assert.equal(tiltSteer(10, { ...m, invert: true }), 0);
});

test('tilt roll: gamma in portrait, ±beta in landscape, both signs of the screen rotation', () => {
  // Flat phone, portrait: rolling the right edge down (gamma > 0) steers right.
  near(tiltRollDeg(0, 30, 0), 30, 1e-9);
  near(tiltRollDeg(0, -15, 0), -15, 1e-9);
  // Flat phone, landscape-primary (angle 90, top of the phone to the left): beta is the roll.
  near(tiltRollDeg(30, 0, 90), 30, 1e-9);
  near(tiltRollDeg(-20, 0, 90), -20, 1e-9);
  // landscape-secondary (angle 270): the sign flips.
  near(tiltRollDeg(30, 0, 270), -30, 1e-9);
  // Upside-down portrait flips gamma.
  near(tiltRollDeg(0, 30, 180), -30, 1e-9);
  // A phone tilted back 45° (beta 45) and rolled 20° about the player's line of sight: the roll comes
  // out the same, not scaled by the back tilt.
  const roll = 20;
  const back = 45;
  // Gravity for that pose, then the Euler angles the sensor would report for it.
  const gx = Math.sin((roll * Math.PI) / 180);
  const gy = -Math.cos((roll * Math.PI) / 180) * Math.sin((back * Math.PI) / 180);
  const gz = -Math.cos((roll * Math.PI) / 180) * Math.cos((back * Math.PI) / 180);
  const beta = Math.asin(-gy) / (Math.PI / 180);
  const gamma = Math.atan2(gx, -gz) / (Math.PI / 180);
  near(tiltRollDeg(beta, gamma, 0), roll, 1e-6);
});

test('tilt: screen angle from screen.orientation, the legacy value or the type name', () => {
  assert.equal(screenAngleOf({ angle: 90, type: 'landscape-primary' }), 90);
  assert.equal(screenAngleOf({ angle: -90 }), 270);
  assert.equal(screenAngleOf({ type: 'landscape-secondary' }), 270);
  assert.equal(screenAngleOf({ type: 'portrait-secondary' }), 180);
  assert.equal(screenAngleOf({ type: 'portrait-primary' }), 0);
  assert.equal(screenAngleOf(null, 90), 90);
  assert.equal(screenAngleOf(null, null), 0);
});

test('tilt: exponential smoothing reaches 63 % after one time constant and snaps on the first sample', () => {
  near(smoothTowards(0, 10, TILT_SMOOTHING_MS), 10 * (1 - Math.exp(-1)), 1e-9);
  assert.equal(smoothTowards(0, 10, 0), 10);
  near(smoothTowards(5, 5, 16), 5);
  // 16 ms frames: well under 10 % left after 200 ms.
  let v = 0;
  for (let t = 0; t < 200; t += 16) v = smoothTowards(v, 1, 16);
  assert.ok(v > 0.9 && v < 1, `${v}`);
});

// ── Gamepad ──────────────────────────────────────────────────────────────────

test('gamepad: stick dead zone and ^1.5 response curve', () => {
  assert.equal(shapeStick(0), 0);
  assert.equal(shapeStick(STICK_DEADZONE), 0);
  assert.equal(shapeStick(-0.1), 0);
  assert.equal(shapeStick(1), 1);
  assert.equal(shapeStick(-1), -1);
  const half = shapeStick(0.56); // halfway through the live range
  near(half, Math.pow((0.56 - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1.5), 1e-9);
  assert.ok(half < 0.5 && half > 0.3, `${half}`);
  assert.equal(shapeStick(Number.NaN), 0);
});

const pad = (over: Partial<PadLike> & { press?: number[]; axes?: number[]; rt?: number; lt?: number }): PadLike => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const i of over.press ?? []) buttons[i] = { pressed: true, value: 1 };
  if (over.rt !== undefined) buttons[PAD_BUTTON.RT] = { pressed: over.rt > 0, value: over.rt };
  if (over.lt !== undefined) buttons[PAD_BUTTON.LT] = { pressed: over.lt > 0, value: over.lt };
  return { connected: true, mapping: 'standard', id: 'Test Pad (STANDARD GAMEPAD)', axes: over.axes ?? [0, 0, 0, 0], buttons };
};

test('gamepad: standard mapping → frame (stick, triggers, A/B/Y/Start, d-pad)', () => {
  const f = readPad(pad({ axes: [0.5, 0, 0, 0], rt: 0.75, lt: 0.25, press: [PAD_BUTTON.A] }), emptyPadFrame());
  near(f.steer, shapeStick(0.5));
  assert.equal(f.throttle, 0.75);
  assert.equal(f.brake, 0.25);
  assert.equal(f.handbrake, true);
  assert.equal(f.respawn, false);
  const g = readPad(pad({ press: [PAD_BUTTON.B, PAD_BUTTON.Y, PAD_BUTTON.START, PAD_BUTTON.DPAD_LEFT] }), emptyPadFrame());
  assert.equal(g.respawn, true);
  assert.equal(g.restart, true);
  assert.equal(g.menu, true);
  assert.equal(g.steer, -1);
  assert.equal(readPad(pad({ axes: [-0.9, 0, 0, 0], press: [PAD_BUTTON.DPAD_RIGHT] }), emptyPadFrame()).steer, 1);
  // Digital-only triggers (pressed, value 0) still count as full.
  const digital = pad({});
  digital.buttons[PAD_BUTTON.RT] = { pressed: true, value: 0 };
  assert.equal(readPad(digital, emptyPadFrame()).throttle, 1);
});

test('gamepad: only connected standard-mapping pads are used', () => {
  const nonStandard = { ...pad({}), mapping: '' };
  const off = { ...pad({}), connected: false };
  assert.equal(firstStandardPad([null, nonStandard, off]), null);
  const ok = pad({});
  assert.equal(firstStandardPad([null, off, ok]), ok);
  assert.equal(firstStandardPad([]), null);
});

// ── Settings ─────────────────────────────────────────────────────────────────

test('input settings: defaults, clamping and junk', () => {
  assert.deepEqual(sanitizeInputSettings(null), DEFAULT_INPUT_SETTINGS);
  assert.deepEqual(sanitizeInputSettings('nope'), DEFAULT_INPUT_SETTINGS);
  assert.deepEqual(sanitizeInputSettings({ steering: 'wheel', tiltMaxDeg: 'x', tiltInvert: 1, tiltOffsetDeg: Number.NaN }), DEFAULT_INPUT_SETTINGS);
  const s = sanitizeInputSettings({ steering: 'tilt', tiltMaxDeg: 99, tiltInvert: true, tiltOffsetDeg: -200 });
  assert.deepEqual(s, { steering: 'tilt', tiltMaxDeg: TILT_MAX_DEG_MAX, tiltInvert: true, tiltOffsetDeg: -90 });
  assert.equal(sanitizeInputSettings({ tiltMaxDeg: 3 }).tiltMaxDeg, TILT_MAX_DEG_MIN);
  assert.equal(sanitizeInputSettings({ tiltMaxDeg: 30.5 }).tiltMaxDeg, 30.5);
});
