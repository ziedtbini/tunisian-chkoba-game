import { beforeEach, describe, expect, test } from "vitest";
import type { GameState } from "../src/types";
import { initializeRound } from "../src/gameLogic";
import { OneVOneOnlineSession, type OneVOneSessionCallbacks, type ProtocolTransport } from "../src/online/oneVOneSession";
import { ONLINE_PROTOCOL_VERSION, type Online1v1View, type OnlineMessage } from "../src/online/protocol";
import { parseOnlineMessage } from "../src/online/validation";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type TransportCallbacks = Parameters<ProtocolTransport["setProtocolCallbacks"]>[0];

class MockTransport implements ProtocolTransport {
  isHost: boolean;
  roomCode = "ABCDE";
  callbacks: TransportCallbacks | null = null;
  peer: MockTransport | null = null;
  sent: OnlineMessage[] = [];

  constructor(isHost: boolean) { this.isHost = isHost; }
  setProtocolCallbacks(callbacks: TransportCallbacks): void { this.callbacks = callbacks; }
  async createRoom(): Promise<string> { this.isHost = true; return this.roomCode; }
  async joinRoom(code: string): Promise<void> {
    this.isHost = false;
    this.roomCode = code;
    this.peer?.callbacks?.onTransportConnected();
    this.callbacks?.onTransportConnected();
  }
  sendProtocolMessage(message: OnlineMessage): void {
    this.sent.push(structuredClone(message));
    this.peer?.callbacks?.onMessage(structuredClone(message));
  }
  destroy(): void {}
  disconnect(): void {
    this.callbacks?.onTransportDisconnected();
    this.peer?.callbacks?.onTransportDisconnected();
  }
  reconnect(): void {
    this.peer?.callbacks?.onTransportConnected();
    this.callbacks?.onTransportConnected();
  }
}

function authoritativeState(): GameState {
  const initial = initializeRound(0, 0, 11, "online");
  const make = (id: string, rank: number): GameState["deck"][number] => ({ id, rank, suit: "pique" });
  return {
    ...initial,
    currentTurn: "player2",
    deck: [make("SECRET_DECK_1", 1), make("SECRET_DECK_2", 2)],
    table: [make("table-3", 3), make("table-4", 4), make("table-2", 2), make("table-5", 5)],
    player1: { ...initial.player1, name: "Host", hand: [make("SECRET_HOST_1", 1), make("SECRET_HOST_2", 2)] },
    player2: { ...initial.player2, name: "Guest", hand: [make("guest-7", 7), make("guest-6", 6)] },
  };
}

function callbacks(overrides: Partial<OneVOneSessionCallbacks> = {}): OneVOneSessionCallbacks {
  return {
    createHostState: () => authoritativeState(),
    onHostState: () => {},
    onGuestView: () => {},
    onSessionConnected: () => {},
    onReconnecting: () => {},
    onDisconnected: () => {},
    onError: () => {},
    onNextRoundRequested: () => null,
    onRematchRequested: () => null,
    ...overrides,
  };
}

