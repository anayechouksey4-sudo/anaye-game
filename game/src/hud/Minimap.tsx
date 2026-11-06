import './minimap.css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { carRuntime } from '../car/runtime';
import { useGameStore } from '../state/store';
import { useWorldHud, worldLive, type MapMarker, type MinimapImage } from '../state/worldRuntime';
import { getTrackEntry } from '../track/catalog';
import { setText } from './hudUtils';
import { rememberWorldEvents, rememberWorldPicture } from './IslandCard';
import { minimapStats, openMenu, useMinimapShown } from './uiStore';

/** Zoom: metres per CSS pixel at a standstill, rising to M_PER_PX_FAST at ZOOM_FAST_KMH. */
const M_PER_PX_SLOW = 2.5;
const M_PER_PX_FAST = 4;
const ZOOM_FAST_KMH = 200;
/** Zoom glide time constant, s (no pumping on every throttle lift). */
const ZOOM_TAU_S = 0.6;
/** The car arrow sits at this fraction of the disc height (more road ahead than behind). */
const CAR_Y = 0.6;
/** Gate dots closer than this to the rim (px) give way to the rim arrow. */
const RIM_MARGIN = 7;

function paintBase(canvas: HTMLCanvasElement, image: MinimapImage): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.data.subarray(0, data.data.length));
  ctx.putImageData(data, 0, 0);
  minimapStats.basePaints += 1;
}

/** Route in the event accent, gate ticks, free-roam event flags and landmark glyphs, in image pixels. */
function paintOverlay(canvas: HTMLCanvasElement, image: MinimapImage, route: Float32Array | null, markers: readonly MapMarker[], accent: string): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const k = 1 / image.metresPerPixel;
  const px = (x: number) => (x - image.originX) * k;
  const py = (z: number) => (z - image.originZ) * k;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (route && route.length >= 4) {
    ctx.beginPath();
    ctx.moveTo(px(route[0]!), py(route[1]!));
    for (let i = 2; i + 1 < route.length; i += 2) ctx.lineTo(px(route[i]!), py(route[i + 1]!));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  for (const m of markers) {
    const x = px(m.x);
    const y = py(m.z);
    ctx.beginPath();
    if (m.kind === 'event') {
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = m.accent ?? accent;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = m.accent ?? accent;
      ctx.fill();
    } else if (m.kind === 'checkpoint' || m.kind === 'finish') {
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = m.kind === 'finish' ? '#39ff14' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.stroke();
    } else {
      // Landmark / travel spot: a small diamond.
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 3, y);
      ctx.closePath();
      ctx.fillStyle = m.kind === 'travel' ? '#00f0ff' : '#f5e663';
      ctx.fill();
    }
  }
  minimapStats.overlayPaints += 1;
}

/**
 * Open-world minimap (PLAN §5.5): a heading-up disc with the car arrow fixed at 60 % of its height.
 *
 * The 512² picture (`useWorldHud.minimap`) is painted ONCE into a canvas; the route / flags overlay
 * is redrawn only when the entry changes. Both sit in one layer that rAF moves with a CSS transform
 * only (translate · rotate · scale · translate, compositor work, no canvas redraw and no React
 * render while driving). Per frame it also places the next-gate dot, the after-next hollow dot, the
 * N tick, and a rim arrow with the distance (`worldLive.nextGateM`) when the next gate is off the
 * disc. A tap (click, on lift) opens the menu on MAPS. Placement per viewport: minimap.css.
 */
