// Minimal protocol client shared by the CLI tools (the real apps have their own).
import { WebSocket } from 'ws';
import {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  encodeMessage,
  normalizeServerUrl,
  parseMessage,
  withRole,
  type ClientMessage,
  type ClientRole,
  type OutgoingMessage,
  type ProtocolMessage,
} from '../../../shared/protocol';

export const DEFAULT_TOOL_URL = 'ws://localhost:8787';

export interface ToolClientOptions {
  url: string;
  role: ClientRole;
  name: string;
  /** Reconnect with exponential backoff after the socket drops. */
  reconnect: boolean;
  onMessage(message: ProtocolMessage): void;
  onOpen?(): void;
  onClose?(code: number, reason: string, retryInMs: number | null): void;
  onError?(error: Error): void;
}

export interface ToolClient {
  readonly url: string;
  readonly connected: boolean;
  /** Stamps `v`, `seq` and `sentAt`. Returns false when not connected (the frame is dropped). */
  send(message: OutgoingMessage<ClientMessage>): boolean;
  /** Resolves once everything queued has been handed to the OS. */
  flush(): Promise<void>;
  close(): void;
}

export function connectToolClient(options: ToolClientOptions): ToolClient {
  const url = withRole(normalizeServerUrl(options.url), options.role);
  let ws: WebSocket | undefined;
  let seq = 0;
  let attempt = 0;
  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;

  const open = (): void => {
    const socket = new WebSocket(url);
    ws = socket;
    socket.on('open', () => {
      attempt = 0;
      socket.send(encodeMessage({ type: 'hello', role: options.role, name: options.name, seq: ++seq, sentAt: Date.now() }));
      options.onOpen?.();
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = parseMessage(data.toString());
      if (message) options.onMessage(message);
    });
    socket.on('error', (err) => options.onError?.(err));
    socket.on('close', (code, reason) => {
      if (ws === socket) ws = undefined;
      let retryInMs: number | null = null;
      if (!stopped && options.reconnect) {
        const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
        retryInMs = Math.round(base * (0.75 + Math.random() * 0.5));
        attempt += 1;
        retryTimer = setTimeout(open, retryInMs);
      }
      options.onClose?.(code, reason.toString(), retryInMs);
    });
  };

  open();

  return {
    url,
    get connected() {
      return ws?.readyState === WebSocket.OPEN;
    },
    send(message) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(encodeMessage({ ...message, seq: ++seq, sentAt: Date.now() }));
      return true;
    },
    async flush() {
      while (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      ws?.close(1000, 'bye');
    },
  };
}
