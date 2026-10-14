import type { ClientMessage, ServerMessage } from '@wst/engine';

export interface ConnectionHandlers {
  open(): void;
  /** `retrying`: the connection will be re-established automatically. */
  close(retrying: boolean): void;
  json(msg: ServerMessage): void;
  binary(data: ArrayBuffer): void;
}

/** Server close code for "match full" / "no such room": retrying won't help. */
const REFUSED = 1013;
const MAX_RETRY_MS = 10_000;

/**
 * Text frames carry JSON control messages; binary frames carry tick deltas.
 * A dropped connection is retried with backoff; the server recognises the
 * player by token and resends everything (welcome, snapshot, programs, tasks).
 */
export class Connection {
  private ws!: WebSocket;
  private attempts = 0;

  constructor(
    private readonly url: string,
    private readonly h: ConnectionHandlers,
  ) {
    this.connect();
  }

  private connect(): void {
    const ws = (this.ws = new WebSocket(this.url));
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.attempts = 0;
      this.h.open();
    };
    ws.onclose = (ev) => {
      const retrying = ev.code !== REFUSED;
      this.h.close(retrying);
      if (retrying) setTimeout(() => this.connect(), Math.min(MAX_RETRY_MS, 1000 * 2 ** this.attempts++));
    };
    ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      if (typeof ev.data === 'string') this.h.json(JSON.parse(ev.data) as ServerMessage);
      else this.h.binary(ev.data);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
