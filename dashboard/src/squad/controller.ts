import {
  CONTROLS_SEND_INTERVAL_MS,
  DEFAULT_SQUAD_CONTROLS,
  SQUAD_CONTROL_SPECS,
  CAR_PHYSICS_KEYS,
  clampSquadControls,
  snapToSpec,
  squadControlsEqual,
  type CarPhysicsParams,
  type GameSessionInfo,
  type GameTelemetry,
  type PeerCounts,
  type ProtocolMessage,
  type SquadControlKey,
  type SquadControls,
} from '../../../shared/protocol';
import { ControlsThrottle } from '../net/controlsThrottle';
import { SquadLink, type LinkState, type SocketLike } from '../net/squadLink';
import { createStore, type Store } from '../state/store';
import { NO_SPEED_TRAP_WATCH, watchSpeedTrap, type JumpAttempt, type SpeedTrapWatch } from './bigJump';
import { DEFAULT_SESSION, mergeSession, sessionEqual, sessionInfoOf, type PlaySession } from './session';
import { NOT_DRAGGING, mergeRemoteControls, resolveWelcomeSync, type DragState } from './sync';

export type ControlsSource = 'default' | 'local' | 'squad' | 'snapshot';

export interface ControlsState {
  /** Live values: what the readouts show and what gets broadcast. */
  values: SquadControls;
  /**
   * What each Slider's `value` prop is set to. Only changes on external writes (preset, reset, another
   * dashboard, adopted snapshot) and at the end of a gesture, so a native slider is never fed its own
   * in-flight value back mid-drag (that feedback loop makes thumbs jitter).
   */
  positions: SquadControls;
  dragging: DragState;
  /** Any slider, preset or reset used since launch. Drives the reconnect sync rule. */
  touched: boolean;
  source: ControlsSource;
}

export interface ConnectionState extends LinkState {
  latencyMs: number | null;
  clientId: string | null;
  /** Latest `server:error` from the relay, e.g. "rate_limited: …". */
  serverError: string | null;
}

export interface GameLinkState {
  peers: PeerCounts | null;
  /** Physics the game reports it is running (game:state), or the relay's last-known copy from the welcome. */
  appliedPhysics: CarPhysicsParams | null;
  /** Controls the game last applied; null when unknown (snapshot only has physics) or never applied. */
  appliedControls: SquadControls | null;
  appliedFromSnapshot: boolean;
  /**
   * The car and map the game is playing (game:state carId / trackId / bigJumpKmh, or the relay's
   * snapshot.session). Every preview and verdict uses it. It is kept when the game drops off the relay
   * (a backgrounded browser tab often does), so the previews don't jump back to the hypercar.
   */
  session: PlaySession;
}

export interface TelemetryState {
  telemetry: GameTelemetry | null;
  receivedAt: number | null;
  /** True when the value came from the welcome snapshot (may be from a game that already left). */
  fromSnapshot: boolean;
  /**
   * The latest big-jump lip crossing and its outcome (CLEARED after a finish, SHORT after a fall),
   * folded from every telemetry frame by watchSpeedTrap. Same object until it changes.
   */
  jump: JumpAttempt | null;
}

/** onValueChange phases coming from a slider card. */
export type SliderPhase =
  /** finger down */
  | 'start'
  /** dragging: throttled broadcast */
  | 'move'
  /** finger up / key up: immediate broadcast of the final value */
  | 'commit'
  /** discrete step outside a drag (keyboard arrow, accessibility increment): throttled, thumb follows */
  | 'step';

export interface SquadControllerOptions {
  clientName: string;
  now?: () => number;
  /** Socket factory for tests (default: the global WebSocket). */
  createSocket?: (url: string) => SocketLike;
}

/**
 * Owns the link, the throttle and the four stores the UI subscribes to. All protocol decisions live
 * here; components only render slices and call these methods.
 */
export class SquadController {
  readonly controls: Store<ControlsState>;
  readonly connection: Store<ConnectionState>;
  readonly game: Store<GameLinkState>;
  readonly telemetry: Store<TelemetryState>;

