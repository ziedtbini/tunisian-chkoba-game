import { afterEach, describe, expect, test, vi } from "vitest";
import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { OnlineManager } from "../src/onlineManager";
import type { OnlineMessage } from "../src/online/protocol";

type Handler = (...args: any[]) => void;

class FakeConnection {
  open = false;
  private closed = false;
  private handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  connect(): void {
    this.open = true;
    this.emit("open");
  }

  send(message: OnlineMessage): void {
    if (message.type === "PING") {
      this.emit("data", { type: "PONG", protocolVersion: 2, timestamp: message.timestamp });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit("close");
  }
}

class FakePeer {
  open = true;
  disconnected = false;
  destroyed = false;
  readonly connections: FakeConnection[] = [];
  private handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  connect(): DataConnection {
    const connection = new FakeConnection();
    this.connections.push(connection);
    return connection as unknown as DataConnection;
  }

  reconnect(): void {
    this.disconnected = false;
    this.open = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.open = false;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("OnlineManager reconnect lifecycle", () => {
  test("gives every disconnect a fresh reconnect window and cancels stale retry timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

    const peer = new FakePeer();
    const manager = new OnlineManager(() => peer as unknown as Peer);
    let connected = 0;
    let reconnecting = 0;
    const errors: string[] = [];
    manager.setProtocolCallbacks({
      onMessage: () => {},
      onTransportConnected: () => {
        connected += 1;
        manager.markSessionConnected();
      },
      onTransportDisconnected: () => {},
      onReconnecting: () => { reconnecting += 1; },
      onError: (message) => errors.push(message),
    });

    const joining = manager.joinRoom("ABCDE", "v2");
    peer.emit("open");
    peer.connections[0].connect();
    await joining;
    expect(connected).toBe(1);

    peer.connections[0].close();
    vi.advanceTimersByTime(0);
    peer.connections[1].connect();
    expect(connected).toBe(2);

    // A later outage must not inherit the first outage's 60-second deadline.
    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    peer.connections[1].close();
    vi.advanceTimersByTime(0);
    peer.connections[2].connect();
    expect(connected).toBe(3);

    vi.advanceTimersByTime(20_000);
    expect(reconnecting).toBe(2);
    expect(errors).toEqual([]);
    expect(peer.connections).toHaveLength(3);

    manager.destroy();
  });
});
