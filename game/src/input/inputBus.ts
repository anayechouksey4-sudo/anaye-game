/**
 * Input bus: the one place that composes the on-screen controls, tilt steering and a gamepad into
 * the per-step control the car reads. It publishes through the existing seam
 * `car/input.ts setTouchInput()`, where the keyboard, the start-lights drive lock and the debug
 * override are merged exactly as before — so with tilt off and no gamepad connected the car sees
 * precisely what the touch controls sent before this file existed, and the keyboard/replay harness
 * (`__RACER__.setInput` + `advance`) is untouched.
 *
 * Sources → `compose.ts`: steer = gamepad stick (outside its dead zone) > tilt (when on) > touch
 * pad (> keyboard, merged downstream); throttle/brake = max of the sources; handbrake = any.
 * Discrete pad buttons (B respawn, Y restart, Start menu) run the same actions as the hotkeys.
 *
 * Lifetime: `startInputBus()` from `useGlobalHotkeys` (every device). A rAF loop runs only while
 * tilt is on or a pad is connected; otherwise the bus is event-driven (touch) and idle. A 1 s scan
 * finds pads that never fired `gamepadconnected` (Chrome needs a button press first).
 */
import { useSyncExternalStore } from 'react';
import { setTouchInput, type DriverInput } from '../car/input';
import { runHotkeyAction, type HotkeyAction } from '../game/hotkeys';
import { inputSettings, useInputSettings, type SteeringMode } from '../state/inputSettings';
import { selectionState } from '../state/selection';
import { composeInput, emptyPadFrame, type PadFrame } from './compose';
import { firstStandardPad, readPad } from './gamepad';
import { requestTiltPermission, smoothTowards, startTiltSensor, tiltNeedsPermission, tiltSteer, tiltSupported, type TiltPermission } from './tilt';

export interface InputNotice {
  id: number;
  text: string;
  /** Epoch ms after which the chip hides. */
  until: number;
}

export interface InputStatus {
  /** `Gamepad.id` of the pad in use, null when none is connected. */
  padId: string | null;
  tiltPermission: TiltPermission;
  /** Tilt is steering right now (setting on, sensor present and allowed): the ◀ ▶ pad hides. */
  tiltActive: boolean;
  /** Short message for the HUD chip (GAMEPAD CONNECTED, TILT NOT ALLOWED, TILT CALIBRATED…). */
  notice: InputNotice | null;
}

/** How long a chip notice stays up. */
export const NOTICE_MS = 3000;
/** Pads are looked for this often while none is connected. */
const PAD_SCAN_MS = 1000;

const initialPermission = (): TiltPermission => (tiltSupported() ? (tiltNeedsPermission() ? 'unknown' : 'granted') : 'unsupported');

let status: InputStatus = { padId: null, tiltPermission: initialPermission(), tiltActive: false, notice: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<InputStatus>): void {
  status = { ...status, ...patch };
  for (const fn of listeners) fn();
}

export const inputStatus = (): InputStatus => status;

export function subscribeInputStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useInputStatus(): InputStatus {
  return useSyncExternalStore(subscribeInputStatus, inputStatus, inputStatus);
}

let noticeSerial = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a short HUD chip (input/InputChip.tsx). */
export function notify(text: string): void {
  const id = ++noticeSerial;
  setStatus({ notice: { id, text, until: Date.now() + NOTICE_MS } });
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    if (status.notice?.id === id) setStatus({ notice: null });
  }, NOTICE_MS + 50);
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** The on-screen controls (hud/TouchControls.tsx); all zero while nothing is held. */
const touch: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const composed: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const padFrame: PadFrame = emptyPadFrame();
const padPrev: PadFrame = emptyPadFrame();
/** The pad frame while a pad is connected, else null. */
let pad: PadFrame | null = null;
/** Smoothed screen roll (degrees) and the last sample time. */
let tiltRoll = 0;
let tiltLastMs = 0;
let liveRollValue = 0;
let calibratePending = false;
let stopSensor: (() => void) | null = null;
let rafId = 0;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeSettings: (() => void) | null = null;
let refs = 0;

