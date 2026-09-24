import { describe, expect, test } from "vitest";
import { initializeRound } from "../src/gameLogic";
import { ActionDeduplicator, apply1v1Capture, apply1v1Play } from "../src/online/authority";
import { ONLINE_PROTOCOL_VERSION } from "../src/online/protocol";
import { HostSessionGuard, SingleChargeGuard } from "../src/online/session";
import { create1v1View, create2v2View, shouldAcceptSnapshot, type Authoritative2v2State } from "../src/online/stateView";
import { isProtocolCompatible, parseClientMessage, parseOnlineMessage } from "../src/online/validation";
import type { Card, GameState } from "../src/types";

const card = (id: string, rank: number, suit: Card["suit"] = "pique"): Card => ({ id, rank, suit });

function state(): GameState {
  const value = initializeRound(0, 0, 11, "online");
  return {
    ...value,
    deck: [card("SECRET_DECK_1", 2), card("SECRET_DECK_2", 3)],
    table: [card("table-3", 3), card("table-4", 4), card("table-2", 2)],
    player1: { ...value.player1, hand: [card("SECRET_HOST_1", 7), card("SECRET_HOST_2", 5)] },
    player2: { ...value.player2, hand: [card("guest-7", 7), card("guest-5", 5)] },
  };
}

describe("online protocol runtime validation", () => {
  test("accepts a valid message and rejects unknown/malformed payloads", () => {
    expect(parseClientMessage({ type: "JOIN", protocolVersion: 2, mode: "1v1", playerName: "Ami" })?.type).toBe("JOIN");
    expect(parseOnlineMessage({ type: "evil", protocolVersion: 2 })).toBeNull();
    expect(parseClientMessage({ type: "PLAY_CARD", protocolVersion: 2, matchId: "m", actionId: "a" })).toBeNull();
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage([])).toBeNull();
  });

  test("detects incompatible protocol versions", () => {
    expect(isProtocolCompatible({ protocolVersion: ONLINE_PROTOCOL_VERSION })).toBe(true);
    expect(isProtocolCompatible({ protocolVersion: 1 })).toBe(false);
  });

  test("never accepts server state messages as client actions", () => {
    expect(parseClientMessage({ type: "STATE_SNAPSHOT", protocolVersion: 2, matchId: "m", stateVersion: 2, view: {} })).toBeNull();
  });

  test("accepts a valid 2v2 snapshot and rejects legacy 2v2 messages", () => {
    const value: Authoritative2v2State = {
      phase: "playing", table: [], deck: [], hands: { p1: [], p2: [], p3: [], p4: [] },
      seatNames: { p1: "1", p2: "2", p3: "3", p4: "4" }, currentTurn: "p1", lastCaptureTeam: null,
      teamA: { captured: [], chkobas: 0, score: 0, roundPoints: 0 }, teamB: { captured: [], chkobas: 0, score: 0, roundPoints: 0 }, targetScore: 11, message: "tour",
    };
    expect(parseOnlineMessage({ type: "STATE_SNAPSHOT", protocolVersion: 2, matchId: "match", stateVersion: 1, view: create2v2View(value, "B") })?.type).toBe("STATE_SNAPSHOT");
    expect(parseOnlineMessage({ type: "2v2-state", payload: {} })).toBeNull();
    expect(parseOnlineMessage({ type: "2v2-play", payload: {} })).toBeNull();
  });
});

