/**
 * Three-second HUD chip for input events: GAMEPAD CONNECTED / DISCONNECTED, TILT NOT ALLOWED,
 * TILT CALIBRATED. Reads the bus notice; the integrator mounts it in HUD.tsx (it positions itself
 * under the top bar, centred, pointer-events none). While the start lights are up the chip parks
 * under them instead (their box is measured, so it follows the lights wherever the minimap or the
 * physics panel moves them) and never sits in their band.
 */
import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { useRafLoop } from '../hud/hudUtils';
import { useInputStatus } from './inputBus';
import './input.css';

const LIGHTS_SELECTOR = '[data-testid=countdown]';
const UNDER_LIGHTS_GAP_PX = 8;

export default function InputChip() {
  const { notice } = useInputStatus();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(rerender, Math.max(0, notice.until - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice || Date.now() >= notice.until) return null;
  return <Chip key={notice.id} text={notice.text} />;
}

/**
 * Where the chip goes: under the lights' measured box while they show (an inline `top`, with
 * `.inchip--under-lights`), else back to the stylesheet's place under the top bar. The move is a
 * jump, not a slide, so the chip never crosses the lights' band on its way.
 */
function placeChip(el: HTMLElement): void {
  const lights = document.querySelector<HTMLElement>(LIGHTS_SELECTOR);
  let top = '';
  if (lights) {
    const r = lights.getBoundingClientRect();
    const host = el.offsetParent?.getBoundingClientRect();
    if (r.height > 0) top = `${Math.round(r.bottom - (host?.top ?? 0) + UNDER_LIGHTS_GAP_PX)}px`;
  }
  if (el.style.top !== top) el.style.top = top;
  const under = top !== '';
  if (el.classList.contains('inchip--under-lights') !== under) el.classList.toggle('inchip--under-lights', under);
}

/** The chip itself (mounted only while a notice is live, so its rAF loop runs for a few seconds at most). */
function Chip({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Placed before the first paint (the lights may already be up when the notice arrives)…
  useLayoutEffect(() => {
    if (ref.current) placeChip(ref.current);
  }, []);
  // …and kept in place while they come and go.
  useRafLoop(() => {
    if (ref.current) placeChip(ref.current);
  });
  return (
    <div className="inchip" role="status" data-testid="input-chip" ref={ref}>
      {text}
    </div>
  );
}
