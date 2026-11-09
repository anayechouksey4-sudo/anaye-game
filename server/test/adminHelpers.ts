import { request, type IncomingHttpHeaders } from 'node:http';
import type { RelayServer } from '../src/relay';

export interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  body: any;
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  /** An object is sent as JSON (Content-Type application/json); a string / Buffer as is. */
  body?: unknown;
}

/** One HTTP request to the relay on 127.0.0.1 (no keep-alive), resolving with the parsed JSON body. */
export function http(relay: RelayServer, path: string, options: HttpOptions = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: Buffer | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) payload = Buffer.from(options.body as string);
    else {
      payload = Buffer.from(JSON.stringify(options.body));
      headers['Content-Type'] ??= 'application/json';
    }
    headers['Content-Length'] = String(payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: relay.port, path, method: options.method ?? 'GET', headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** POST /admin/api/login from `ip` (X-Forwarded-For; the relay must trust the proxy). */
export function login(relay: RelayServer, body: unknown, ip = '203.0.113.10', extra: Record<string, string> = {}): Promise<HttpResult> {
  return http(relay, '/admin/api/login', { method: 'POST', body, headers: { 'X-Forwarded-For': ip, ...extra } });
}

export function authed(relay: RelayServer, session: string, path: string, options: HttpOptions = {}): Promise<HttpResult> {
  return http(relay, `/admin/api/${path}`, { ...options, headers: { Authorization: `Bearer ${session}`, ...(options.headers ?? {}) } });
}