/** The steer the car was last given (−1…1): drawn by the TILT chip in the thumb area. */
export const liveSteer = (): number => composed.steer;
/** The last composed input handed to `car/input.ts setTouchInput` (read-only; debug handle). */
export const liveInput = (): Readonly<DriverInput> => composed;
/** The last raw screen roll in degrees (SETTINGS card feedback). */
export const liveTiltRoll = (): number => liveRollValue;

function publish(): void {
  const s = inputSettings();
  const tilt = status.tiltActive ? tiltSteer(tiltRoll, { offsetDeg: s.tiltOffsetDeg, maxDeg: s.tiltMaxDeg, invert: s.tiltInvert }) : null;
  composeInput(touch, tilt, pad, composed);
  setTouchInput(composed);
}

/** On-screen controls → bus (same call shape as the old `setTouchInput`). */
export function setTouchSource(next: Partial<DriverInput>): void {
  Object.assign(touch, next);
  publish();
}

export function clearTouchSource(): void {
  touch.throttle = 0;
  touch.brake = 0;
  touch.steer = 0;
  touch.handbrake = 0;
  publish();
}

// ── Gamepad ──────────────────────────────────────────────────────────────────

function padAction(action: HotkeyAction): void {
  // Same rule as the keyboard hotkeys: while the ☰ menu is open only "menu" (close it) works.
  if (selectionState().menuOpen && action !== 'menu') return;
  runHotkeyAction(action);
}

function pollPad(): void {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  let found: ReturnType<typeof firstStandardPad> = null;
  try {
    found = firstStandardPad(navigator.getGamepads());
  } catch {
    found = null;
  }
  if (!found) {
    if (pad) {
      pad = null;
      Object.assign(padPrev, emptyPadFrame());
      setStatus({ padId: null });
      notify('GAMEPAD DISCONNECTED');
    }
    return;
  }
  if (!pad) {
    pad = padFrame;
    Object.assign(padPrev, emptyPadFrame());
    setStatus({ padId: found.id });
    notify('GAMEPAD CONNECTED');
  } else if (status.padId !== found.id) {
    setStatus({ padId: found.id });
  }
  readPad(found, padFrame);
  if (padFrame.respawn && !padPrev.respawn) padAction('respawn');
  if (padFrame.restart && !padPrev.restart) padAction('restart');
  if (padFrame.menu && !padPrev.menu) padAction('menu');
  padPrev.respawn = padFrame.respawn;
  padPrev.restart = padFrame.restart;
  padPrev.menu = padFrame.menu;
}

// ── Loop ─────────────────────────────────────────────────────────────────────

const loopWanted = (): boolean => refs > 0 && (status.tiltActive || pad !== null);

function tick(): void {
  rafId = 0;
  pollPad();
  publish();
  if (loopWanted()) rafId = requestAnimationFrame(tick);
}

function ensureLoop(): void {
  if (rafId === 0 && loopWanted() && typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick);
}

function scan(): void {
  if (pad) return;
  pollPad();
  if (pad) {
    publish();
    ensureLoop();
  }
}

// ── Tilt ─────────────────────────────────────────────────────────────────────

function onRoll(rollDeg: number, nowMs: number): void {
  liveRollValue = rollDeg;
  if (calibratePending) {
    calibratePending = false;
    inputSettings().set({ tiltOffsetDeg: rollDeg });
    notify('TILT CALIBRATED');
  }
  tiltRoll = smoothTowards(tiltRoll, rollDeg, tiltLastMs > 0 ? nowMs - tiltLastMs : 0);
  tiltLastMs = nowMs;
}