  private readonly link: SquadLink;
  private readonly throttle: ControlsThrottle;
  private readonly now: () => number;
  /** The relay welcomes on connect and again after our hello; run the sync rule once per connection. */
  private syncedThisConnection = false;
  private trapWatch: SpeedTrapWatch = NO_SPEED_TRAP_WATCH;

  constructor(options: SquadControllerOptions) {
    this.now = options.now ?? Date.now;
    this.controls = createStore<ControlsState>({
      values: { ...DEFAULT_SQUAD_CONTROLS },
      positions: { ...DEFAULT_SQUAD_CONTROLS },
      dragging: NOT_DRAGGING,
      touched: false,
      source: 'default',
    });
    this.connection = createStore<ConnectionState>({
      status: 'offline',
      url: null,
      retryAt: null,
      attempt: 0,
      error: null,
      latencyMs: null,
      clientId: null,
      serverError: null,
    });
    this.game = createStore<GameLinkState>({
      peers: null,
      appliedPhysics: null,
      appliedControls: null,
      appliedFromSnapshot: false,
      session: DEFAULT_SESSION,
    });
    this.telemetry = createStore<TelemetryState>({ telemetry: null, receivedAt: null, fromSnapshot: false, jump: null });

    this.link = new SquadLink(
      {
        onState: (state) => this.onLinkState(state),
        onOpen: () => this.onLinkOpen(),
        onMessage: (message) => this.onMessage(message),
        onLatency: (ms) => this.connection.setState({ latencyMs: Math.round(ms) }),
      },
      { name: options.clientName, ...(options.createSocket ? { createSocket: options.createSocket } : null) },
    );
    this.throttle = new ControlsThrottle(
      (controls) => this.link.send({ type: 'squad:controls', controls }),
      CONTROLS_SEND_INTERVAL_MS,
    );
  }

  // ── commands from the UI ───────────────────────────────────────────────────

  connect(url: string): void {
    this.link.connect(url);
  }

  disconnect(): void {
    this.throttle.cancel();
    this.link.disconnect();
  }

  /** AppState → 'active'. */
  wake(): void {
    this.link.wake();
  }

  setControl(key: SquadControlKey, raw: number, phase: SliderPhase): void {
    const value = snapToSpec(raw, SQUAD_CONTROL_SPECS[key]);
    const prev = this.controls.getState();

    if (phase === 'start') {
      this.controls.setState({ dragging: { ...prev.dragging, [key]: true } });
      return;
    }

    const values = prev.values[key] === value ? prev.values : { ...prev.values, [key]: value };
    const settle = phase !== 'move';
    const positions = settle && prev.positions[key] !== value ? { ...prev.positions, [key]: value } : prev.positions;
    const dragging = phase === 'commit' && prev.dragging[key] ? { ...prev.dragging, [key]: false } : prev.dragging;
    const changed = values !== prev.values;
    this.controls.setState({
      values,
      positions,
      dragging,
      touched: prev.touched || changed,
      source: changed ? 'local' : prev.source,
    });

    if (phase === 'commit') this.throttle.flush(values);
    else if (changed) this.throttle.push(values);
  }

  applyPreset(controls: SquadControls): void {
    const values = clampSquadControls(controls);
    this.controls.setState({ values, positions: values, dragging: NOT_DRAGGING, touched: true, source: 'local' });
    this.throttle.force(values);
  }

  reset(): void {
    this.applyPreset(DEFAULT_SQUAD_CONTROLS);
  }

  dispose(): void {
    this.throttle.cancel();
    this.link.dispose();
  }

  // ── link events ────────────────────────────────────────────────────────────

  private onLinkState(state: LinkState): void {
    const online = state.status === 'online';
    this.connection.setState({
      ...state,
      ...(online ? null : { latencyMs: null, clientId: null }),
    });
    if (!online) {
      this.throttle.cancel();
      // Peer counts are only meaningful while we can hear presence updates.
      this.game.setState({ peers: null });
    }
  }

