import { beforeEach, describe, expect, test } from "vitest";
import type { Card } from "../src/types";
import type { OnlineMessage } from "../src/online/protocol";
import type { ProtocolTransport } from "../src/online/oneVOneSession";
import { TwoVTwoOnlineSession, type Online2v2State, type TwoVTwoSessionCallbacks } from "../src/online/twoVTwoSession";

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
  roomCode = "TEAM2";
  callbacks: TransportCallbacks | null = null;
  peer: MockTransport | null = null;
  sent: OnlineMessage[] = [];
  constructor(host: boolean) { this.isHost = host; }
  setProtocolCallbacks(callbacks: TransportCallbacks): void { this.callbacks = callbacks; }
  async createRoom(): Promise<string> { this.isHost = true; return this.roomCode; }
  async joinRoom(code: string): Promise<void> { this.isHost = false; this.roomCode = code; this.peer?.callbacks?.onTransportConnected(); this.callbacks?.onTransportConnected(); }
  sendProtocolMessage(message: OnlineMessage): void { this.sent.push(structuredClone(message)); this.peer?.callbacks?.onMessage(structuredClone(message)); }
  destroy(): void {}
  disconnect(): void { this.callbacks?.onTransportDisconnected(); this.peer?.callbacks?.onTransportDisconnected(); }
  reconnect(): void { this.peer?.callbacks?.onTransportConnected(); this.callbacks?.onTransportConnected(); }
}

const card = (id: string, rank: number): Card => ({ id, rank, suit: "pique" });
function state(): Online2v2State {
  return {
    mode: "online",
    phase: "playing",
    deck: [card("SECRET_DECK_2V2", 1)],
    table: [card("table-3", 3), card("table-4", 4), card("table-2", 2), card("table-5", 5)],
    hands: {
      p1: [card("SECRET_TEAM_A_P1", 1)],
      p2: [card("team-b-7", 7)],
      p3: [card("SECRET_TEAM_A_P3", 2)],
      p4: [card("team-b-p4", 3)],
    },
    seatNames: { p1: "Host", p2: "Guest", p3: "Host", p4: "Guest" },
    currentTurn: "p2",
    lastCaptureTeam: null,
    teamA: { captured: [], chkobas: 0, score: 0, roundPoints: 0 },
    teamB: { captured: [], chkobas: 0, score: 0, roundPoints: 0 },
    targetScore: 11,
    message: "Tour B",
  };
}

function callbacks(overrides: Partial<TwoVTwoSessionCallbacks> = {}): TwoVTwoSessionCallbacks {
  return {
    createHostState: () => state(), onHostState: () => {}, onGuestView: () => {}, onSessionConnected: () => {},
    onReconnecting: () => {}, onDisconnected: () => {}, onError: () => {}, onNextRoundRequested: () => null, onRematchRequested: () => null,
    ...overrides,
  };
}

function pair() {
  const hostTransport = new MockTransport(true); const guestTransport = new MockTransport(false);
  hostTransport.peer = guestTransport; guestTransport.peer = hostTransport;
  return { hostTransport, guestTransport, host: new TwoVTwoOnlineSession(hostTransport), guest: new TwoVTwoOnlineSession(guestTransport) };
}

beforeEach(() => Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true }));

describe("2v2 v2 session", () => {
  test("JOIN, private team view, authoritative capture and REJOIN are end-to-end", async () => {
    const { host, guest, hostTransport, guestTransport } = pair();
    let hostCharges = 0; let guestCharges = 0;
    host.configure(callbacks({ onSessionConnected: (rejoined) => { if (!rejoined) hostCharges += 1; } }));
    guest.configure(callbacks({ onSessionConnected: (rejoined) => { if (!rejoined) guestCharges += 1; } }));
    await host.createRoom(); await guest.joinRoom("TEAM2", "Guest");

    const welcome = hostTransport.sent.find((message) => message.type === "WELCOME");
    expect(welcome?.type).toBe("WELCOME");
    const serialized = JSON.stringify(welcome);
    expect(serialized).not.toContain("SECRET_TEAM_A");
    expect(serialized).not.toContain("SECRET_DECK_2V2");
    expect(serialized).toContain("team-b-7");

    guest.chooseCapture("p2", "team-b-7", ["table-3", "table-4"]);
    expect(host.getHostState()?.teamB.captured.map((item) => item.id)).toEqual(expect.arrayContaining(["team-b-7", "table-3", "table-4"]));
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "STATE_SNAPSHOT", stateVersion: 1 });

    hostTransport.disconnect(); guestTransport.reconnect();
    expect(hostTransport.sent.some((message) => message.type === "REJOIN_ACCEPTED")).toBe(true);
    expect(hostCharges).toBe(1); expect(guestCharges).toBe(1);

    hostTransport.disconnect(); guestTransport.reconnect();
    expect(hostTransport.sent.filter((message) => message.type === "REJOIN_ACCEPTED")).toHaveLength(2);
    expect(hostCharges).toBe(1); expect(guestCharges).toBe(1);
  });

  test("guest cannot play host seats and duplicate actions do not mutate twice", async () => {
    const { host, guest, hostTransport } = pair();
    host.configure(callbacks()); guest.configure(callbacks());
    await host.createRoom(); await guest.joinRoom("TEAM2", "Guest");
    const welcome = hostTransport.sent.find((message) => message.type === "WELCOME");
    if (!welcome || welcome.type !== "WELCOME") throw new Error("WELCOME missing");

    const forbidden = { type: "PLAY_CARD", protocolVersion: 2, matchId: welcome.matchId, playerToken: welcome.playerToken, actionId: "forbidden", seat: "p1", cardId: "SECRET_TEAM_A_P1" } as const;
    hostTransport.callbacks?.onMessage(forbidden);
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "ACTION_REJECTED", reasonCode: "INVALID_MATCH" });

    const valid = { type: "CHOOSE_CAPTURE", protocolVersion: 2, matchId: welcome.matchId, playerToken: welcome.playerToken, actionId: "once", seat: "p2", cardId: "team-b-7", captureIds: ["table-3", "table-4"] } as const;
    hostTransport.callbacks?.onMessage(valid);
    const capturedCount = host.getHostState()?.teamB.captured.length;
    hostTransport.callbacks?.onMessage(valid);
    expect(host.getHostState()?.teamB.captured.length).toBe(capturedCount);
    expect(hostTransport.sent.at(-2)).toMatchObject({ type: "ACTION_REJECTED", reasonCode: "DUPLICATE_ACTION" });
  });

  test("host timeout resolves the current seat with one authoritative snapshot", async () => {
    const { host, guest, hostTransport } = pair();
    host.configure(callbacks());
    guest.configure(callbacks());
    await host.createRoom();
    await guest.joinRoom("TEAM2", "Guest");

    host.forceTimedTurn();

    const next = host.getHostState();
    expect(next?.currentTurn).toBe("p3");
    expect(next?.hands.p2).toHaveLength(0);
    expect(next?.teamB.captured.length).toBeGreaterThan(0);
    expect(next?.message).toContain("Temps écoulé");
    expect(hostTransport.sent.at(-1)).toMatchObject({ type: "STATE_SNAPSHOT", stateVersion: 1 });
  });
});
