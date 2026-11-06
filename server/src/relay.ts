import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CLIENT_ROLES,
  DEFAULT_SERVER_PORT,
  HEARTBEAT_INTERVAL_MS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  RELAY_RULES,
  encodeMessage,
  isClientMessage,
  isClientRole,
  parseMessage,
  type ClientMessage,
  type ClientRole,
  type ErrorMessage,
  type GameSessionInfo,
  type GameStateMessage,
  type GameTelemetryMessage,
  type OutgoingMessage,
  type PeerCounts,
  type PhysicsSetMessage,
  type ServerSnapshot,
  type SquadControlsMessage,
} from '../../shared/protocol';
import { formatControls, formatPeers, formatPhysics, formatSession } from './format';
import { displayHost } from './network';
import { createThrottledLog } from './throttled-log';

export interface RelayLogger {
  info(line: string): void;
  warn(line: string): void;
}

export const silentLogger: RelayLogger = { info() {}, warn() {} };

export interface RateLimitOptions {
  /** Sustained frames per second per client. */
  perSecond: number;
  /** Bucket size: frames a client may send back-to-back before being limited. */
  burst: number;
}

export interface RelayServerOptions {
  /** TCP port; 0 picks a free one. Default DEFAULT_SERVER_PORT. */
  port?: number;
  /** Bind address. Default '0.0.0.0' so phones on the LAN can reach it. */
  host?: string;
  /** WebSocket ping interval. A client that has not answered the previous ping is terminated. */
  heartbeatMs?: number;
  logger?: RelayLogger;
  rateLimit?: RateLimitOptions;
  /** Consecutive invalid/forbidden frames before the socket is closed with 1008. */
  maxConsecutiveBadFrames?: number;
  /** Telemetry is skipped for a client whose send buffer exceeds this many bytes. */
  telemetryBackpressureBytes?: number;
}

export interface RelayCounters {
  framesIn: number;
  framesRelayed: number;
  badFrames: number;
  forbiddenFrames: number;
  rateLimitedFrames: number;
  telemetrySkipped: number;
  heartbeatTerminations: number;
}

export interface RelayClientInfo {
  id: string;
  role: ClientRole;
  name: string | null;
  remoteAddress: string;
  connectedAt: number;
}

export interface RelayStats {
  uptimeSec: number;
  peers: PeerCounts;
  clients: RelayClientInfo[];
  snapshot: ServerSnapshot;
  counters: RelayCounters;
}

export interface RelayServer {
  /** Actual bound port (useful with port 0). */
  readonly port: number;
  readonly host: string;
  /** ws:// URL reachable from this machine. */
  readonly url: string;
  /** Closes every client with 1001, then the HTTP server. Idempotent. */
  close(): Promise<void>;
  stats(): RelayStats;
}

export const RELAY_DEFAULTS = {
  host: '0.0.0.0',
  rateLimit: { perSecond: 120, burst: 240 },
  maxConsecutiveBadFrames: 20,
  telemetryBackpressureBytes: 1024 * 1024,
} as const;

/** How long `close()` waits for clients to finish the closing handshake before terminating them. */
const CLOSE_GRACE_MS = 1000;
const RATE_LIMIT_ERROR_INTERVAL_MS = 1000;
const LOG_THROTTLE_MS = 1000;

interface Client {
  id: string;
  ws: WebSocket;
  role: ClientRole;
  name: string | null;
  remoteAddress: string;
  connectedAt: number;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  lastRateLimitErrorAt: number;
  consecutiveBadFrames: number;
}

type RelayedMessage = SquadControlsMessage | PhysicsSetMessage | GameStateMessage | GameTelemetryMessage;

