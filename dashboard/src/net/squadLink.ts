import {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  encodeMessage,
  normalizeServerUrl,
  parseMessage,
  withRole,
  type ClientMessage,
  type OutgoingMessage,
  type ProtocolMessage,
} from '../../../shared/protocol';

export type LinkStatus = 'offline' | 'connecting' | 'online' | 'retrying';

export interface LinkState {
  status: LinkStatus;
  /** Normalized relay URL we are (trying to be) connected to, without the ?role= query. */
  url: string | null;
  /** Epoch ms of the next reconnect attempt while `retrying`. */
  retryAt: number | null;
  /** Consecutive failed attempts since the last successful open. */
  attempt: number;
  /** Last transport problem in plain words, cleared on a successful open. */
  error: string | null;
}

export interface SquadLinkHandlers {
  onState(state: LinkState): void;
  /** Socket is open and `hello` has been sent. The server's welcome follows. */
  onOpen(): void;
  /** Every valid frame except `pong` (latency is reported separately). */
  onMessage(message: ProtocolMessage): void;
  onLatency(ms: number): void;
}

/** The subset of the WebSocket API this client uses (RN global, browser and `ws` all satisfy it). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SquadLinkOptions {
  /** Display name sent in `hello` (≤ 40 chars). */
  name: string;
  pingIntervalMs?: number;
  /** Give up on a socket stuck in CONNECTING (unreachable LAN IPs can hang for a minute). */
  connectTimeoutMs?: number;
  /** Treat an open socket as dead when nothing at all arrived for this long (half-open after Wi-Fi hops). */
  staleAfterMs?: number;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
  now?: () => number;
}

const OPEN = 1;
type Timer = ReturnType<typeof setTimeout>;

/**
 * Dashboard WebSocket client: role `dashboard`, `hello` on open, ping/pong latency every ~2 s,
 * exponential backoff with ±25 % jitter, stale-socket detection, and a hard stop after `disconnect()`.
 * Every inbound frame goes through `parseMessage`.
 */
export class SquadLink {
  private readonly handlers: SquadLinkHandlers;
  private readonly name: string;
  private readonly pingIntervalMs: number;
  private readonly connectTimeoutMs: number;
  private readonly staleAfterMs: number;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly random: () => number;
  private readonly now: () => number;

  private socket: SocketLike | null = null;
  private wanted = false;
  private targetUrl: string | null = null;
  private state: LinkState = { status: 'offline', url: null, retryAt: null, attempt: 0, error: null };
  private seq = 0;
  private nonce = 0;
  private readonly pingsInFlight = new Map<number, number>();
  private lastInboundAt = 0;
  private retryTimer: Timer | null = null;
  private connectTimer: Timer | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(handlers: SquadLinkHandlers, options: SquadLinkOptions) {
    this.handlers = handlers;
    this.name = options.name.slice(0, 40);
    this.pingIntervalMs = options.pingIntervalMs ?? 2_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 8_000;
    this.staleAfterMs = options.staleAfterMs ?? 7_000;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === OPEN && this.state.status === 'online';
  }

  getState(): LinkState {
    return this.state;
  }

  /** (Re)connect to `url` (bare host, host:port or ws://…). Resets the backoff. */
  connect(url: string): void {
    this.targetUrl = normalizeServerUrl(url);
    this.wanted = true;
    this.clearRetry();
    this.patch({ url: this.targetUrl, attempt: 0, error: null });
    this.open();
  }

  /** User pressed Disconnect: close and stay closed until `connect()` is called again. */
  disconnect(): void {
    this.wanted = false;
    this.clearRetry();
    this.dropSocket(1000, 'dashboard disconnect');
    this.patch({ status: 'offline', retryAt: null, attempt: 0, error: null });
  }

  /** App came back to the foreground: retry now instead of waiting out the backoff, or re-probe the link. */
  wake(): void {
    if (!this.wanted || !this.targetUrl) return;
    if (this.state.status === 'retrying') {
      this.clearRetry();
      this.patch({ attempt: 0 });
      this.open();
    } else if (this.state.status === 'online') {
      if (this.now() - this.lastInboundAt > this.staleAfterMs) this.handleDead('No response from relay');
      else this.ping();
    }
  }