function pair(): { host: OneVOneOnlineSession; guest: OneVOneOnlineSession; hostTransport: MockTransport; guestTransport: MockTransport } {
  const hostTransport = new MockTransport(true);
  const guestTransport = new MockTransport(false);
  hostTransport.peer = guestTransport;
  guestTransport.peer = hostTransport;
  return {
    host: new OneVOneOnlineSession(hostTransport),
    guest: new OneVOneOnlineSession(guestTransport),
    hostTransport,
    guestTransport,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

describe("1v1 v2 session over a simulated transport", () => {
  test("JOIN, authoritative actions, snapshots and REJOIN work without leaking hidden cards", async () => {
    const { host, guest, hostTransport, guestTransport } = pair();
    const guestViews: Online1v1View[] = [];
    let hostCharges = 0;
    let guestCharges = 0;

    host.configure(callbacks({ onSessionConnected: (reconnected) => { if (!reconnected) hostCharges += 1; } }));
    guest.configure(callbacks({
      onGuestView: (view) => guestViews.push(view),
      onSessionConnected: (reconnected) => { if (!reconnected) guestCharges += 1; },
    }));

    await host.createRoom();
    await guest.joinRoom("ABCDE", "Guest");

    const welcome = hostTransport.sent.find((message) => message.type === "WELCOME");
    expect(welcome?.type).toBe("WELCOME");
    expect(host.getStatus()).toBe("connected");
    expect(guest.getStatus()).toBe("connected");
    expect(hostCharges).toBe(1);
    expect(guestCharges).toBe(1);

    const serializedWelcome = JSON.stringify(welcome);
    expect(serializedWelcome).not.toContain("SECRET_HOST");
    expect(serializedWelcome).not.toContain("SECRET_DECK");

    guest.playCard("guest-7");
    expect(host.getHostState()?.selectedCard?.id).toBe("guest-7");
    const versionAfterPlay = guestViews.at(-1)?.possibleCaptures ? 1 : -1;
    expect(versionAfterPlay).toBe(1);

    guest.chooseCapture("guest-7", ["table-3", "table-4"]);
    expect(host.getHostState()?.player2.captured.map((card) => card.id)).toEqual(expect.arrayContaining(["guest-7", "table-3", "table-4"]));
    const snapshots = hostTransport.sent.filter((message) => message.type === "STATE_SNAPSHOT");
    expect(snapshots.map((message) => message.type === "STATE_SNAPSHOT" ? message.stateVersion : -1)).toEqual([1, 2]);
    expect(JSON.stringify(snapshots)).not.toContain("SECRET_HOST");
    expect(JSON.stringify(snapshots)).not.toContain("SECRET_DECK");

    hostTransport.disconnect();
    expect(host.getStatus()).toBe("reconnecting");
    expect(guest.getStatus()).toBe("reconnecting");
    guestTransport.reconnect();

    expect(hostTransport.sent.some((message) => message.type === "REJOIN_ACCEPTED")).toBe(true);
    expect(host.getStatus()).toBe("connected");
    expect(guest.getStatus()).toBe("connected");
    expect(hostCharges).toBe(1);
    expect(guestCharges).toBe(1);

    hostTransport.disconnect();
    guestTransport.reconnect();

    expect(hostTransport.sent.filter((message) => message.type === "REJOIN_ACCEPTED")).toHaveLength(2);
    expect(host.getStatus()).toBe("connected");
    expect(guest.getStatus()).toBe("connected");
    expect(hostCharges).toBe(1);
    expect(guestCharges).toBe(1);
  });

  test("rejects wrong versions, a second guest, invalid match ids, duplicate actions and invalid captures", async () => {
    const { host, guest, hostTransport, guestTransport } = pair();
    host.configure(callbacks());
    guest.configure(callbacks());
    await host.createRoom();

    hostTransport.callbacks?.onMessage({ type: "JOIN", protocolVersion: 1, mode: "1v1", playerName: "Old" } as OnlineMessage);
    expect(hostTransport.sent.at(-1)?.type).toBe("VERSION_MISMATCH");

    await guest.joinRoom("ABCDE", "Guest");
    const welcome = hostTransport.sent.find((message) => message.type === "WELCOME");
    if (!welcome || welcome.type !== "WELCOME") throw new Error("WELCOME missing");

    hostTransport.callbacks?.onMessage({ type: "JOIN", protocolVersion: ONLINE_PROTOCOL_VERSION, mode: "1v1", playerName: "Intruder" });
    expect(hostTransport.sent.at(-1)?.type).toBe("ROOM_FULL");

    const action = { type: "PLAY_CARD", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: welcome.matchId, playerToken: welcome.playerToken, actionId: "same-action", cardId: "guest-7" } as const;
    hostTransport.callbacks?.onMessage({ ...action, matchId: "wrong-match" });
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "ACTION_REJECTED", reasonCode: "INVALID_MATCH" });

    hostTransport.callbacks?.onMessage(action);
    const version = hostTransport.sent.filter((message) => message.type === "STATE_SNAPSHOT").at(-1);
    hostTransport.callbacks?.onMessage(action);
    expect(hostTransport.sent.at(-2)).toMatchObject({ type: "ACTION_REJECTED", reasonCode: "DUPLICATE_ACTION" });
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "STATE_SNAPSHOT", stateVersion: version?.type === "STATE_SNAPSHOT" ? version.stateVersion : -1 });

    hostTransport.callbacks?.onMessage({ type: "CHOOSE_CAPTURE", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: welcome.matchId, playerToken: welcome.playerToken, actionId: "bad-capture", cardId: "guest-7", captureIds: ["table-3"] });
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "ACTION_REJECTED", reasonCode: "INVALID_CAPTURE" });
    expect(guestTransport.sent.some((message) => message.type === "JOIN")).toBe(true);
  });

  test("rejects old legacy messages at the network parser boundary", () => {
    expect(parseOnlineMessage({ type: "game-state", payload: {} })).toBeNull();
    expect(parseOnlineMessage({ type: "play-card", payload: { cardId: "x" } })).toBeNull();
    expect(parseOnlineMessage({ type: "capture-choice", payload: { captureIds: [] } })).toBeNull();
  });

  test("host timeout plays one legal move and synchronizes it", async () => {
    const { host, guest, hostTransport } = pair();
    host.configure(callbacks());
    guest.configure(callbacks());
    await host.createRoom();
    await guest.joinRoom("ABCDE", "Guest");

    host.forceTimedTurn();

    const next = host.getHostState();
    expect(next?.currentTurn).toBe("player1");
    expect(next?.player2.hand).toHaveLength(1);
    expect(next?.player2.captured.length).toBeGreaterThan(0);
    expect(next?.message).toContain("Temps écoulé");
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "STATE_SNAPSHOT", stateVersion: 1 });
  });
});
