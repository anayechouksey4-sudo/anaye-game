/**
 * Name tags over kinematic cars without a draw call: KinematicCar registers a tag (text, colour) and
 * writes its world anchor every frame; <TagProjector/> (in the canvas, mounted by RivalsLayer)
 * projects every anchor to screen pixels after the camera moved and lays the pills out so they never
 * cover each other; <NameTags/> (in the HUD) writes the result into DOM nodes from rAF. Fixed-size
 * pools, nothing allocated per frame.
 *
 * Layout (layoutTags): a pill is drawn when its car is in front of the camera, nearer than FAR_NDC
 * (~110 m) and its box lies inside the tag layer (under the top bar, above the thumbs). Pills are
 * taken from the bottom of the screen up (the chase camera puts the nearest car lowest); one that
 * would cover a pill already placed is pushed up onto the row above it, at most MAX_ROWS rows and
 * MAX_PUSH_PX in all, else the farther of the two is hidden. Two cars within FADE_NEAR_M of each
 * other: the farther one's pill fades so the nearer name stays readable.
 */
import { Vector3, type Camera } from 'three';

export const MAX_TAGS = 16;
/** Tags beyond this depth (NDC z) are hidden; nearer ones shrink with distance. */
export const FAR_NDC = 0.9985;
/** …and never beyond this many metres from the camera, whatever the camera's planes make of FAR_NDC. */
export const FAR_M = 110;
/** Stacking limits: rows above the lowest pill, total upward push before the farther pill hides instead. */
export const MAX_ROWS = 3;
export const MAX_PUSH_PX = 48;
/** Cars closer than this (m) fade the farther car's pill. */
export const FADE_NEAR_M = 2;
/** Pills whose anchors are this close vertically keep last frame's order (no row swapping while side by side). */
const HYSTERESIS_PX = 8;
const ROW_GAP_PX = 2;
const MIN_OPACITY = 0.3;

export interface TagEntry {
  id: number;
  text: string;
  color: string;
  active: boolean;
  /** World anchor (mutated in place). */
  world: Vector3;
  /** Raw projection in CSS px of the canvas and NDC depth, written by the projector. */
  sx: number;
  sy: number;
  depth: number;
  /** In front of the camera and inside the frustum (projector). */
  visible: boolean;
  /** Pill size at scale 1 in CSS px (measured by the HUD once the pill exists; estimated before). */
  w: number;
  h: number;
  /** Layout result: drawn at all, bottom-centre y after stacking, scale and opacity. */
  shown: boolean;
  y: number;
  scale: number;
  opacity: number;
  /** Stack row (0 = on its anchor) and last frame's order index, for a stable stack. */
  row: number;
  rank: number;
}

const estimateWidth = (text: string): number => Math.round(text.length * 7.2 + 16);

const tags: TagEntry[] = Array.from({ length: MAX_TAGS }, (_, id) => ({
  id, text: '', color: '', active: false, world: new Vector3(), sx: 0, sy: 0, depth: 0, visible: false,
  w: 60, h: 18, shown: false, y: 0, scale: 1, opacity: 1, row: 0, rank: MAX_TAGS,
}));
let serial = 0;
const listeners = new Set<() => void>();

/** Which tags exist (changes rarely: register / unregister bump `serial`). */
export const tagSerial = (): number => serial;
export const tagList = (): readonly TagEntry[] => tags;

export function subscribeTags(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  serial++;
  for (const fn of listeners) fn();
}

export function registerTag(text: string, color: string): number {
  const free = tags.find((t) => !t.active);
  if (!free) return -1;
  free.active = true;
  free.text = text;
  free.color = color;
  free.visible = false;
  free.shown = false;
  free.w = estimateWidth(text);
  free.h = 18;
  free.rank = MAX_TAGS;
  notify();
  return free.id;
}

export function unregisterTag(id: number): void {
  const t = tags[id];
  if (!t || !t.active) return;
  t.active = false;
  t.visible = false;
  t.shown = false;
  notify();
}

export function updateTag(id: number, x: number, y: number, z: number): void {
  const t = tags[id];
  if (t) t.world.set(x, y, z);
}

/** The HUD measured the pill (CSS px at scale 1). */
export function setTagSize(id: number, w: number, h: number): void {
  const t = tags[id];
  if (t && w > 0 && h > 0) {
    t.w = w;
    t.h = h;
  }
}

/** The tag layer's box in viewport CSS px (the HUD reports it; pills must lie inside). Unset = the whole canvas. */
const bounds = { set: false, left: 0, top: 0, right: 0, bottom: 0 };
export function setTagBounds(left: number, top: number, width: number, height: number): void {
  bounds.set = true;
  bounds.left = left;
  bounds.top = top;
  bounds.right = left + width;
  bounds.bottom = top + height;
}
export function clearTagBounds(): void {
  bounds.set = false;
}

/** Boxes inside the layer a pill must not touch (the thumb controls; the HUD reports them). */
export interface TagRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const MAX_EXCLUSIONS = 6;
const exclusions: TagRect[] = Array.from({ length: MAX_EXCLUSIONS }, () => ({ left: 0, top: 0, right: 0, bottom: 0 }));
let exclusionCount = 0;
export function setTagExclusions(rects: readonly TagRect[]): void {
  exclusionCount = Math.min(rects.length, MAX_EXCLUSIONS);
  for (let i = 0; i < exclusionCount; i++) {
    const r = rects[i]!;
    const e = exclusions[i]!;
    e.left = r.left;
    e.top = r.top;
    e.right = r.right;
    e.bottom = r.bottom;
  }
}

