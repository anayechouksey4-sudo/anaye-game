/**
 * HUD side of the name tags (rivals/nameTags.ts): one DOM pill per registered tag, moved from rAF
 * to the screen position the canvas-side projector wrote. No React render per frame.
 */
import './rivals.css';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRafLoop } from '../hud/hudUtils';
import { subscribeTags, tagList, tagSerial } from './nameTags';

/** Tags beyond this depth (NDC z, ~110 m) are hidden; nearer ones shrink with distance. */
const FAR_NDC = 0.9985;

export function NameTags() {
  const serial = useSyncExternalStore(subscribeTags, tagSerial, tagSerial);
  const rootRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<Map<number, HTMLSpanElement>>(new Map());
  // Rebuild the pills when the set of tags changes (rare).
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
      el.style.display = 'none';
    }
    for (const [id, el] of nodes.current) {
      if (live.has(id)) continue;
      el.remove();
      nodes.current.delete(id);
    }
  }, [serial]);
  useRafLoop(() => {
    for (const t of tagList()) {
      const el = nodes.current.get(t.id);
      if (!el) continue;
      const show = t.active && t.visible && t.depth < FAR_NDC;
      const display = show ? '' : 'none';
      if (el.style.display !== display) el.style.display = display;
      if (!show) continue;
      const scale = Math.max(0.6, Math.min(1, (FAR_NDC - t.depth) * 400));
      el.style.transform = `translate(-50%, -100%) translate(${t.sx.toFixed(1)}px, ${t.sy.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    }
  });
  return <div className="rv-tags" ref={rootRef} aria-hidden="true" />;
}
