import { once } from 'node:events';
import { WebSocket, type ClientOptions } from 'ws';
import {
  encodeMessage,
  parseMessage,
  type ClientRole,
  type OutgoingMessage,
  type PresenceMessage,
  type ProtocolMessage,
  type WelcomeMessage,
} from '../../shared/protocol';
import { createRelayServer, type RelayServer, type RelayServerOptions } from '../src/relay';

export const WAIT_MS = 2000;

type MessageOf<T extends ProtocolMessage['type']> = Extract<ProtocolMessage, { type: T }>;

export async function startRelay(options: RelayServerOptions = {}): Promise<RelayServer> {
  return createRelayServer({ port: 0, host: '127.0.0.1', ...options });
}

/**
 * Test client that buffers every parsed frame. `take` consumes the first matching frame
 * (waiting for it if needed); `sync` is a ping/pong barrier: once it resolves, every frame
 * the relay routed to this client before processing our ping has been received, which is
 * what makes "did NOT receive" assertions deterministic.
 */
export class TestClient {
  readonly ws: WebSocket;
  readonly received: ProtocolMessage[] = [];
  readonly raw: string[] = [];
  private waiters: Array<() => void> = [];
  private nonce = 0;
  private initialWelcome: WelcomeMessage | null = null;
  /** The presence broadcast triggered by this client's own join (consumed by `connect`). */
  joinPresence: PresenceMessage | null = null;

  constructor(url: string, options?: ClientOptions) {
    this.ws = new WebSocket(url, options);
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      this.raw.push(text);
      const message = parseMessage(text);
      if (message) this.received.push(message);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  /** The welcome received on connect (consumed from `received` by `connect`). */
  get welcome(): WelcomeMessage {
    if (!this.initialWelcome) throw new Error('no welcome received yet');
    return this.initialWelcome;
  }

  async waitForWelcome(): Promise<WelcomeMessage> {
    this.initialWelcome = await this.take('server:welcome');
    return this.initialWelcome;
  }

  async take<T extends ProtocolMessage['type']>(
    type: T,
    predicate: (m: MessageOf<T>) => boolean = () => true,
    timeoutMs = WAIT_MS,
  ): Promise<MessageOf<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.received.findIndex((m) => m.type === type && predicate(m as MessageOf<T>));
      if (index >= 0) return this.received.splice(index, 1)[0] as MessageOf<T>;
      const left = deadline - Date.now();
      if (left <= 0) {
        const seen = this.received.map((m) => m.type).join(', ') || 'nothing';
        throw new Error(`timed out waiting for ${type}; buffered: ${seen}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  count(type: ProtocolMessage['type']): number {
    return this.received.filter((m) => m.type === type).length;
  }

  send(message: OutgoingMessage): void {
    this.ws.send(encodeMessage(message));
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.ws.send(data, { binary });
  }

  async sync(): Promise<void> {
    const nonce = ++this.nonce;
    this.send({ type: 'ping', nonce });
    await this.take('pong', (m) => m.nonce === nonce);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = once(this.ws, 'close');
    this.ws.close();
    await closed;
  }

  async closed(timeoutMs = WAIT_MS): Promise<{ code: number; reason: string }> {
    if (this.ws.readyState === WebSocket.CLOSED) throw new Error('already closed before closed() was awaited');
    const result = await Promise.race([
      once(this.ws, 'close') as Promise<[number, Buffer]>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('socket did not close')), timeoutMs)),
    ]);
    return { code: result[0], reason: result[1].toString() };
  }
}

/**
 * Connects and resolves once the welcome and the presence broadcast for this join have
 * arrived (the relay sends them back to back), consuming both from `received`.
 */
export async function connect(relay: RelayServer, role?: ClientRole | string, path = '/'): Promise<TestClient> {
  const query = role === undefined ? '' : `?role=${encodeURIComponent(role)}`;
  const client = new TestClient(`ws://127.0.0.1:${relay.port}${path}${query}`);
  await client.waitForWelcome();
  client.joinPresence = await client.take('server:presence');
  return client;
}

export const sampleTelemetry = {
  speedKmh: 123.4,
  wheelsGrounded: 4,
  checkpoint: 1,
  totalCheckpoints: 4,
  elapsedMs: 4567,
  falls: 0,
  finished: false,
  bestMs: null,
};