/** Turn the sensor on or off to match the setting and the permission state. */
function applyTiltSetting(): void {
  const s = inputSettings();
  const allowed = status.tiltPermission === 'granted';
  const want = refs > 0 && s.steering === 'tilt' && tiltSupported() && allowed;
  if (want === status.tiltActive) return;
  if (want) {
    tiltRoll = 0;
    tiltLastMs = 0;
    stopSensor = startTiltSensor(onRoll);
    setStatus({ tiltActive: true });
    publish();
    ensureLoop();
  } else {
    stopSensor?.();
    stopSensor = null;
    tiltRoll = 0;
    setStatus({ tiltActive: false });
    publish();
  }
}

/**
 * SETTINGS → STEERING. Call from the tap handler: iOS shows its motion-access prompt only then. A
 * refusal keeps touch steering and shows TILT NOT ALLOWED. Enabling tilt also calibrates on the
 * next sensor reading (hold the phone the way you play).
 */
export async function setSteeringMode(mode: SteeringMode): Promise<TiltPermission | 'ok'> {
  if (mode === 'touch') {
    inputSettings().set({ steering: 'touch' });
    return 'ok';
  }
  if (!tiltSupported()) {
    setStatus({ tiltPermission: 'unsupported' });
    notify('TILT NOT AVAILABLE');
    return 'unsupported';
  }
  const permission = await requestTiltPermission();
  setStatus({ tiltPermission: permission });
  if (permission !== 'granted') {
    inputSettings().set({ steering: 'touch' });
    notify('TILT NOT ALLOWED');
    applyTiltSetting();
    return permission;
  }
  calibratePending = true;
  inputSettings().set({ steering: 'tilt' });
  applyTiltSetting();
  return 'ok';
}

/** CALIBRATE: the next sensor reading becomes the neutral roll. */
export function calibrateTilt(): void {
  calibratePending = true;
  if (!status.tiltActive) notify('TURN ON TILT TO CALIBRATE');
}

// ── Lifetime ─────────────────────────────────────────────────────────────────

function onPadEvent(): void {
  pollPad();
  publish();
  ensureLoop();
}

function onVisibility(): void {
  if (document.visibilityState !== 'hidden') return;
  // A hidden tab sees no sensor events and no button releases: start from rest when it comes back.
  tiltRoll = 0;
  tiltLastMs = 0;
  if (pad) {
    Object.assign(padFrame, emptyPadFrame());
    Object.assign(padPrev, emptyPadFrame());
  }
  publish();
}

/** Start the bus (ref-counted; StrictMode's double effect is fine). Returns the stop function. */
export function startInputBus(): () => void {
  refs += 1;
  if (refs === 1 && typeof window !== 'undefined') {
    unsubscribeSettings = useInputSettings.subscribe(applyTiltSetting);
    window.addEventListener('gamepadconnected', onPadEvent);
    window.addEventListener('gamepaddisconnected', onPadEvent);
    document.addEventListener('visibilitychange', onVisibility);
    scanTimer = setInterval(scan, PAD_SCAN_MS);
    applyTiltSetting();
    scan();
    // Saved TILT on a browser with a permission API: probe it now. Android answers without a prompt;
    // iOS throws without a gesture ('unknown'), and the SETTINGS card then asks for a tap on TILT.
    if (inputSettings().steering === 'tilt' && tiltNeedsPermission() && status.tiltPermission === 'unknown') {
      requestTiltPermission()
        .then((permission) => {
          if (refs === 0) return;
          setStatus({ tiltPermission: permission });
          applyTiltSetting();
        })
        .catch(() => undefined);
    }
    (window as Window & { __INPUT__?: unknown }).__INPUT__ = {
      status: inputStatus,
      liveSteer,
      liveInput,
      liveTiltRoll,
      setSteeringMode,
      calibrateTilt,
      settings: inputSettings,
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    refs -= 1;
    if (refs > 0 || typeof window === 'undefined') return;
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    window.removeEventListener('gamepadconnected', onPadEvent);
    window.removeEventListener('gamepaddisconnected', onPadEvent);
    document.removeEventListener('visibilitychange', onVisibility);
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    stopSensor?.();
    stopSensor = null;
    pad = null;
    tiltRoll = 0;
    setStatus({ tiltActive: false, padId: null });
    clearTouchSource();
  };
}
