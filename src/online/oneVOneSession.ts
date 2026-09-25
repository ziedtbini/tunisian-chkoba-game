import type { GameState } from "../types";
import { onlineManager } from "../onlineManager";
import { apply1v1Capture, apply1v1Play } from "./authority";
import {
  ONLINE_PROTOCOL_VERSION,
  RECONNECT_WINDOW_MS,
  createActionId,
  type ClientMessage,
  type Online1v1View,
  type OnlineMessage,
  type RejectReason,
  type ServerMessage,
} from "./protocol";
import { HostSessionGuard } from "./session";
import { create1v1View, shouldAcceptSnapshot } from "./stateView";
import { isProtocolCompatible, sanitizePlayerName } from "./validation";
import { computerPlay } from "../gameLogic";
import { OnlineSessionTelemetry } from "./sessionTelemetry";

const STORAGE_KEY = "chkoba-1v1-v2-session";
const RESUME_TTL_MS = RECONNECT_WINDOW_MS;

type ResumeData = {
  roomCode: string;
  matchId: string;
  playerToken: string;
  protocolVersion: number;
  timestamp: number;
  mode: "1v1";
};

export type OneVOneSessionCallbacks = {
  createHostState: (guestName: string) => GameState;
  onHostState: (state: GameState) => void;
  onGuestView: (view: Online1v1View) => void;
  onSessionConnected: (reconnected: boolean) => void;
  onReconnecting: (attempt: number) => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onNextRoundRequested: () => GameState | null;
  onRematchRequested: () => GameState | null;
};

export type OneVOneSessionStatus = "idle" | "connecting" | "transport-connected" | "handshaking" | "connected" | "reconnecting" | "closed" | "error";

export type ProtocolTransport = {
  isHost: boolean;
  roomCode: string;
  setProtocolCallbacks(callbacks: {
    onMessage: (message: OnlineMessage) => void;
    onTransportConnected: () => void;
    onTransportDisconnected: () => void;
    onReconnecting?: (attempt: number) => void;
    onError?: (message: string, reasonCode?: string) => void;
  }): void;
  createRoom(protocol: "v2"): Promise<string>;
  joinRoom(code: string, protocol: "v2"): Promise<void>;
  sendProtocolMessage(message: OnlineMessage): void;
  markSessionConnected?(): void;
  destroy(): void;
};

