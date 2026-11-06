/**
 * WebSocket client (role "game") for the SquadHQ relay.
 *
 *   in   server:welcome  → apply snapshot.controls, dashboards count, announce our state
 *        squad:controls  → applySquadControls (mapSquadControlsToPhysics) — used on the next physics step
 *        physics:set     → patchPhysics
 *        server:presence → dashboards count
 *   out  hello on open; game:state (physics, controls, carId, trackId, bigJumpKmh) ~100 ms after any
 *        physics/controls/car/map change and when another dashboard comes online;
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
  sanitizeDisplayText,
  sanitizeId,
  withRole,
  type GameSessionInfo,
  type OutgoingMessage,
  type ProtocolMessage,
  type SquadControls,
} from '@shared/protocol';
import { isNetworkDisabled, resolveServerUrl } from '../config';
import { activeDriver, useProfile } from '../state/profile';
import { gameState, useGameStore } from '../state/store';
import { bigJumpKmhOf } from '../track/catalog';
import { buildTelemetry } from './telemetry';

/** game:state goes out at most this often (and this long after the first change of a burst). */
const STATE_THROTTLE_MS = 100;
const PING_INTERVAL_MS = 3000;
/** No frame at all for this long (despite our pings) ⇒ treat the socket as dead. */
const SILENCE_TIMEOUT_MS = 10_000;
/** Give up on a socket stuck in CONNECTING (an attempt started mid-outage can hang for minutes). */
const CONNECT_TIMEOUT_MS = 8_000;
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
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeProfile: (() => void) | null = null;
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
      if (
        state.physics !== prev.physics ||
        state.controls !== prev.controls ||
        state.carId !== prev.carId ||
        state.trackLayout !== prev.trackLayout
      ) {
        this.scheduleState();
      }
    });
    // A rename, a driver swap or MY RIDE (un)mounting changes the names game:state carries.
    this.unsubscribeProfile = useProfile.subscribe((state, prev) => {
      if (state.drivers !== prev.drivers || state.activeDriverId !== prev.activeDriverId || state.ride !== prev.ride || state.rideActive !== prev.rideActive) {
        this.scheduleState();
      }
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
    this.unsubscribeProfile?.();
    this.unsubscribeProfile = null;
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.dropSocket(1000, 'client stopped');
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
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) this.handleDead('relay unreachable — connect timed out');
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
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
      if (this.ws !== ws) return;
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
        // A dashboard that just joined learns physics from the relay snapshot, but an older relay
        // keeps no car/map: tell it directly.
        if (message.peers.dashboard > s.dashboards) this.scheduleState();
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
      this.handleDead('relay silent — reconnecting');
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
    this.send({ type: 'game:state', physics, controls, ...gameSessionInfo() });
  }

  /**
   * The socket is unusable (silent / stuck connecting): abandon it now instead of waiting for a close
   * event that can take a minute on a dead path, and retry on a fresh socket.
   */
  private handleDead(reason: string): void {
    this.dropSocket(4000, 'silent');
    this.clearTimers();
    const s = gameState();
    s.setLinkStatus('disconnected');
    s.setRtt(null);
    s.pushUplink('link', reason);
    this.scheduleReconnect();
  }

  /** Detach and close the current socket so none of its late events reach us. */
  private dropSocket(code: number, reason: string): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close(code, reason);
    } catch {
      // Already closing.
    }
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
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.stateTimer = null;
    this.telemetryTimer = null;
    this.pingTimer = null;
  }
}

/**
 * What we are playing, for game:state: the car class, the map, and the lip speed of the map's big
 * jump (null when the map has none), plus who is driving (DRIVERS) and the name of MY RIDE while it
 * is mounted on that class (the wire rule is sanitizeDisplayText; an empty name is left out). Before
 * a track has registered, only the car and the names are known.
 */
export function gameSessionInfo(): GameSessionInfo {
  const { carId, trackLayout } = gameState();
  const info: GameSessionInfo = { carId };
  const profile = useProfile.getState();
  const driverName = sanitizeDisplayText(activeDriver(profile).name);
  if (driverName) info.driverName = driverName;
  if (profile.rideActive && profile.ride.base === carId) {
    const rideName = sanitizeDisplayText(profile.ride.name);
    if (rideName) info.rideName = rideName;
  }
  if (!trackLayout) return info;
  info.bigJumpKmh = bigJumpKmhOf(trackLayout);
  // The relay rejects a whole game:state with a malformed id, so an odd track id is left out instead.
  const trackId = sanitizeId(trackLayout.id);
  if (trackId) info.trackId = trackId;
  return info;
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
