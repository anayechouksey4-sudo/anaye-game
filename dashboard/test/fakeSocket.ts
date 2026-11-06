import type { SocketLike } from '../src/net/squadLink';

/** In-memory WebSocket: the test plays the relay with accept() / deliver() / drop(). */
export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // server side
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(message: object) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}
