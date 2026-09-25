import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { logOnlineEvent } = vi.hoisted(() => ({ logOnlineEvent: vi.fn(() => Promise.resolve()) }));

vi.mock("../src/online/telemetry", () => ({ logOnlineEvent }));

import { OnlineSessionTelemetry } from "../src/online/sessionTelemetry";

beforeEach(() => {
  logOnlineEvent.mockReset();
  logOnlineEvent.mockImplementation(() => Promise.resolve());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("online session telemetry", () => {
  test("logs join success once", () => {
    const telemetry = new OnlineSessionTelemetry("1v1", () => "guest");
    telemetry.joinStarted();
    telemetry.joinSuccess();
    telemetry.joinSuccess();

    expect(logOnlineEvent).toHaveBeenCalledWith("online_join_started", expect.any(Object));
    expect(logOnlineEvent.mock.calls.filter(([name]) => name === "online_join_success")).toHaveLength(1);
  });

  test("logs a join failure once with its sanitized reason", () => {
    const telemetry = new OnlineSessionTelemetry("2v2", () => "guest");
    telemetry.joinStarted();
    telemetry.joinFailed("room_full", "session_handshake");
    telemetry.joinFailed("transport_error");

    const failures = logOnlineEvent.mock.calls.filter(([name]) => name === "online_join_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0][1]).toMatchObject({ mode: "2v2", role: "guest", reasonCode: "room_full" });
  });

  test("logs one success for one reconnect sequence", () => {
    const telemetry = new OnlineSessionTelemetry("1v1", () => "guest");
    telemetry.connected(false);
    telemetry.disconnected();
    telemetry.disconnected();
    telemetry.reconnecting(1);
    telemetry.reconnecting(2);
    telemetry.connected(true);
    telemetry.connected(true);

    expect(logOnlineEvent.mock.calls.filter(([name]) => name === "online_disconnect")).toHaveLength(1);
    expect(logOnlineEvent.mock.calls.filter(([name]) => name === "online_reconnect_started")).toHaveLength(1);
    expect(logOnlineEvent.mock.calls.filter(([name]) => name === "online_reconnect_success")).toHaveLength(1);
    expect(logOnlineEvent.mock.calls.filter(([name]) => name === "online_reconnect_failed")).toHaveLength(0);
  });

  test("logs one reconnect failure and no later stale timeout", () => {
    const telemetry = new OnlineSessionTelemetry("1v1", () => "host");
    telemetry.connected(false);
    telemetry.disconnected();
    telemetry.reconnecting(3);
    telemetry.reconnectFailed("reconnect_timeout");
    vi.advanceTimersByTime(120_000);

    const failures = logOnlineEvent.mock.calls.filter(([name]) => name === "online_reconnect_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0][1]).toMatchObject({ reasonCode: "reconnect_timeout", reconnectAttempt: 3 });
  });

  test("action rejection contains technical context only", () => {
    const telemetry = new OnlineSessionTelemetry("2v2", () => "host");
    telemetry.actionRejected("INVALID_CAPTURE");

    expect(logOnlineEvent).toHaveBeenCalledWith("online_action_rejected", {
      mode: "2v2",
      role: "host",
      protocolVersion: 2,
      reasonCode: "INVALID_CAPTURE",
      connectionStage: "authority",
    });
    expect(JSON.stringify(logOnlineEvent.mock.calls)).not.toMatch(/token|matchId|roomCode|card|captureIds|deck|playerName/i);
  });

  test("logs match completion only once until a rematch starts", () => {
    const telemetry = new OnlineSessionTelemetry("1v1", () => "host");
    telemetry.observePhase("gameOver");
    telemetry.observePhase("gameOver");
    telemetry.observePhase("playing");
    telemetry.observePhase("gameOver");

    expect(logOnlineEvent.mock.calls.filter(([name]) => name === "online_match_completed")).toHaveLength(2);
  });

  test("a synchronous telemetry failure cannot interrupt the session", () => {
    logOnlineEvent.mockImplementationOnce(() => { throw new Error("analytics unavailable"); });
    const telemetry = new OnlineSessionTelemetry("1v1", () => "guest");

    expect(() => telemetry.joinStarted()).not.toThrow();
    expect(() => telemetry.joinSuccess()).not.toThrow();
  });
});
