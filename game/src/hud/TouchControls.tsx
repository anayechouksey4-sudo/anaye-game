/**
 * On-screen controls for phones and tablets: a steer pad under the left thumb, pedals under the
 * right thumb, small action buttons. Every finger is tracked by pointerId (Pointer Events with
 * pointer capture), so steering and throttle work at the same time; a control is held only while
 * a finger is down *and over it*, and everything is released on pointercancel, window blur, a
 * hidden tab and unmount. Feeds car/input.ts (merged with the keyboard); the action buttons run the
 * same actions as the hotkeys (game/hotkeys.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { clearTouchInput, setTouchInput } from '../car/input';
import { runHotkeyAction, type HotkeyAction } from '../game/hotkeys';
import { useGameStore } from '../state/store';

type Pedal = 'throttle' | 'brake' | 'handbrake';
type Action = HotkeyAction | 'fullscreen';

interface Finger {
  kind: 'steer' | 'pedal' | 'action';
  /** Control the finger went down on (holds its pointer capture). */
  el: HTMLElement;
  x: number;
  y: number;
}

/** How far (px) a finger may drift outside a control before the control lets go. */
const SLACK_PX = 24;
/** Steer pad: dead zone and full-lock point as fractions of the half-width from the centre. */
const STEER_DEADZONE = 0.08;
const STEER_FULL_AT = 0.45;

const PEDALS: readonly { pedal: Pedal; label: string; sub?: string }[] = [
  { pedal: 'handbrake', label: 'DRIFT', sub: 'HANDBRAKE' },
  { pedal: 'brake', label: 'BRAKE', sub: 'REVERSE' },
  { pedal: 'throttle', label: 'GAS' },
];

/** Distance from a point to a rect (0 inside). */
function distanceToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

const isOver = (f: Finger, el: Element) => distanceToRect(f.x, f.y, el.getBoundingClientRect()) <= SLACK_PX;

/** Pad position → steer −1…+1: analog near the centre, full lock from the ◀ ▶ glyphs outward. */
function steerFromPad(x: number, pad: DOMRect): number {
  const half = pad.width / 2;
  if (half <= 0) return 0;
  const u = (x - (pad.left + half)) / half;
  const mag = Math.min(1, Math.max(0, (Math.abs(u) - STEER_DEADZONE) / (STEER_FULL_AT - STEER_DEADZONE)));
  return Math.sign(u) * mag;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      // Not every browser can lock (and none outside fullscreen); portrait stays playable anyway.
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return orientation.lock?.('landscape');
    })
    .catch(() => {});
}

function runAction(action: Action): void {
  if (action === 'fullscreen') toggleFullscreen();
  else runHotkeyAction(action);
}

function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return on;
}