  private onLinkOpen(): void {
    this.syncedThisConnection = false;
    this.throttle.reset();
    this.connection.setState({ serverError: null });
  }

  private onMessage(message: ProtocolMessage): void {
    switch (message.type) {
      case 'server:welcome': {
        this.connection.setState({ clientId: message.clientId });
        this.game.setState({ peers: message.peers });
        if (this.syncedThisConnection) return;
        this.syncedThisConnection = true;
        const { snapshot } = message;
        // We were offline, so the relay's copy is at least as new as ours.
        if (snapshot.physics) {
          const game = this.game.getState();
          const unchanged = game.appliedPhysics !== null && physicsEqual(game.appliedPhysics, snapshot.physics);
          this.game.setState({
            appliedPhysics: snapshot.physics,
            appliedControls: unchanged ? game.appliedControls : null,
            appliedFromSnapshot: !unchanged || game.appliedFromSnapshot,
          });
        }
        // The relay keeps the session from the last game:state that carried one. Physics without a
        // session means a game (or relay) from before the garage: mergeSession treats that as the hypercar.
        if (snapshot.session || snapshot.physics) {
          this.game.setState({ session: this.nextSession(snapshot.session ?? {}, 'snapshot') });
        }
        if (snapshot.telemetry) this.onTelemetry(snapshot.telemetry, true);
        const state = this.controls.getState();
        if (resolveWelcomeSync(snapshot.controls, state.touched) === 'adopt' && snapshot.controls) {
          this.controls.setState({
            values: keepIfEqual(state.values, mergeRemoteControls(state.values, snapshot.controls, state.dragging)),
            positions: keepIfEqual(state.positions, mergeRemoteControls(state.positions, snapshot.controls, state.dragging)),
            source: 'snapshot',
          });
        } else {
          this.throttle.force(state.values);
        }
        return;
      }
      case 'server:presence':
        this.game.setState({ peers: message.peers });
        return;
      case 'squad:controls': {
        const state = this.controls.getState();
        this.controls.setState({
          values: keepIfEqual(state.values, mergeRemoteControls(state.values, message.controls, state.dragging)),
          positions: keepIfEqual(state.positions, mergeRemoteControls(state.positions, message.controls, state.dragging)),
          source: 'squad',
        });
        return;
      }
      case 'game:state':
        // One update, so no card ever renders the new physics against the previous car.
        this.game.setState({
          appliedPhysics: message.physics,
          appliedControls: message.controls,
          appliedFromSnapshot: false,
          session: this.nextSession(sessionInfoOf(message), 'game'),
        });
        return;
      case 'game:telemetry':
        this.onTelemetry(message.telemetry, false);
        return;
      case 'server:error':
        this.connection.setState({ serverError: `${message.code}: ${message.message}` });
        return;
      default:
        // hello / ping / physics:set from other clients need no dashboard reaction.
        return;
    }
  }

  /** Every telemetry frame, live or from the welcome snapshot, also goes through the speed-trap watch. */
  private onTelemetry(telemetry: GameTelemetry, fromSnapshot: boolean): void {
    this.trapWatch = watchSpeedTrap(this.trapWatch, telemetry);
    this.telemetry.setState({ telemetry, receivedAt: this.now(), fromSnapshot, jump: this.trapWatch.attempt });
  }

  /** The session after `info`; the current object when nothing changed, so subscribers don't re-render. */
  private nextSession(info: GameSessionInfo, source: 'snapshot' | 'game'): PlaySession {
    const prev = this.game.getState().session;
    const next = mergeSession(prev, info, source);
    return sessionEqual(prev, next) ? prev : next;
  }
}

/** Keep the old reference when nothing changed, so slice subscribers do not re-render. */
function keepIfEqual(prev: SquadControls, next: SquadControls): SquadControls {
  return squadControlsEqual(prev, next) ? prev : next;
}

export function physicsEqual(a: CarPhysicsParams, b: CarPhysicsParams): boolean {
  return CAR_PHYSICS_KEYS.every((k) => a[k] === b[k]);
}
