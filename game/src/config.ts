import { DEFAULT_SERVER_PORT, normalizeServerUrl } from '@shared/protocol';

/** Fixed physics step. Everything in the car model integrates with this dt. */
export const PHYSICS_DT = 1 / 60;

function queryParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function getQueryParam(name: string): string | null {
  const value = queryParams().get(name);
  return value === null || value.trim() === '' ? null : value.trim();
}

/** Where the SquadHQ relay lives, and why we picked it (shown in the HUD). */
export interface ServerUrlResolution {
  url: string;
  source: 'query' | 'env' | 'default';
}

/**
 * Resolution order: `?ws=` (host, host:port or full ws:// URL) → `VITE_SQUAD_WS_URL` →
 * `ws://<page host>:8787`, so a phone on the same LAN works without configuration.
 */
export function resolveServerUrl(): ServerUrlResolution {
  const fromQuery = getQueryParam('ws');
  if (fromQuery) return { url: normalizeServerUrl(fromQuery), source: 'query' };

  const fromEnv = import.meta.env.VITE_SQUAD_WS_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { url: normalizeServerUrl(fromEnv), source: 'env' };
  }

  const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
  return { url: `ws://${host}:${DEFAULT_SERVER_PORT}`, source: 'default' };
}

/** `?ws=off` disables networking entirely (offline play / screenshots). */
export function isNetworkDisabled(): boolean {
  const value = getQueryParam('ws');
  return value !== null && ['off', 'none', '0', 'false'].includes(value.toLowerCase());
}

/** `?track=<id>`; null means "use the default track". */
export function getTrackParam(): string | null {
  return getQueryParam('track');
}

/** `?debug=1` turns on the Rapier collider wireframes. */
export function isPhysicsDebug(): boolean {
  const value = getQueryParam('debug');
  return value !== null && value !== '0' && value.toLowerCase() !== 'false';
}