export function TouchControls() {
  const rootRef = useRef<HTMLDivElement>(null);
  const steerRef = useRef<HTMLDivElement>(null);
  const cameraMode = useGameStore((s) => s.ui.cameraMode);
  const hudOn = useGameStore((s) => s.ui.helpOpen);
  const physicsOpen = useGameStore((s) => s.ui.physicsPanelOpen);
  const fullscreen = useFullscreen();
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

  useEffect(() => {
    const root = rootRef.current;
    const pad = steerRef.current;
    if (!root || !pad) return;
    const fingers = new Map<number, Finger>();
    const pedalEls = Array.from(root.querySelectorAll<HTMLElement>('[data-pedal]'));
    const actionEls = Array.from(root.querySelectorAll<HTMLElement>('[data-action]'));

    /** Recompute every control from the fingers that are down, then publish to the driver input. */
    const sync = () => {
      let steer = 0;
      const held = new Set<Pedal>();
      const pressedActions = new Set<HTMLElement>();
      const padRect = pad.getBoundingClientRect();
      for (const f of fingers.values()) {
        if (f.kind === 'steer') {
          // Latest finger on the pad wins; one that slid off steers nothing until it comes back.
          if (distanceToRect(f.x, f.y, padRect) <= SLACK_PX) steer = steerFromPad(f.x, padRect);
        } else if (f.kind === 'pedal') {
          // A pedal finger presses whichever pedal it is over, so a thumb can slide gas → brake.
          let best: HTMLElement | null = null;
          let bestDist = SLACK_PX;
          for (const el of pedalEls) {
            const d = distanceToRect(f.x, f.y, el.getBoundingClientRect());
            if (d <= bestDist) {
              best = el;
              bestDist = d;
            }
          }
          if (best) held.add(best.dataset.pedal as Pedal);
        } else if (isOver(f, f.el)) {
          pressedActions.add(f.el);
        }
      }
      setTouchInput({
        throttle: held.has('throttle') ? 1 : 0,
        brake: held.has('brake') ? 1 : 0,
        handbrake: held.has('handbrake') ? 1 : 0,
        steer,
      });
      for (const el of pedalEls) el.classList.toggle('is-pressed', held.has(el.dataset.pedal as Pedal));
      for (const el of actionEls) el.classList.toggle('is-pressed', pressedActions.has(el));
      pad.style.setProperty('--steer', steer.toFixed(3));
      pad.classList.toggle('is-left', steer < 0);
      pad.classList.toggle('is-right', steer > 0);
    };

    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tc]') : null;
      if (!el || !root.contains(el)) return;
      // No focus, text selection, compatibility mouse events or browser gesture from a control.
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone (synthetic events); tracking by id still works.
      }
      fingers.set(e.pointerId, { kind: el.dataset.tc as Finger['kind'], el, x: e.clientX, y: e.clientY });
      sync();
    };
    const onMove = (e: PointerEvent) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      f.x = e.clientX;
      f.y = e.clientY;
      sync();
    };
    const onUp = (e: PointerEvent) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      f.x = e.clientX;
      f.y = e.clientY;
      fingers.delete(e.pointerId);
      // Buttons fire on release over the button, like a click: sliding off cancels a mistaken tap.
      if (f.kind === 'action' && isOver(f, f.el)) runAction(f.el.dataset.action as Action);
      sync();
    };
    const onCancel = (e: PointerEvent) => {
      if (fingers.delete(e.pointerId)) sync();
    };
    const releaseAll = () => {
      fingers.clear();
      sync();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseAll();
    };
    // Long-press on the controls or the canvas must not open the context menu / image callout.
    const noMenu = (e: Event) => e.preventDefault();

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    root.addEventListener('lostpointercapture', onCancel);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('contextmenu', noMenu);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      root.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('contextmenu', noMenu);
      fingers.clear();
      clearTouchInput();
    };
  }, []);

  const actions: { action: Action; icon: string; label: string; on?: boolean }[] = [
    { action: 'respawn', icon: '⟲', label: 'RESPAWN' },
    { action: 'restart', icon: '⏮', label: 'RESTART' },
    { action: 'camera', icon: '◉', label: cameraMode.toUpperCase() },
    { action: 'help', icon: '▤', label: 'HUD', on: hudOn },
    { action: 'physics', icon: '⚙', label: 'PHYSICS', on: physicsOpen },
  ];
  if (canFullscreen) actions.push({ action: 'fullscreen', icon: fullscreen ? '⤡' : '⤢', label: fullscreen ? 'EXIT' : 'FULL' });

  return (
    <div className="tc" ref={rootRef} data-testid="touch-controls">
      <div className="tc-steer" ref={steerRef} data-tc="steer" data-testid="touch-steer" aria-label="Steer: slide left or right">
        <span className="tc-steer__half tc-steer__half--left">◀</span>
        <span className="tc-steer__half tc-steer__half--right">▶</span>
        <i className="tc-steer__knob" />
      </div>
      <div className="tc-pedals">
        {PEDALS.map(({ pedal, label, sub }) => (
          <button
            key={pedal}
            type="button"
            tabIndex={-1}
            className={`tc-btn tc-pedal tc-pedal--${pedal}`}
            data-tc="pedal"
            data-pedal={pedal}
            data-testid={`touch-${pedal}`}
          >
            {label}
            {sub && <small>{sub}</small>}
          </button>
        ))}
      </div>
      <div className="tc-actions">
        {actions.map(({ action, icon, label, on }) => (
          <button
            key={action}
            type="button"
            tabIndex={-1}
            className={`tc-btn tc-action${on ? ' is-on' : ''}`}
            data-tc="action"
            data-action={action}
            data-testid={`touch-${action}`}
            aria-label={label}
          >
            <span aria-hidden="true">{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** How long the portrait-only "rotate" hint stays up unless tapped away. */
const ROTATE_HINT_MS = 12000;

/** One-line, dismissible hint shown in portrait only (CSS); portrait stays fully playable. */
export function RotateHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), ROTATE_HINT_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <button type="button" tabIndex={-1} className="tc-rotate" onClick={() => setVisible(false)} data-testid="rotate-hint">
      ⟳ Rotate for the best view <span aria-hidden="true">✕</span>
    </button>
  );
}