const _p = new Vector3();

/** Project every active tag with `camera` into CSS pixels of a `width × height` viewport, then lay the pills out. */
export function projectTags(camera: Camera, width: number, height: number): void {
  for (const t of tags) {
    if (!t.active) continue;
    _p.copy(t.world).project(camera);
    const inFront = _p.z < 1 && _p.z > -1;
    t.visible = inFront && _p.x > -1.1 && _p.x < 1.1 && _p.y > -1.1 && _p.y < 1.1 && t.world.distanceTo(camera.position) <= FAR_M;
    t.sx = ((_p.x + 1) / 2) * width;
    t.sy = ((1 - _p.y) / 2) * height;
    t.depth = _p.z;
  }
  layoutTags(width, height);
}

const order: TagEntry[] = [];

const halfW = (t: TagEntry): number => (t.w * t.scale) / 2;
const boxH = (t: TagEntry): number => t.h * t.scale;
const overlapsX = (a: TagEntry, b: TagEntry): boolean => Math.abs(a.sx - b.sx) < halfW(a) + halfW(b) + 2;
/** `t` (bottom at t.y) covers `p` (already placed) vertically, counting the row gap. */
const overlapsY = (t: TagEntry, p: TagEntry): boolean => t.y > p.y - boxH(p) - ROW_GAP_PX && t.y - boxH(t) < p.y + ROW_GAP_PX;

function touchesExclusion(t: TagEntry): boolean {
  const l = t.sx - halfW(t), r = t.sx + halfW(t), b = t.sy, tp = t.sy - boxH(t);
  for (let i = 0; i < exclusionCount; i++) {
    const e = exclusions[i]!;
    if (l < e.right && r > e.left && tp < e.bottom && b > e.top) return true;
  }
  return false;
}

/**
 * The pill layout over the raw projection (pure, idempotent per frame; exported for the unit test).
 * `width × height` is the canvas; the HUD's bounds (setTagBounds) win when set.
 */
export function layoutTags(width: number, height: number): void {
  const left = bounds.set ? bounds.left : 0;
  const top = bounds.set ? bounds.top : 0;
  const right = bounds.set ? bounds.right : width;
  const bottom = bounds.set ? bounds.bottom : height;
  order.length = 0;
  for (const t of tags) {
    t.shown = false;
    if (!t.active || !t.visible || t.depth >= FAR_NDC) continue;
    t.scale = Math.max(0.6, Math.min(1, (FAR_NDC - t.depth) * 400));
    t.y = t.sy;
    t.opacity = 1;
    t.row = 0;
    // Whole pill inside the layer (a pill half under the bar or over the thumbs is worse than none).
    if (t.sx - halfW(t) < left || t.sx + halfW(t) > right || t.sy - boxH(t) < top || t.sy > bottom) continue;
    if (touchesExclusion(t)) continue;
    order.push(t);
  }
  // Lowest on screen first; anchors within HYSTERESIS_PX keep last frame's order.
  for (let i = 1; i < order.length; i++) {
    const t = order[i]!;
    let j = i - 1;
    while (j >= 0) {
      const p = order[j]!;
      const before = Math.abs(p.sy - t.sy) < HYSTERESIS_PX ? p.rank <= t.rank : p.sy >= t.sy;
      if (before) break;
      order[j + 1] = p;
      j--;
    }
    order[j + 1] = t;
  }
  for (let i = 0; i < order.length; i++) {
    const t = order[i]!;
    let hide = false;
    // Push up past every placed pill it covers (a push can land it on another one: a few rounds).
    for (let round = 0; round < MAX_ROWS + 1; round++) {
      let moved = false;
      for (let j = 0; j < i; j++) {
        const p = order[j]!;
        if (!p.shown || !overlapsX(t, p) || !overlapsY(t, p)) continue;
        t.y = p.y - boxH(p) - ROW_GAP_PX;
        t.row = Math.max(t.row, p.row + 1);
        moved = true;
        if (t.row >= MAX_ROWS || t.sy - t.y > MAX_PUSH_PX || t.y - boxH(t) < top) {
          // Cannot be resolved: the farther of the two goes.
          if (t.depth < p.depth) {
            p.shown = false;
            t.y = t.sy;
            t.row = 0;
          } else hide = true;
          break;
        }
      }
      if (hide || !moved) break;
    }
    t.shown = !hide;
  }
  for (let i = 0; i < order.length; i++) order[i]!.rank = i;
  // Cars within FADE_NEAR_M: the farther pill fades toward MIN_OPACITY as the gap closes.
  for (let i = 0; i < order.length; i++) {
    const a = order[i]!;
    if (!a.shown) continue;
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]!;
      if (!b.shown) continue;
      const d = a.world.distanceTo(b.world);
      if (d >= FADE_NEAR_M) continue;
      const far = a.depth > b.depth ? a : b;
      far.opacity = Math.min(far.opacity, MIN_OPACITY + (1 - MIN_OPACITY) * (d / FADE_NEAR_M));
    }
  }
}

/** Test seam: set a tag's raw projection as the projector would. */
export function setTagProjection(id: number, sx: number, sy: number, depth: number, visible = true): void {
  const t = tags[id];
  if (!t) return;
  t.sx = sx;
  t.sy = sy;
  t.depth = depth;
  t.visible = visible;
}
