import { useRef, type ReactNode } from 'react';
import { TOUCH_CONTROLS } from './hudLayout';

/** Horizontal travel (px) before a touch on a slider row counts as a drag rather than a scroll. */
const DRAG_START_PX = 8;

interface SwipeSliderProps {
  label: ReactNode;
  /** Formatted value for the row header. */
  valueText: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  title?: string;
  className?: string;
  /** data-testid of the value <b>. */
  valueTestId?: string;
  /** data-testid of the row. */
  testId?: string;
}

function snap(value: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  const clamped = Math.min(max, Math.max(min, stepped));
  // Kill float noise (0.1 + 0.2) so the value matches what the native input would produce.
  return Number(clamped.toFixed(6));
}

/**
 * A labelled range slider that is safe inside a scrolling panel on a phone.
 *
 * With touch controls the native input ignores pointers (CSS: `.hud--touch .hud-slider input`),
 * because a Blink range input jumps to the touch point and then follows the finger — every
 * vertical scroll swipe that started on a slider retuned it. Instead the whole row listens: a
 * vertical swipe scrolls the panel (the row is `touch-action: pan-y`) and never changes the value,
 * a tap does nothing, and only a horizontal drag (> 8 px, more sideways than down) moves the value,
 * relative to where it was (full track width = full range). Desktop keeps the native input.
 */
export function SwipeSlider({ label, valueText, min, max, step, value, onChange, title, className, valueTestId, testId }: SwipeSliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; v0: number; width: number; active: boolean } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const onPointerDown = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (!TOUCH_CONTROLS || drag.current) return;
    const width = inputRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, v0: valueRef.current, width, active: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLLabelElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) > DRAG_START_PX && Math.abs(dy) >= Math.abs(dx)) {
        // A scroll: the browser pans (and usually cancels the pointer); never touch the value.
        drag.current = null;
        return;
      }
      if (Math.abs(dx) <= DRAG_START_PX || Math.abs(dx) <= Math.abs(dy)) return;
      d.active = true;
      d.x0 = e.clientX; // start from here, so the value doesn't jump by the dead zone
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer: tracking by id still works without capture.
      }
      return;
    }
    e.preventDefault();
    const next = snap(d.v0 + ((e.clientX - d.x0) / d.width) * (max - min), min, max, step);
    if (next !== valueRef.current) {
      valueRef.current = next;
      onChange(next);
    }
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <label
      className={`hud-slider${className ? ` ${className}` : ''}${TOUCH_CONTROLS ? ' hud-slider--swipe' : ''}`}
      title={title}
      data-testid={testId}
      // Clicking the name/value text would focus the slider via the label (after pointerup, so the blur
      // below never runs) and swallow the driving keys. Only the slider itself should take focus.
      onClick={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      <span className="hud-slider__head">
        <span>{label}</span>
        <b data-testid={valueTestId}>{valueText}</b>
      </span>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        // A focused slider swallows the driving keys (and arrows would retune it): hand them back on release.
        onPointerUp={(e) => e.currentTarget.blur()}
      />
    </label>
  );
}
