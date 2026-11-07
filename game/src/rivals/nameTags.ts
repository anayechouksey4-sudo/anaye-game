/**
 * Name tags over kinematic cars without a draw call: KinematicCar registers a tag (text, colour) and
 * writes its world anchor every frame; <TagProjector/> (in the canvas, mounted by RivalsLayer)
 * projects every anchor to screen pixels after the camera moved; <NameTags/> (in the HUD) writes
 * the pixels into DOM nodes from rAF. Fixed-size pools, nothing allocated per frame.
 */
import { Vector3, type Camera } from 'three';

export const MAX_TAGS = 16;

export interface TagEntry {
  id: number;
  text: string;
  color: string;
  active: boolean;
  /** World anchor (mutated in place). */
  world: Vector3;
  /** Screen position in CSS px and visibility, written by the projector. */
  sx: number;
  sy: number;
  depth: number;
  visible: boolean;
}

const tags: TagEntry[] = Array.from({ length: MAX_TAGS }, (_, id) => ({ id, text: '', color: '', active: false, world: new Vector3(), sx: 0, sy: 0, depth: 0, visible: false }));
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
  notify();
  return free.id;
}

export function unregisterTag(id: number): void {
  const t = tags[id];
  if (!t || !t.active) return;
  t.active = false;
  t.visible = false;
  notify();
}

export function updateTag(id: number, x: number, y: number, z: number): void {
  const t = tags[id];
  if (t) t.world.set(x, y, z);
}

const _p = new Vector3();

/** Project every active tag with `camera` into CSS pixels of a `width × height` viewport. */
export function projectTags(camera: Camera, width: number, height: number): void {
  for (const t of tags) {
    if (!t.active) continue;
    _p.copy(t.world).project(camera);
    const inFront = _p.z < 1 && _p.z > -1;
    t.visible = inFront && _p.x > -1.1 && _p.x < 1.1 && _p.y > -1.1 && _p.y < 1.1;
    t.sx = ((_p.x + 1) / 2) * width;
    t.sy = ((1 - _p.y) / 2) * height;
    t.depth = _p.z;
  }
}
