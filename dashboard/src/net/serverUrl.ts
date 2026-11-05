import { DEFAULT_SERVER_PORT, normalizeServerUrl } from '../../../shared/protocol';

export const FALLBACK_SERVER_URL = `ws://localhost:${DEFAULT_SERVER_PORT}`;

/** Host part of `host:port`, `[v6]:port` or a bare host. Returns null for empty input. */
export function hostFromHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;
  const trimmed = hostUri.trim().replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 0 ? trimmed.slice(0, end + 1) : null;
  }
  const host = trimmed.split(':')[0];
  return host ? host : null;
}

/**
 * Best first guess for the relay: it usually runs on the same machine as Metro (`npm run dev:all`).
 *   native  → Constants.expoConfig.hostUri ("192.168.1.23:8081") → ws://192.168.1.23:8787
 *   web     → window.location.hostname
 *   neither → ws://localhost:8787
 */
export function defaultServerUrl(sources: { hostUri?: string | null; webHostname?: string | null }): string {
  const host = hostFromHostUri(sources.hostUri) ?? hostFromHostUri(sources.webHostname);
  return host ? normalizeServerUrl(host, DEFAULT_SERVER_PORT) : FALLBACK_SERVER_URL;
}

/**
 * Validates what the user typed. Returns the normalized ws:// URL or an error message.
 * The protocol helper handles bare hosts and host:port; this adds the checks a text box needs.
 */
export function parseServerUrlInput(input: string): { url: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'Enter the relay address, e.g. 192.168.1.23 or ws://192.168.1.23:8787' };
  if (/\s/.test(trimmed)) return { error: 'The address cannot contain spaces' };
  const url = normalizeServerUrl(trimmed, DEFAULT_SERVER_PORT);
  const match = /^wss?:\/\/(\[[^\]]+\]|[^/:?#]+)(:(\d+))?/i.exec(url);
  if (!match) return { error: 'That does not look like a host name or IP address' };
  const port = match[3] === undefined ? null : Number(match[3]);
  if (port !== null && (port < 1 || port > 65535)) return { error: 'Port must be between 1 and 65535' };
  return { url };
}