  /** Stamps `v`, `seq` and `sentAt`. Returns false (frame dropped) when the link is not open. */
  send(message: OutgoingMessage<ClientMessage>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return false;
    try {
      socket.send(encodeMessage({ ...message, seq: ++this.seq, sentAt: this.now() }));
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.wanted = false;
    this.clearRetry();
    this.dropSocket(1000, 'dashboard closed');
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private open(): void {
    const url = this.targetUrl;
    if (!url) return;
    this.dropSocket(1000, 'reconnecting');
    this.patch({ status: 'connecting', retryAt: null });

    let socket: SocketLike;
    try {
      socket = this.createSocket(withRole(url, 'dashboard'));
    } catch (err) {
      this.patch({ error: err instanceof Error && err.message ? err.message : 'Invalid relay address' });
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState !== OPEN) this.handleDead('Connection timed out');
    }, this.connectTimeoutMs);

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.lastInboundAt = this.now();
      this.pingsInFlight.clear();
      this.patch({ status: 'online', attempt: 0, error: null, retryAt: null });
      this.send({ type: 'hello', role: 'dashboard', name: this.name });
      this.startPinging();
      this.handlers.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastInboundAt = this.now();
      if (typeof event.data !== 'string') return;
      const message = parseMessage(event.data);
      if (!message) return;
      if (message.type === 'pong') {
        const sentAt = this.pingsInFlight.get(message.nonce);
        if (sentAt !== undefined) {
          this.pingsInFlight.delete(message.nonce);
          this.handlers.onLatency(Math.max(0, this.now() - sentAt));
        }
        return;
      }
      this.handlers.onMessage(message);
    };
    socket.onerror = (event) => {
      if (this.socket !== socket) return;
      const detail = (event as { message?: unknown } | null)?.message;
      this.patch({ error: typeof detail === 'string' && detail ? detail : 'Could not reach the relay' });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.releaseSocket();
      const error = describeClose(event.code, event.reason, this.state.error);
      if (error !== undefined) this.patch({ error });
      this.afterClose();
    };
  }

  /** The socket is unusable (timeout / stale): abandon it without waiting for a close event that may never come. */
  private handleDead(reason: string): void {
    this.dropSocket(4000, reason);
    this.patch({ error: reason });
    this.afterClose();
  }

  private afterClose(): void {
    if (this.wanted) this.scheduleRetry();
    else this.patch({ status: 'offline', retryAt: null });
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.state.attempt);
    const delay = Math.round(base * (0.75 + this.random() * 0.5));
    this.patch({ status: 'retrying', retryAt: this.now() + delay, attempt: this.state.attempt + 1 });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private startPinging(): void {
    this.stopPinging();
    this.ping();
    this.pingTimer = setInterval(() => {
      if (this.now() - this.lastInboundAt > this.staleAfterMs) {
        this.handleDead('No response from relay');
        return;
      }
      this.ping();
    }, this.pingIntervalMs);
  }

  private ping(): void {
    const nonce = ++this.nonce;
    if (this.send({ type: 'ping', nonce })) {
      this.pingsInFlight.set(nonce, this.now());
      // Only the latest few matter; unanswered ones must not pile up forever.
      if (this.pingsInFlight.size > 8) this.pingsInFlight.delete(this.pingsInFlight.keys().next().value as number);
    }
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Detach and close the current socket so none of its late events reach us. */
  private dropSocket(code: number, reason: string): void {
    const socket = this.socket;
    if (!socket) return;
    this.releaseSocket();
    try {
      socket.close(code, reason.slice(0, 120));
    } catch {
      // Browsers only accept 1000 and 3000–4999; never leave a socket open over a rejected code.
      try {
        socket.close();
      } catch {
        // Already closing or closed.
      }
    }
  }

  private releaseSocket(): void {
    const socket = this.socket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    }
    this.socket = null;
    this.clearConnectTimer();
    this.stopPinging();
    this.pingsInFlight.clear();
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private patch(next: Partial<LinkState>): void {
    const merged = { ...this.state, ...next };
    const keys = Object.keys(next) as (keyof LinkState)[];
    if (keys.every((k) => Object.is(this.state[k], merged[k]))) return;
    this.state = merged;
    this.handlers.onState(this.state);
  }
}

/** Plain-words reason for a close event; undefined keeps the current error (e.g. the onerror detail). */
function describeClose(code: number, reason: string, current: string | null): string | null | undefined {
  if (code === 1000 || code === 1005) return undefined;
  if (code === 1006) return current ?? 'Could not reach the relay';
  if (code === 1001) return 'Relay shut down';
  return `Relay closed the link (${code}${reason ? `: ${reason}` : ''})`;
}
