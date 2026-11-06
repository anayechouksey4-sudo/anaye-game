/**
 * Respawn seam. An open world installs a resolver (free roam: the last safe road pose; 'travel':
 * a travel spot). Without one, Car.tsx places the car exactly as before (layout checkpoint), so
 * every other map is unchanged. 'debug' (__RACER__.teleport) always bypasses it.
 */
import type { RespawnReason } from '../game/events';
import type { Vec3 } from './types';

export type RespawnResolver = (checkpoint: number, reason: RespawnReason) => { position: Vec3; yaw: number } | null;

let resolver: RespawnResolver | null = null;

/** Install a resolver; returns the uninstaller (safe under StrictMode double mounts). */
export function setRespawnResolver(fn: RespawnResolver): () => void {
  resolver = fn;
  return () => {
    if (resolver === fn) resolver = null;
  };
}

export function resolveRespawn(checkpoint: number, reason: RespawnReason): { position: Vec3; yaw: number } | null {
  return resolver && reason !== 'debug' ? resolver(checkpoint, reason) : null;
}
