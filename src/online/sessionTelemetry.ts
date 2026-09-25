import { ONLINE_PROTOCOL_VERSION, RECONNECT_WINDOW_MS, type OnlineMode, type RejectReason } from "./protocol";
import { logOnlineEvent } from "./telemetry";

type Role = "host" | "guest";

export class OnlineSessionTelemetry {
  private joinStartedLogged = false;
  private joinOutcomeLogged = false;
  private matchStartedLogged = false;
  private matchCompletedLogged = false;
  private reconnectActive = false;
  private reconnectAttempt = 0;
  private reconnectFailureTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly mode: OnlineMode,
    private readonly getRole: () => Role,
  ) {}

  roomCreated(): void {
    this.emit("online_room_created", { connectionStage: "room_created" });
  }

  joinStarted(): void {
    if (this.joinStartedLogged) return;
    this.joinStartedLogged = true;
    this.emit("online_join_started", { connectionStage: "join_transport" });
  }

  joinSuccess(): void {
    if (this.joinOutcomeLogged) return;
    this.joinOutcomeLogged = true;
    this.emit("online_join_success", { connectionStage: "welcome_received" });
  }

  joinFailed(reasonCode: string, connectionStage = "join_transport"): void {
    if (!this.joinStartedLogged || this.joinOutcomeLogged) return;
    this.joinOutcomeLogged = true;
    this.emit("online_join_failed", { reasonCode, connectionStage });
  }

  connected(reconnected: boolean): void {
    if (reconnected && this.reconnectActive) {
      this.emit("online_reconnect_success", {
        reconnectAttempt: this.reconnectAttempt,
        connectionStage: "session_rejoined",
      });
      this.finishReconnect();
    }
    if (!reconnected && !this.matchStartedLogged) {
      this.matchStartedLogged = true;
      this.emit("online_match_started", { connectionStage: "session_connected" });
    }
  }

  disconnected(): void {
    if (!this.matchStartedLogged || this.reconnectActive) return;
    this.reconnectActive = true;
    this.reconnectAttempt = 0;
    this.emit("online_disconnect", { connectionStage: "data_connection_lost" });
    this.emit("online_reconnect_started", { reconnectAttempt: 1, connectionStage: "reconnect" });
    this.reconnectFailureTimer = setTimeout(() => this.reconnectFailed("reconnect_timeout"), RECONNECT_WINDOW_MS);
  }

  reconnecting(attempt: number): void {
    if (this.reconnectActive) this.reconnectAttempt = Math.max(this.reconnectAttempt, attempt);
  }

  reconnectFailed(reasonCode: string): void {
    if (!this.reconnectActive) return;
    this.emit("online_reconnect_failed", {
      reasonCode,
      reconnectAttempt: this.reconnectAttempt,
      connectionStage: "reconnect",
    });
    this.finishReconnect();
  }

  syncRequested(): void {
    this.emit("online_sync_requested", { connectionStage: "state_sync" });
  }

  actionRejected(reasonCode: RejectReason): void {
    this.emit("online_action_rejected", { reasonCode, connectionStage: "authority" });
  }

  observePhase(phase: string): void {
    if (phase === "gameOver" && !this.matchCompletedLogged) {
      this.matchCompletedLogged = true;
      this.emit("online_match_completed", { connectionStage: "game_over" });
    } else if (phase === "playing" && this.matchCompletedLogged) {
      this.matchCompletedLogged = false;
    }
  }

  reset(): void {
    this.clearReconnectTimer();
    this.joinStartedLogged = false;
    this.joinOutcomeLogged = false;
    this.matchStartedLogged = false;
    this.matchCompletedLogged = false;
    this.reconnectActive = false;
    this.reconnectAttempt = 0;
  }

  private finishReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectActive = false;
    this.reconnectAttempt = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectFailureTimer !== null) {
      clearTimeout(this.reconnectFailureTimer);
      this.reconnectFailureTimer = null;
    }
  }

  private emit(name: Parameters<typeof logOnlineEvent>[0], params: Parameters<typeof logOnlineEvent>[1]): void {
    try {
      void logOnlineEvent(name, {
        mode: this.mode,
        role: this.getRole(),
        protocolVersion: ONLINE_PROTOCOL_VERSION,
        ...params,
      }).catch(() => {});
    } catch {
      // A telemetry adapter must never interrupt the session.
    }
  }
}