describe("host authoritative actions", () => {
  test("owned card on the correct turn is accepted", () => {
    const current = { ...state(), currentTurn: "player2" as const };
    expect(apply1v1Play(current, "player2", "guest-7").ok).toBe(true);
  });

  test("missing, opposing and out-of-turn cards are rejected", () => {
    const current = { ...state(), currentTurn: "player2" as const };
    expect(apply1v1Play(current, "player2", "missing")).toMatchObject({ ok: false, reason: "CARD_NOT_FOUND" });
    expect(apply1v1Play(current, "player2", "SECRET_HOST_1")).toMatchObject({ ok: false, reason: "CARD_NOT_FOUND" });
    expect(apply1v1Play({ ...current, currentTurn: "player1" }, "player2", "guest-7")).toMatchObject({ ok: false, reason: "NOT_YOUR_TURN" });
  });

  test("capture must exactly match a recomputed legal group", () => {
    const base = { ...state(), currentTurn: "player2" as const, selectedCard: card("guest-7", 7), possibleCaptures: [[card("table-3", 3), card("table-4", 4)]] };
    expect(apply1v1Capture(base, "player2", "guest-7", ["table-3", "table-4"]).ok).toBe(true);
    expect(apply1v1Capture(base, "player2", "guest-7", ["table-3"])).toMatchObject({ ok: false, reason: "INVALID_CAPTURE" });
    expect(apply1v1Capture(base, "player2", "guest-7", ["table-3", "table-4", "table-2"])).toMatchObject({ ok: false, reason: "INVALID_CAPTURE" });
    expect(apply1v1Capture(base, "player2", "guest-7", ["table-3", "table-3"])).toMatchObject({ ok: false, reason: "INVALID_CAPTURE" });
  });

  test("deduplicates action ids", () => {
    const seen = new ActionDeduplicator();
    seen.add("same");
    expect(seen.has("same")).toBe(true);
  });
});

describe("hidden state projections", () => {
  test("1v1 guest view never contains host hand or deck", () => {
    const serialized = JSON.stringify(create1v1View(state(), "player2"));
    expect(serialized).not.toContain("SECRET_HOST_1");
    expect(serialized).not.toContain("SECRET_HOST_2");
    expect(serialized).not.toContain("SECRET_DECK_1");
    expect(serialized).not.toContain("SECRET_DECK_2");
    expect(serialized).toContain("guest-7");
  });

  test("2v2 team views only contain their own hands and no deck", () => {
    const value: Authoritative2v2State = {
      phase: "playing", table: [], deck: [card("SECRET_DECK", 1)],
      hands: { p1: [card("SECRET_A1", 1)], p2: [card("SECRET_B1", 2)], p3: [card("SECRET_A3", 3)], p4: [card("SECRET_B4", 4)] },
      seatNames: { p1: "1", p2: "2", p3: "3", p4: "4" }, currentTurn: "p1", lastCaptureTeam: null,
      teamA: { captured: [], chkobas: 0, score: 0, roundPoints: 0 }, teamB: { captured: [], chkobas: 0, score: 0, roundPoints: 0 }, targetScore: 11, message: "tour",
    };
    const forB = JSON.stringify(create2v2View(value, "B"));
    expect(forB).not.toContain("SECRET_A1"); expect(forB).not.toContain("SECRET_A3"); expect(forB).not.toContain("SECRET_DECK");
    const forA = JSON.stringify(create2v2View(value, "A"));
    expect(forA).not.toContain("SECRET_B1"); expect(forA).not.toContain("SECRET_B4"); expect(forA).not.toContain("SECRET_DECK");
  });

  test("ignores old snapshots", () => {
    expect(shouldAcceptSnapshot(4, 5)).toBe(true);
    expect(shouldAcceptSnapshot(5, 5)).toBe(false);
    expect(shouldAcceptSnapshot(6, 5)).toBe(false);
  });
});

describe("room and reconnect guards", () => {
  test("locks room and only accepts the valid rejoin token", () => {
    const room = new HostSessionGuard();
    const first = room.join();
    expect(first.ok).toBe(true);
    expect(room.join()).toMatchObject({ ok: false, reason: "ROOM_FULL" });
    if (!first.ok) throw new Error("join failed");
    room.disconnect(1000);
    expect(room.rejoin(first.matchId, "wrong", 1500)).toMatchObject({ ok: false, reason: "REJOIN_DENIED" });
    expect(room.rejoin(first.matchId, first.playerToken, 1500).ok).toBe(true);
  });

  test("rejects expired reconnect and prevents duplicate credit consumption", () => {
    const room = new HostSessionGuard(); const first = room.join(); if (!first.ok) throw new Error("join failed");
    room.disconnect(0);
    expect(room.rejoin(first.matchId, first.playerToken, 60_001)).toMatchObject({ ok: false, reason: "SESSION_EXPIRED" });
    let credits = 0; const guard = new SingleChargeGuard();
    expect(guard.consumeOnce(() => { credits += 1; })).toBe(true);
    expect(guard.consumeOnce(() => { credits += 1; })).toBe(false);
    expect(credits).toBe(1);
  });
});