export async function createRelayServer(options: RelayServerOptions = {}): Promise<RelayServer> {
  const host = options.host ?? RELAY_DEFAULTS.host;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const logger = options.logger ?? silentLogger;
  const rateLimit = options.rateLimit ?? RELAY_DEFAULTS.rateLimit;
  const maxBadFrames = options.maxConsecutiveBadFrames ?? RELAY_DEFAULTS.maxConsecutiveBadFrames;
  const backpressureBytes = options.telemetryBackpressureBytes ?? RELAY_DEFAULTS.telemetryBackpressureBytes;

  const startedAt = Date.now();
  const clients = new Map<WebSocket, Client>();
  const snapshot: ServerSnapshot = { controls: null, physics: null, telemetry: null };
  const counters: RelayCounters = {
    framesIn: 0,
    framesRelayed: 0,
    badFrames: 0,
    forbiddenFrames: 0,
    rateLimitedFrames: 0,
    telemetrySkipped: 0,
    heartbeatTerminations: 0,
  };
  let nextClientNumber = 1;
  let shuttingDown = false;
  let closePromise: Promise<void> | undefined;

  const info = (line: string): void => logger.info(line);
  const warn = (line: string): void => logger.warn(line);
  const controlsLog = createThrottledLog(LOG_THROTTLE_MS, info);
  const physicsLog = createThrottledLog(LOG_THROTTLE_MS, info);
  const stateLog = createThrottledLog(LOG_THROTTLE_MS, info);
  const badFrameLog = createThrottledLog(LOG_THROTTLE_MS, warn);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const peerCounts = (): PeerCounts => {
    const peers: PeerCounts = { game: 0, dashboard: 0, observer: 0 };
    for (const c of clients.values()) peers[c.role] += 1;
    return peers;
  };

  const describe = (c: Client): string => `${c.role} ${c.id}${c.name ? ` "${c.name}"` : ''}`;

  const sendFrame = (c: Client, frame: string): boolean => {
    if (c.ws.readyState !== WebSocket.OPEN) return false;
    c.ws.send(frame);
    return true;
  };

  const send = (c: Client, message: OutgoingMessage): boolean => sendFrame(c, encodeMessage(message));

  const sendError = (c: Client, code: ErrorMessage['code'], message: string): void => {
    send(c, { type: 'server:error', code, message });
  };

  const sendWelcome = (c: Client): void => {
    send(c, {
      type: 'server:welcome',
      clientId: c.id,
      role: c.role,
      protocolVersion: PROTOCOL_VERSION,
      snapshot: { ...snapshot },
      peers: peerCounts(),
    });
  };

  const broadcastPresence = (): void => {
    if (shuttingDown) return;
    const frame = encodeMessage({ type: 'server:presence', peers: peerCounts() });
    for (const c of clients.values()) sendFrame(c, frame);
  };

  /** Token bucket; returns false when the frame must be dropped. */
  const takeToken = (c: Client): boolean => {
    const now = performance.now();
    c.tokens = Math.min(rateLimit.burst, c.tokens + ((now - c.lastRefill) / 1000) * rateLimit.perSecond);
    c.lastRefill = now;
    if (c.tokens >= 1) {
      c.tokens -= 1;
      return true;
    }
    return false;
  };

  const rejectFrame = (c: Client, code: 'bad_message' | 'forbidden', reason: string): void => {
    if (code === 'bad_message') counters.badFrames += 1;
    else counters.forbiddenFrames += 1;
    c.consecutiveBadFrames += 1;
    badFrameLog.push((n) => `! ${describe(c)}: ${code} (${reason})${n > 1 ? ` [${n} rejected frames in the last second]` : ''}`);
    if (c.consecutiveBadFrames >= maxBadFrames) {
      logger.warn(`! closing ${describe(c)}: ${c.consecutiveBadFrames} consecutive bad frames`);
      sendError(c, code, `${reason}; closing after ${c.consecutiveBadFrames} consecutive bad frames`);
      c.ws.close(1008, 'too many bad frames');
      return;
    }
    sendError(c, code, reason);
  };

  /** Re-encodes the sanitized message (never the raw bytes) with `from` stamped by the server. */
  const relay = (sender: Client, message: RelayedMessage): void => {
    const rule = RELAY_RULES[message.type];
    const frame = encodeMessage({ ...message, from: sender.id });
    const isTelemetry = message.type === 'game:telemetry';
    for (const target of clients.values()) {
      if (target === sender) continue;
      if (rule === 'non-game' && target.role === 'game') continue;
      if (isTelemetry && target.ws.bufferedAmount > backpressureBytes) {
        counters.telemetrySkipped += 1;
        continue;
      }
      if (sendFrame(target, frame)) counters.framesRelayed += 1;
    }
  };

  // ── Routing ──────────────────────────────────────────────────────────────

  const dispatch = (c: Client, message: ClientMessage): void => {
    switch (message.type) {
      case 'hello': {
        const previous = c.role;
        c.role = message.role;
        if (message.name !== undefined) c.name = message.name;
        sendWelcome(c);
        broadcastPresence();
        logger.info(
          `~ ${c.id} hello: ${previous === c.role ? `role ${c.role}` : `${previous} → ${c.role}`}` +
            `${c.name ? ` "${c.name}"` : ''} (${formatPeers(peerCounts())})`,
        );
        return;
      }
      case 'squad:controls': {
        snapshot.controls = message.controls;
        relay(c, message);
        controlsLog.push(
          (n) => `controls ← ${c.id}: ${formatControls(message.controls)}${n > 1 ? `  [${n} updates/s]` : ''}`,
        );
        return;
      }
      case 'physics:set': {
        relay(c, message);
        physicsLog.push((n) => `physics:set ← ${c.id}: ${formatPhysics(message.params)}${n > 1 ? `  [${n}/s]` : ''}`);
        return;
      }
      case 'game:state': {
        snapshot.physics = message.physics;
        const { carId, trackId, bigJumpKmh, driverName, rideName } = message;
        if (carId !== undefined || trackId !== undefined || bigJumpKmh !== undefined || driverName !== undefined || rideName !== undefined) {
          const session: GameSessionInfo = {};
          if (carId !== undefined) session.carId = carId;
          if (trackId !== undefined) session.trackId = trackId;
          if (bigJumpKmh !== undefined) session.bigJumpKmh = bigJumpKmh;
          // Driver / MY RIDE names (optional): a late dashboard's welcome shows who is at the wheel too.
          if (driverName !== undefined) session.driverName = driverName;
          if (rideName !== undefined) session.rideName = rideName;
          snapshot.session = session;
        }
        relay(c, message);
        const session = formatSession(message);
        stateLog.push(
          (n) => `game:state ← ${c.id}: ${session ? `${session} · ` : ''}${formatPhysics(message.physics)}${n > 1 ? `  [${n}/s]` : ''}`,
        );
        return;
      }
      case 'game:telemetry': {
        snapshot.telemetry = message.telemetry;
        relay(c, message);
        return;
      }
      case 'ping': {
        send(c, { type: 'pong', nonce: message.nonce, serverTime: Date.now() });
        return;
      }
    }
  };

  const onFrame = (c: Client, data: RawData, isBinary: boolean): void => {
    counters.framesIn += 1;
    if (!takeToken(c)) {
      counters.rateLimitedFrames += 1;
      const now = performance.now();
      if (now - c.lastRateLimitErrorAt >= RATE_LIMIT_ERROR_INTERVAL_MS) {
        c.lastRateLimitErrorAt = now;
        sendError(c, 'rate_limited', `over ${rateLimit.perSecond} frames/s; frames are being dropped`);
        logger.warn(`! ${describe(c)} is rate limited`);
      }
      return;
    }
    if (isBinary) {
      rejectFrame(c, 'bad_message', 'binary frames are not supported; send JSON text');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(rawToString(data));
    } catch {
      rejectFrame(c, 'bad_message', 'invalid JSON');
      return;
    }
    const type = isRecordWithType(json) ? json.type : undefined;
    if (type !== undefined && (type.startsWith('server:') || type === 'pong')) {
      rejectFrame(c, 'forbidden', `clients may not send '${type}'`);
      return;
    }
    const message = parseMessage(json);
    if (!message || !isClientMessage(message)) {
      rejectFrame(c, 'bad_message', type === undefined ? 'expected an object with a string "type"' : `invalid or unknown '${type.slice(0, 40)}' message`);
      return;
    }
    c.consecutiveBadFrames = 0;
    dispatch(c, message);
  };

  // ── Connections ──────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const queryRole = new URL(req.url ?? '/', 'http://relay.invalid').searchParams.get('role');
    const now = performance.now();
    const c: Client = {
      id: `c${nextClientNumber++}`,
      ws,
      role: isClientRole(queryRole) ? queryRole : 'observer',
      name: null,
      remoteAddress: (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, ''),
      connectedAt: Date.now(),
      alive: true,
      tokens: rateLimit.burst,
      lastRefill: now,
      lastRateLimitErrorAt: -Infinity,
      consecutiveBadFrames: 0,
    };
    clients.set(ws, c);

    ws.on('pong', () => {
      c.alive = true;
    });
    ws.on('message', (data, isBinary) => onFrame(c, data, isBinary));
    ws.on('error', (err) => {
      // ws emits this for protocol violations (oversized frame → 1009, bad UTF-8 → 1007) and then closes.
      logger.warn(`! ${describe(c)} socket error: ${err.message}`);
    });
    ws.on('close', (code, reason) => {
      clients.delete(ws);
      broadcastPresence();
      const why = reason.length > 0 ? ` ${reason.toString('utf8')}` : '';
      logger.info(`- ${describe(c)} disconnected (${code}${why}) (${formatPeers(peerCounts())})`);
    });

    sendWelcome(c);
    broadcastPresence();
    logger.info(`+ ${describe(c)} connected from ${c.remoteAddress} (${formatPeers(peerCounts())})`);
  });

  const heartbeat = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) {
        counters.heartbeatTerminations += 1;
        logger.warn(`! ${describe(c)} missed a heartbeat; terminating`);
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  // ── HTTP ─────────────────────────────────────────────────────────────────

  const health = () => ({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    peers: peerCounts(),
    snapshot,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  });

  const handleHttp = (req: IncomingMessage, res: ServerResponse): void => {
    const { pathname } = new URL(req.url ?? '/', 'http://relay.invalid');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { ok: false, error: 'method not allowed' }, { Allow: 'GET, HEAD' });
      return;
    }
    if (pathname === '/health') {
      writeJson(res, 200, health());
      return;
    }
    if (pathname === '/') {
      writeInfoPage(res, req.headers.host, peerCounts());
      return;
    }
    writeJson(res, 404, { ok: false, error: 'not found' });
  };

  const httpServer = createServer(handleHttp);
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  httpServer.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(options.port ?? DEFAULT_SERVER_PORT, host, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    clearInterval(heartbeat);
    wss.close();
    throw err;
  }
  httpServer.on('error', (err) => logger.warn(`! http server error: ${err.message}`));

  const port = (httpServer.address() as AddressInfo).port;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      shuttingDown = true;
      clearInterval(heartbeat);
      for (const log of [controlsLog, physicsLog, stateLog, badFrameLog]) log.cancel();

      const open = [...clients.values()];
      const closed = Promise.all(
        open.map(
          (c) =>
            new Promise<void>((resolve) => {
              if (c.ws.readyState === WebSocket.CLOSED) resolve();
              else c.ws.once('close', () => resolve());
            }),
        ),
      );
      for (const c of open) c.ws.close(1001, 'server shutting down');
      const force = setTimeout(() => {
        for (const c of open) c.ws.terminate();
      }, CLOSE_GRACE_MS);
      await closed;
      clearTimeout(force);

      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    })();
    return closePromise;
  };

  return {
    port,
    host,
    url: `ws://${displayHost(host)}:${port}`,
    close,
    stats: () => ({
      uptimeSec: (Date.now() - startedAt) / 1000,
      peers: peerCounts(),
      clients: [...clients.values()].map((c) => ({
        id: c.id,
        role: c.role,
        name: c.name,
        remoteAddress: c.remoteAddress,
        connectedAt: c.connectedAt,
      })),
      snapshot: { ...snapshot },
      counters: { ...counters },
    }),
  };
}

// ── Module-level helpers ────────────────────────────────────────────────────

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function isRecordWithType(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // The web game and Expo web may poll /health from another origin.
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function writeInfoPage(res: ServerResponse, hostHeader: string | undefined, peers: PeerCounts): void {
  const wsUrl = escapeHtml(`ws://${hostHeader ?? `localhost:${DEFAULT_SERVER_PORT}`}`);
  const peerList = CLIENT_ROLES.map((role) => `${role}: ${peers[role]}`).join(' · ');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SquadHQ Relay</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}code{background:#8882;padding:.1em .3em;border-radius:4px}</style>
</head><body>
<h1>SquadHQ relay</h1>
<p>Protocol v${PROTOCOL_VERSION} WebSocket relay between the SquadHQ dashboard and the racer.</p>
<p>Connect to <code>${wsUrl}</code>, adding <code>?role=game</code> or <code>?role=dashboard</code>.</p>
<p>Connected now: ${escapeHtml(peerList)}</p>
<p>Machine-readable status: <a href="/health"><code>/health</code></a></p>
</body></html>
`);
}