function readResume(roomCode: string): ResumeData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<ResumeData>;
    if (data.roomCode !== roomCode || data.mode !== "1v1" || data.protocolVersion !== ONLINE_PROTOCOL_VERSION || !data.matchId || !data.playerToken || !data.timestamp || Date.now() - data.timestamp > RESUME_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data as ResumeData;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export class OneVOneOnlineSession {
  private callbacks: OneVOneSessionCallbacks | null = null;
  private hostGuard: HostSessionGuard | null = null;
  private hostState: GameState | null = null;
  private guestName = "Joueur 2";
  private matchId = "";
  private playerToken = "";
  private guestStateVersion = -1;
  private initialConnectionCompleted = false;
  private status: OneVOneSessionStatus = "idle";
  private readonly telemetry: OnlineSessionTelemetry;

  constructor(private readonly transport: ProtocolTransport = onlineManager) {
    this.telemetry = new OnlineSessionTelemetry("1v1", () => this.transport.isHost ? "host" : "guest");
  }

  configure(callbacks: OneVOneSessionCallbacks): void {
    this.callbacks = callbacks;
    this.transport.setProtocolCallbacks({
      onMessage: (message) => this.receive(message),
      onTransportConnected: () => this.transportConnected(),
      onTransportDisconnected: () => {
        this.hostGuard?.disconnect();
        this.status = "reconnecting";
        this.telemetry.disconnected();
        this.callbacks?.onDisconnected();
      },
      onReconnecting: (attempt) => {
        this.status = "reconnecting";
        this.telemetry.reconnecting(attempt);
        this.callbacks?.onReconnecting(attempt);
      },
      onError: (message, reasonCode = "transport_error") => {
        if (this.status === "reconnecting") this.telemetry.reconnectFailed(reasonCode);
        else this.telemetry.joinFailed(reasonCode);
        this.status = "error";
        this.callbacks?.onError(message);
      },
    });
  }

  async createRoom(): Promise<string> {
    this.resetSession(false);
    this.status = "connecting";
    this.hostGuard = new HostSessionGuard();
    const code = await this.transport.createRoom("v2");
    this.telemetry.roomCreated();
    return code;
  }

  async joinRoom(code: string, playerName: string): Promise<void> {
    this.resetSession(false);
    this.status = "connecting";
    this.guestName = sanitizePlayerName(playerName, "Joueur 2");
    this.telemetry.joinStarted();
    try {
      await this.transport.joinRoom(code, "v2");
    } catch (error) {
      this.telemetry.joinFailed("transport_error");
      throw error;
    }
  }

  playCard(cardId: string): void {
    if (this.transport.isHost) {
      if (!this.hostState) return;
      const result = apply1v1Play(this.hostState, "player1", cardId);
      if (result.ok) this.commitHostState(result.state);
      return;
    }
    this.sendAction({ type: "PLAY_CARD", cardId });
  }

  chooseCapture(cardId: string, captureIds: string[]): void {
    if (this.transport.isHost) {
      if (!this.hostState) return;
      const result = apply1v1Capture(this.hostState, "player1", cardId, captureIds);
      if (result.ok) this.commitHostState(result.state);
      return;
    }
    this.sendAction({ type: "CHOOSE_CAPTURE", cardId, captureIds });
  }

  publishHostState(state: GameState, notify = true): void {
    if (!this.transport.isHost) return;
    this.commitHostState(state, notify);
  }

  updateHostState(updater: (state: GameState) => GameState): void {
    if (!this.transport.isHost || !this.hostState) return;
    this.commitHostState(updater(this.hostState));
  }

  requestSync(): void {
    if (!this.matchId || !this.playerToken) return;
    this.telemetry.syncRequested();
    this.transport.sendProtocolMessage({ type: "SYNC_REQUEST", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: this.matchId, playerToken: this.playerToken, lastKnownStateVersion: this.guestStateVersion });
  }

  requestNextRound(): void { this.sendAction({ type: "REQUEST_NEXT_ROUND", mode: "1v1" }); }
  requestRematch(): void { this.sendAction({ type: "REQUEST_REMATCH", mode: "1v1" }); }
  forceTimedTurn(): void {
    if (!this.transport.isHost || !this.hostState || this.hostState.phase !== "playing") return;
    const state = this.hostState;
    const side = state.currentTurn;
    if (state.selectedCard && state.possibleCaptures?.length) {
      const result = apply1v1Capture(state, side, state.selectedCard.id, state.possibleCaptures[0].map((card) => card.id));
      if (result.ok) this.commitHostState({ ...result.state, message: `Temps écoulé. ${result.state.message}` });
      return;
    }
    const hand = state[side].hand;
    if (hand.length === 0) return;
    const { card, capture } = computerPlay(hand, state.table);
    const played = apply1v1Play(state, side, card.id);
    if (!played.ok) return;
    let next = played.state;
    if (next.selectedCard && capture) {
      const captured = apply1v1Capture(next, side, card.id, capture.map((item) => item.id));
      if (captured.ok) next = captured.state;
    }
    this.commitHostState({ ...next, message: `Temps écoulé. ${next.message}` });
  }
  getHostState(): GameState | null { return this.hostState; }
  getStatus(): OneVOneSessionStatus { return this.status; }
  destroy(): void { this.resetSession(true); this.status = "closed"; this.transport.destroy(); }

  private transportConnected(): void {
    this.status = "transport-connected";
    if (this.transport.isHost) {
      this.status = "handshaking";
      return;
    }
    this.status = "handshaking";
    const resume = readResume(this.transport.roomCode);
    if (resume) {
      this.matchId = resume.matchId;
      this.playerToken = resume.playerToken;
      this.transport.sendProtocolMessage({ type: "REJOIN", protocolVersion: ONLINE_PROTOCOL_VERSION, mode: "1v1", matchId: resume.matchId, playerToken: resume.playerToken, playerName: this.guestName, lastKnownStateVersion: this.guestStateVersion });
    } else {
      this.transport.sendProtocolMessage({ type: "JOIN", protocolVersion: ONLINE_PROTOCOL_VERSION, mode: "1v1", playerName: this.guestName });
    }
  }

  private receive(message: OnlineMessage): void {
    if (!isProtocolCompatible(message)) {
      if (this.transport.isHost) this.transport.sendProtocolMessage({ type: "VERSION_MISMATCH", protocolVersion: ONLINE_PROTOCOL_VERSION, expectedVersion: ONLINE_PROTOCOL_VERSION });
      return;
    }
    if (this.transport.isHost) this.receiveAsHost(message);
    else this.receiveAsGuest(message);
  }

  private receiveAsHost(message: OnlineMessage): void {
    if (!this.hostGuard) return;
    if (message.type === "JOIN") {
      if (message.mode !== "1v1") return;
      const admission = this.hostGuard.join();
      if (!admission.ok) {
        this.transport.sendProtocolMessage({ type: "ROOM_FULL", protocolVersion: ONLINE_PROTOCOL_VERSION });
        return;
      }
      this.hostState = this.callbacks?.createHostState(sanitizePlayerName(message.playerName)) ?? null;
      if (!this.hostState) return;
      this.transport.sendProtocolMessage({ type: "WELCOME", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: admission.matchId, playerToken: admission.playerToken, role: "guest", stateVersion: this.hostGuard.stateVersion, view: create1v1View(this.hostState, "player2") });
      this.callbacks?.onHostState(this.hostState);
      this.sessionReady(false);
      return;
    }
    if (message.type === "REJOIN") {
      const admission = this.hostGuard.rejoin(message.matchId, message.playerToken);
      if (!admission.ok || !this.hostState) {
        const reasonCode = admission.ok ? "REJOIN_DENIED" : admission.reason;
        this.telemetry.reconnectFailed(reasonCode.toLowerCase());
        this.transport.sendProtocolMessage({ type: "REJOIN_REJECTED", protocolVersion: ONLINE_PROTOCOL_VERSION, reasonCode });
        return;
      }
      this.transport.sendProtocolMessage({ type: "REJOIN_ACCEPTED", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: admission.matchId, playerToken: admission.playerToken, stateVersion: this.hostGuard.stateVersion, view: create1v1View(this.hostState, "player2") });
      this.sessionReady(true);
      return;
    }
    if (message.type === "SYNC_REQUEST") {
      if (!this.hostState || this.hostGuard.validate(message.matchId, message.playerToken)) return;
      this.sendSnapshot();
      return;
    }
    if (message.type !== "PLAY_CARD" && message.type !== "CHOOSE_CAPTURE" && message.type !== "REQUEST_NEXT_ROUND" && message.type !== "REQUEST_REMATCH") return;
    const reason = this.hostGuard.authorize(message.matchId, message.playerToken, message.actionId);
    if (reason) {
      this.rejectAction(message.actionId, reason);
      if (reason === "DUPLICATE_ACTION") this.sendSnapshot();
      return;
    }
    if (!this.hostState) return;
    if (message.type === "PLAY_CARD") {
      const result = apply1v1Play(this.hostState, "player2", message.cardId);
      if (result.ok) this.commitHostState(result.state);
      else this.rejectAction(message.actionId, result.reason);
    } else if (message.type === "CHOOSE_CAPTURE") {
      const result = apply1v1Capture(this.hostState, "player2", message.cardId, message.captureIds);
      if (result.ok) this.commitHostState(result.state);
      else this.rejectAction(message.actionId, result.reason);
    } else if (message.type === "REQUEST_NEXT_ROUND") {
      if (message.mode !== "1v1") { this.rejectAction(message.actionId, "INVALID_MESSAGE"); return; }
      const next = this.callbacks?.onNextRoundRequested();
      if (next) this.commitHostState(next);
    } else {
      if (message.mode !== "1v1") { this.rejectAction(message.actionId, "INVALID_MESSAGE"); return; }
      const next = this.callbacks?.onRematchRequested();
      if (next) this.commitHostState(next);
    }
  }

  private receiveAsGuest(message: OnlineMessage): void {
    if (message.type === "WELCOME" || message.type === "REJOIN_ACCEPTED") {
      if (message.view.mode !== "1v1") return;
      if (message.type === "WELCOME") this.telemetry.joinSuccess();
      this.matchId = message.matchId;
      this.playerToken = message.playerToken;
      this.guestStateVersion = message.stateVersion;
      this.persist();
      this.callbacks?.onGuestView(message.view);
      this.telemetry.observePhase(message.view.phase);
      this.sessionReady(message.type === "REJOIN_ACCEPTED");
      return;
    }
    if (message.type === "STATE_SNAPSHOT") {
      if (message.matchId !== this.matchId || message.view.mode !== "1v1" || !shouldAcceptSnapshot(this.guestStateVersion, message.stateVersion)) return;
      this.guestStateVersion = message.stateVersion;
      this.persist();
      this.callbacks?.onGuestView(message.view);
      this.telemetry.observePhase(message.view.phase);
    } else if (message.type === "ROOM_FULL") {
      this.telemetry.joinFailed("room_full", "session_handshake");
      this.callbacks?.onError("Cette partie a deja deux joueurs.");
    } else if (message.type === "VERSION_MISMATCH") {
      this.telemetry.joinFailed("version_mismatch", "session_handshake");
      this.callbacks?.onError("Les deux appareils doivent utiliser la meme version de CHKOBBA.");
    } else if (message.type === "REJOIN_REJECTED") {
      this.telemetry.reconnectFailed(message.reasonCode.toLowerCase());
      localStorage.removeItem(STORAGE_KEY);
      this.callbacks?.onError("Impossible de reprendre la partie.");
    }
  }

  private sendAction(action: { type: "PLAY_CARD"; cardId: string } | { type: "CHOOSE_CAPTURE"; cardId: string; captureIds: string[] } | { type: "REQUEST_NEXT_ROUND"; mode: "1v1" } | { type: "REQUEST_REMATCH"; mode: "1v1" }): void {
    if (!this.matchId || !this.playerToken) return;
    this.transport.sendProtocolMessage({ ...action, protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: this.matchId, playerToken: this.playerToken, actionId: createActionId() } as ClientMessage);
  }

  private commitHostState(state: GameState, notify = true): void {
    this.hostState = state;
    this.telemetry.observePhase(state.phase);
    this.hostGuard?.nextVersion();
    if (notify) this.callbacks?.onHostState(state);
    this.sendSnapshot();
  }

  private sendSnapshot(): void {
    if (!this.hostGuard || !this.hostState) return;
    const message: ServerMessage = { type: "STATE_SNAPSHOT", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: this.hostGuard.matchId, stateVersion: this.hostGuard.stateVersion, view: create1v1View(this.hostState, "player2") };
    this.transport.sendProtocolMessage(message);
  }

  private rejectAction(actionId: string, reasonCode: RejectReason): void {
    this.telemetry.actionRejected(reasonCode);
    this.transport.sendProtocolMessage({
      type: "ACTION_REJECTED",
      protocolVersion: ONLINE_PROTOCOL_VERSION,
      actionId,
      reasonCode,
    });
  }

  private sessionReady(reconnected: boolean): void {
    if (!reconnected && this.initialConnectionCompleted) return;
    this.initialConnectionCompleted = true;
    this.status = "connected";
    this.transport.markSessionConnected?.();
    this.telemetry.connected(reconnected);
    this.callbacks?.onSessionConnected(reconnected);
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode: this.transport.roomCode, matchId: this.matchId, playerToken: this.playerToken, protocolVersion: ONLINE_PROTOCOL_VERSION, timestamp: Date.now(), mode: "1v1" } satisfies ResumeData));
  }

  private resetSession(clearStorage: boolean): void {
    this.hostGuard?.close(); this.hostGuard = null; this.hostState = null; this.matchId = ""; this.playerToken = ""; this.guestStateVersion = -1; this.initialConnectionCompleted = false;
    this.status = "idle";
    this.telemetry.reset();
    if (clearStorage) localStorage.removeItem(STORAGE_KEY);
  }
}

export const oneVOneSession = new OneVOneOnlineSession();
