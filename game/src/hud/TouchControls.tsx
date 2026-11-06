/**
 * On-screen controls for phones and tablets: a steer pad under the left thumb, pedals under the
 * right thumb, and two buttons at the top right — RESPAWN (quick access) and ☰ (the menu, which
 * holds everything else: camera, HUD, physics, garage, maps, sound, fullscreen…).
 *
 * Every finger is tracked by pointerId (Pointer Events with pointer capture), so steering and
 * throttle work at the same time. A pedal or button is held only while a finger is down *and over
 * it*; the steer pad keeps its finger while it slides sideways off the pad (past an edge = full
 * lock) and lets go only on lift or a large vertical exit. Everything is released on
 * pointercancel, window blur, a hidden tab, the ☰ menu opening and unmount; a finger that was down
 * then must lift before it can press again. Feeds car/input.ts (merged with the keyboard); the
 * buttons run the same actions as the hotkeys (game/hotkeys.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { clearTouchInput, setTouchInput } from '../car/input';
import { runHotkeyAction, type HotkeyAction } from '../game/hotkeys';
import { useSelection } from '../state/selection';

type Pedal = 'throttle' | 'brake' | 'handbrake';
type Action = Extract<HotkeyAction, 'respawn' | 'menu'>;

interface Finger {
  kind: 'steer' | 'pedal' | 'action';
  /** Control the finger went down on (holds its pointer capture). */
  el: HTMLElement;
  x: number;
  y: number;
}

/** How far (px) a finger may drift outside a pedal or button before it lets go. */
const SLACK_PX = 24;
/** The steer pad lets go of its finger only this far (px) above or below the pad. */
const STEER_EXIT_PX = 80;
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

/**
 * Steer from a pad finger: x clamped to the pad (past an edge counts as full lock that side);
 * 0 once the finger is more than STEER_EXIT_PX above or below the pad.
 */
function steerFromFinger(f: Finger, pad: DOMRect): number {
  const dy = Math.max(pad.top - f.y, 0, f.y - pad.bottom);
  if (dy > STEER_EXIT_PX) return 0;
  return steerFromPad(Math.min(pad.right, Math.max(pad.left, f.x)), pad);
}

const ACTIONS: readonly { action: Action; icon: string; label: string }[] = [
  { action: 'respawn', icon: '⟲', label: 'RESPAWN' },
  { action: 'menu', icon: '☰', label: 'MENU' },
];

export function TouchControls() {
  const rootRef = useRef<HTMLDivElement>(null);
  const steerRef = useRef<HTMLDivElement>(null);

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
          // Latest finger on the pad wins; one that left it far up or down steers nothing until it comes back.
          steer = steerFromFinger(f, padRect);
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
      if (f.kind === 'action' && isOver(f, f.el)) runHotkeyAction(f.el.dataset.action as Action);
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
    // No compatibility click after a touch on a control: ☰ opens the menu on pointerup, and the click
    // that follows would land on whatever the menu put under the finger (its ✕ sits where ☰ was).
    const noGhostClick = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };

    // Opening the ☰ menu (it pauses the game) lets go of everything; those fingers must lift first.
    const offMenu = useSelection.subscribe((s, prev) => {
      if (s.menuOpen && !prev.menuOpen) releaseAll();
    });

    root.addEventListener('touchend', noGhostClick, { passive: false });
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    root.addEventListener('lostpointercapture', onCancel);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('contextmenu', noMenu);
    return () => {
      offMenu();
      root.removeEventListener('touchend', noGhostClick);
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
        {ACTIONS.map(({ action, icon, label }) => (
          <button
            key={action}
            type="button"
            tabIndex={-1}
            className={`tc-btn tc-action tc-action--${action}`}
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
