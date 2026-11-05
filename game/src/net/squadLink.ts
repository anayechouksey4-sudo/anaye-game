/**
 * WebSocket client (role "game") for the SquadHQ relay.
 *
 *   in   server:welcome  → apply snapshot.controls, dashboards count, announce our state
 *        squad:controls  → applySquadControls (mapSquadControlsToPhysics) — used on the next physics step
 *        physics:set     → patchPhysics
 *        server:presence → dashboards count
 *   out  hello on open; game:state ~100 ms after any physics/controls change;
 *        game:telemetry every TELEMETRY_INTERVAL_MS; ping every few seconds (RTT + dead-link detection)
 *
 * Reconnects forever with exponential backoff + jitter. Every inbound frame goes through parseMessage.
 */
import { useEffect } from 'react';
import {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  TELEMETRY_INTERVAL_MS,
  encodeMessage,
  parseMessage,
  withRole,
  type OutgoingMessage,
  type ProtocolMessage,
  type SquadControls,
} from '@shared/protocol';
import { isNetworkDisabled, resolveServerUrl } from '../config';
import { gameState, useGameStore } from '../state/store';
import { buildTelemetry } from './telemetry';

/** game:state goes out at most this often (and this long after the first change of a burst). */
const STATE_THROTTLE_MS = 100;
const PING_INTERVAL_MS = 3000;
/** No frame at all for this long (despite our pings) ⇒ treat the socket as dead. */
const SILENCE_TIMEOUT_MS = 10_000;
const CLIENT_NAME = 'GamerFleet Racer';

export function describeControls(c: SquadControls): string {
  const bal = c.chassisBalance > 0 ? `+${c.chassisBalance}` : `${c.chassisBalance}`;
  return `AERO ${c.frontWingAero}% · TIER ${c.engineTier} · BAL ${bal}`;
}

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
  // "Equal jitter": half fixed, half random, so a restarted relay is not stampeded.
  return Math.round(base / 2 + (random() * base) / 2);
}

export class SquadLink {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private seq = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private lastFrameAt = 0;
  private pendingPings = new Map<number, number>();
  private pingNonce = 0;

  /** Counters for diagnostics / tests. */
  readonly stats = { sent: 0, received: 0, rejected: 0, connects: 0 };

  constructor(url: string) {
    this.url = url;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      if (state.physics !== prev.physics || state.controls !== prev.controls) this.scheduleState();
    });
    // Deferred one tick: React StrictMode's throwaway first mount stops us before a socket exists.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 0);
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, 'client stopped');
      } catch {
        // Already closing.
      }
    }
    gameState().setLinkStatus('disconnected');
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(message: OutgoingMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(encodeMessage({ ...message, seq: ++this.seq, sentAt: Date.now() } as OutgoingMessage));
    this.stats.sent++;
    return true;
  }

  private connect(): void {
    if (this.stopped) return;
    const s = gameState();
    s.setLinkStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(withRole(this.url, 'game'));
    } catch (err) {
      s.pushUplink('error', `bad relay URL ${this.url}: ${(err as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.stats.connects++;
      this.lastFrameAt = performance.now();
      this.pendingPings.clear();
      gameState().setLinkStatus('connected');
      gameState().pushUplink('link', `connected · ${this.url}`);
      this.send({ type: 'hello', role: 'game', name: CLIENT_NAME });
      this.telemetryTimer = setInterval(() => this.send({ type: 'game:telemetry', telemetry: buildTelemetry() }), TELEMETRY_INTERVAL_MS);
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      this.lastFrameAt = performance.now();
      if (typeof event.data !== 'string') return;
      const message = parseMessage(event.data);
      if (!message) {
        this.stats.rejected++;
        return;
      }
      this.stats.received++;
      this.handle(message);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      gameState().setLinkStatus('disconnected');
      gameState().setRtt(null);
      this.scheduleReconnect();
    };

    // A close event always follows an error; reconnect handling lives there.
    ws.onerror = () => {};
  }

  private handle(message: ProtocolMessage): void {
    const s = gameState();
    switch (message.type) {
      case 'server:welcome': {
        s.setDashboards(message.peers.dashboard);
        const controls = message.snapshot.controls;
        if (controls) s.applySquadControls(controls, 'snapshot');
        s.pushUplink(
          'link',
          `welcome · ${message.peers.dashboard} dashboard${message.peers.dashboard === 1 ? '' : 's'}` +
            (controls ? ` · ${describeControls(controls)}` : ''),
        );
        // Announce what we are actually running even if nothing changed.
        this.sendState();
        break;
      }
      case 'squad:controls':
        s.applySquadControls(message.controls, 'ws');
        s.pushUplink('controls', describeControls(message.controls));
        break;
      case 'physics:set': {
        s.patchPhysics(message.params, 'ws');
        const desc = Object.entries(message.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
        s.pushUplink('physics', `physics:set ${desc}`);
        break;
      }
      case 'server:presence':
        if (message.peers.dashboard !== s.dashboards) {
          s.pushUplink('presence', `${message.peers.dashboard} dashboard${message.peers.dashboard === 1 ? '' : 's'} online`);
        }
        s.setDashboards(message.peers.dashboard);
        break;
      case 'server:error':
        s.pushUplink('error', `${message.code}: ${message.message}`);
        break;
      case 'pong': {
        const sentAt = this.pendingPings.get(message.nonce);
        if (sentAt !== undefined) {
          this.pendingPings.delete(message.nonce);
          s.setRtt(Math.round(performance.now() - sentAt));
        }
        break;
      }
      default:
        // game:* frames are never relayed to games; anything else is not for us.
        break;
    }
  }

  private ping(): void {
    if (performance.now() - this.lastFrameAt > SILENCE_TIMEOUT_MS) {
      gameState().pushUplink('link', 'relay silent — reconnecting');
      this.ws?.close(4000, 'silent');
      return;
    }
    const nonce = ++this.pingNonce;
    this.pendingPings.set(nonce, performance.now());
    if (this.pendingPings.size > 10) {
      const oldest = this.pendingPings.keys().next().value;
      if (oldest !== undefined) this.pendingPings.delete(oldest);
    }
    this.send({ type: 'ping', nonce });
  }

  /**
   * Throttle, not debounce: while a dashboard drags a slider (~30 Hz) a restarting debounce would
   * never fire. At most one game:state per STATE_THROTTLE_MS, always carrying the latest values.
   */
  private scheduleState(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.sendState();
    }, STATE_THROTTLE_MS);
  }

  private sendState(): void {
    const { physics, controls } = gameState();
    this.send({ type: 'game:state', physics, controls });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = backoffDelay(this.attempt++);
    gameState().pushUplink('link', `link down — retry in ${(delay / 1000).toFixed(1)} s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.stateTimer = null;
    this.telemetryTimer = null;
    this.pingTimer = null;
  }
}

let activeLink: SquadLink | null = null;

/** The running link (for the debug handle / diagnostics), or null when networking is off. */
export function getActiveLink(): SquadLink | null {
  return activeLink;
}

/** Mount the relay link for the lifetime of the calling component (StrictMode-safe). */
export function useSquadLink(): void {
  useEffect(() => {
    const s = gameState();
    if (isNetworkDisabled()) {
      s.setServerUrl('', 'none');
      s.setLinkStatus('disabled');
      return;
    }
    const { url, source } = resolveServerUrl();
    s.setServerUrl(url, source);
    const link = new SquadLink(url);
    activeLink = link;
    link.start();
    return () => {
      link.stop();
      if (activeLink === link) activeLink = null;
    };
  }, []);
}
