/**
 * HUD side of the name tags (rivals/nameTags.ts): one DOM pill per registered tag, moved from rAF
 * to the screen position the canvas-side projector wrote and laid out (stacking, fading, hiding).
 * No React render per frame. The layer's own box (under the top bar, above the thumbs: rivals.css)
 * is reported back to the layout so a pill is never drawn half outside it, and pill coordinates
 * are translated from viewport pixels into the layer's.
 */
import './rivals.css';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRafLoop } from '../hud/hudUtils';
import { clearTagBounds, setTagBounds, setTagExclusions, setTagSize, subscribeTags, tagList, tagSerial, type TagRect } from './nameTags';

/** The thumb controls (hud/TouchControls): pills never sit on them. Static per viewport, re-read on resize. */
const THUMB_SELECTORS = ['[data-testid=touch-steer]', '.tc-pedals', '.tc-actions'];

export function NameTags() {
  const serial = useSyncExternalStore(subscribeTags, tagSerial, tagSerial);
  const rootRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<Map<number, HTMLSpanElement>>(new Map());
  const origin = useRef({ left: 0, top: 0 });
  // The layer's box in viewport px: the layout keeps pills inside it, the rAF loop offsets by it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const r = root.getBoundingClientRect();
      // Hidden layer (menu open, results up): keep the last real box, so the pills are back on the first frame after.
      if (r.width === 0 || r.height === 0) return;
      origin.current.left = r.left;
      origin.current.top = r.top;
      setTagBounds(r.left, r.top, r.width, r.height);
      const zones: TagRect[] = [];
      for (const sel of THUMB_SELECTORS) {
        const el = document.querySelector(sel);
        const z = el?.getBoundingClientRect();
        if (z && z.width > 0 && z.height > 0) zones.push({ left: z.left, top: z.top, right: z.right, bottom: z.bottom });
      }
      setTagExclusions(zones);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      clearTagBounds();
      setTagExclusions([]);
    };
  }, []);
  // Rebuild the pills when the set of tags changes (rare); measure each new pill once.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const live = new Set<number>();
    for (const t of tagList()) {
      if (!t.active) continue;
      live.add(t.id);
      let el = nodes.current.get(t.id);
      if (!el) {
        el = document.createElement('span');
        el.className = 'rv-tag';
        root.appendChild(el);
        nodes.current.set(t.id, el);
      }
      el.textContent = t.text.toUpperCase();
      el.style.setProperty('--tag', t.color);
      el.style.display = '';
      el.style.transform = 'none';
      setTagSize(t.id, el.offsetWidth, el.offsetHeight);
      el.style.display = 'none';
    }
    for (const [id, el] of nodes.current) {
      if (live.has(id)) continue;
      el.remove();
      nodes.current.delete(id);
    }
  }, [serial]);
  useRafLoop(() => {
    const { left, top } = origin.current;
    for (const t of tagList()) {
      const el = nodes.current.get(t.id);
      if (!el) continue;
      const show = t.active && t.shown;
      const display = show ? '' : 'none';
      if (el.style.display !== display) el.style.display = display;
      if (!show) continue;
      el.style.transform = `translate(-50%, -100%) translate(${(t.sx - left).toFixed(1)}px, ${(t.y - top).toFixed(1)}px) scale(${t.scale.toFixed(3)})`;
      const opacity = t.opacity >= 0.999 ? '' : t.opacity.toFixed(2);
      if (el.style.opacity !== opacity) el.style.opacity = opacity;
    }
  });
  return <div className="rv-tags" ref={rootRef} aria-hidden="true" />;
}