export function Minimap() {
  minimapStats.renders += 1;
  const shown = useMinimapShown();
  const image = useWorldHud((s) => (s.active ? s.minimap : null));
  const route = useWorldHud((s) => s.route);
  const markers = useWorldHud((s) => s.markers);
  const worldId = useWorldHud((s) => s.worldId);
  const trackId = useGameStore((s) => s.trackLayout?.id ?? '');
  const accent = getTrackEntry(trackId).accent;

  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLElement>(null);
  const dot2Ref = useRef<HTMLElement>(null);
  const northRef = useRef<HTMLElement>(null);
  const rimRef = useRef<HTMLElement>(null);
  const labelRef = useRef<HTMLElement>(null);
  // Everything the frame loop reads, kept in one mutable object (no closures per frame).
  const live = useRef({
    shown: false,
    image: null as MinimapImage | null,
    size: 0,
    zoom: M_PER_PX_SLOW,
    lastT: 0,
    lastTransform: '',
    dot: false,
    dot2: false,
    rim: false,
    labelM: -1,
    /** Gate positions [x0, z0, x1, z1, …] (checkpoints 1…n−1, then the finish), from the markers. */
    gates: new Float64Array(0),
  }).current;

  live.shown = shown && image !== null;
  live.image = image;

  useLayoutEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !image) return;
    paintBase(canvas, image);
    // The MAPS island card keeps a small copy (shown there after leaving the world too).
    if (worldId) rememberWorldPicture(worldId, canvas);
  }, [image, worldId]);

  useLayoutEffect(() => {
    const canvas = overlayRef.current;
    if (canvas && image) paintOverlay(canvas, image, route, markers, accent);
    if (image && worldId) rememberWorldEvents(worldId, image, markers);
    const gates = markers.filter((m) => m.kind === 'checkpoint' || m.kind === 'finish');
    live.gates = new Float64Array(gates.flatMap((m) => [m.x, m.z]));
  }, [image, route, markers, accent, live, worldId]);

  // Disc size from layout, observed (never read during a frame).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      live.size = el.clientWidth;
      live.lastTransform = '';
    });
    ro.observe(el);
    live.size = el.clientWidth;
    return () => ro.disconnect();
  }, [live, image]);

  useEffect(() => {
    let raf = 0;
    const show = (el: HTMLElement | null, on: boolean) => {
      if (el && el.classList.contains('is-on') !== on) el.classList.toggle('is-on', on);
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const img = live.image;
      const size = live.size;
      if (!live.shown || !img || size <= 0) {
        live.lastT = now;
        return;
      }
      const t0 = performance.now();
      const dt = live.lastT > 0 ? Math.min(0.25, (now - live.lastT) / 1000) : 0;
      live.lastT = now;
      // Zoom with speed, glided.
      const kmh = carRuntime.speedKmh;
      const s01 = kmh <= 0 ? 0 : kmh >= ZOOM_FAST_KMH ? 1 : kmh / ZOOM_FAST_KMH;
      const target = M_PER_PX_SLOW + (M_PER_PX_FAST - M_PER_PX_SLOW) * s01;
      live.zoom += (target - live.zoom) * (dt > 0 ? 1 - Math.exp(-dt / ZOOM_TAU_S) : 1);
      const zoom = live.zoom;
      const mpp = img.metresPerPixel;
      const scale = mpp / zoom;
      const x = worldLive.x;
      const z = worldLive.z;
      // Heading-up: yaw 0 faces +z (map south), so the picture turns by yaw − π.
      const phi = worldLive.yaw - Math.PI;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      const half = size / 2;
      const cx = half;
      const cy = size * CAR_Y;
      const u = (x - img.originX) / mpp;
      const v = (z - img.originZ) / mpp;
      const transform = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) rotate(${phi.toFixed(4)}rad) scale(${scale.toFixed(4)}) translate(${(-u).toFixed(2)}px,${(-v).toFixed(2)}px)`;
      if (transform !== live.lastTransform) {
        live.lastTransform = transform;
        if (layerRef.current) layerRef.current.style.transform = transform;
        // N tick on the rim: north (−z) turned like the picture.
        if (northRef.current) northRef.current.style.transform = `translate(${(half + (half - 9) * sin).toFixed(1)}px,${(half - (half - 9) * cos).toFixed(1)}px)`;
      }
      // Gate guidance (races): next gate dot or rim arrow + distance; the after-next gate as a hollow dot.
      const next = worldLive.nextGate;
      let dotOn = false;
      let dot2On = false;
      let rimOn = false;
      if (next > 0) {
        const r = half - RIM_MARGIN;
        let dx = (worldLive.nextGateX - x) / zoom;
        let dz = (worldLive.nextGateZ - z) / zoom;
        let sx = cx + dx * cos - dz * sin;
        let sy = cy + dx * sin + dz * cos;
        let ox = sx - half;
        let oy = sy - half;
        const d = Math.hypot(ox, oy);
        if (d <= r) {
          dotOn = true;
          if (dotRef.current) dotRef.current.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
        } else if (d > 0) {
          rimOn = true;
          const ang = Math.atan2(oy, ox);
          if (rimRef.current) rimRef.current.style.transform = `translate(${(half + ox * (r / d)).toFixed(1)}px,${(half + oy * (r / d)).toFixed(1)}px) rotate(${(ang + Math.PI / 2).toFixed(3)}rad)`;
          const m = worldLive.nextGateM;
          const metres = Number.isFinite(m) ? Math.max(0, Math.round(m / 10) * 10) : -1;
          if (metres !== live.labelM) {
            live.labelM = metres;
            setText(labelRef.current, metres >= 0 ? (metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`) : '');
          }
          if (labelRef.current) {
            // Inside the rim, toward the arrow.
            const lr = r - 18;
            labelRef.current.style.transform = `translate(${(half + ox * (lr / d)).toFixed(1)}px,${(half + oy * (lr / d)).toFixed(1)}px)`;
          }
        }
        const gates = live.gates;
        if (next * 2 + 1 < gates.length) {
          dx = (gates[next * 2]! - x) / zoom;
          dz = (gates[next * 2 + 1]! - z) / zoom;
          sx = cx + dx * cos - dz * sin;
          sy = cy + dx * sin + dz * cos;
          ox = sx - half;
          oy = sy - half;
          if (Math.hypot(ox, oy) <= r) {
            dot2On = true;
            if (dot2Ref.current) dot2Ref.current.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
          }
        }
      }
      if (dotOn !== live.dot) show(dotRef.current, (live.dot = dotOn));
      if (dot2On !== live.dot2) show(dot2Ref.current, (live.dot2 = dot2On));
      if (rimOn !== live.rim) {
        live.rim = rimOn;
        show(rimRef.current, rimOn);
        show(labelRef.current, rimOn);
      }
      const ms = performance.now() - t0;
      minimapStats.frames += 1;
      minimapStats.frameMsTotal += ms;
      if (ms > minimapStats.frameMsMax) minimapStats.frameMsMax = ms;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  if (!image) return null;
  return (
    <div className={`mm${shown ? '' : ' is-hidden'}`} ref={rootRef} data-testid="minimap">
      <div
        className="mm__disc"
        role="button"
        aria-label="Map: open the MAPS menu"
        // Opens on click (the last event of a tap): opening on pointerup let the tap's own compatibility
        // click land on whatever the menu put under the finger (the RACE tab in landscape).
        onClick={() => openMenu('maps')}
      >
        <div className="mm__layer" ref={layerRef}>
          <canvas ref={baseRef} />
          <canvas ref={overlayRef} />
        </div>
        <i className="mm__dot mm__dot--after" ref={dot2Ref} />
        <i className="mm__dot" ref={dotRef} />
        <i className="mm__car" aria-hidden="true" />
      </div>
      <b className="mm__north" ref={northRef} aria-hidden="true">
        N
      </b>
      <i className="mm__rim" ref={rimRef} aria-hidden="true" />
      <span className="mm__label" ref={labelRef} data-testid="minimap-distance" />
    </div>
  );
}
