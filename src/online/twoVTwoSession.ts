import { onlineManager } from "../onlineManager";
import { apply2v2Action } from "./authority";
import {
  ONLINE_PROTOCOL_VERSION,
  createActionId,
  type Online2v2View,
  type OnlineMessage,
  type RejectReason,
  type Seat,
  type ServerMessage,
} from "./protocol";
import { HostSessionGuard } from "./session";
import { create2v2View, shouldAcceptSnapshot, type Authoritative2v2State } from "./stateView";
import { isProtocolCompatible, sanitizePlayerName } from "./validation";
import type { ProtocolTransport, OneVOneSessionStatus as SessionStatus } from "./oneVOneSession";

const STORAGE_KEY = "chkoba-2v2-v2-session";
const RESUME_TTL_MS = 5 * 60_000;
type ResumeData = { roomCode: string; matchId: string; playerToken: string; protocolVersion: number; timestamp: number; mode: "2v2" };
export type Online2v2State = Authoritative2v2State & { mode: "online" };

export type TwoVTwoSessionCallbacks = {
  createHostState: (guestName: string) => Online2v2State;
  onHostState: (state: Online2v2State) => void;
  onGuestView: (view: Online2v2View) => void;
  onSessionConnected: (reconnected: boolean) => void;
  onReconnecting: (attempt: number) => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onNextRoundRequested: () => Online2v2State | null;
  onRematchRequested: () => Online2v2State | null;
};

function readResume(roomCode: string): ResumeData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<ResumeData>;
    if (data.roomCode !== roomCode || data.mode !== "2v2" || data.protocolVersion !== ONLINE_PROTOCOL_VERSION || !data.matchId || !data.playerToken || !data.timestamp || Date.now() - data.timestamp > RESUME_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data as ResumeData;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function isSeat(value: unknown): value is Seat { return value === "p1" || value === "p2" || value === "p3" || value === "p4"; }

export class TwoVTwoOnlineSession {
  private callbacks: TwoVTwoSessionCallbacks | null = null;
  private hostGuard: HostSessionGuard | null = null;
  private hostState: Online2v2State | null = null;
  private playerName = "Joueur 2";
  private matchId = "";
  private playerToken = "";
  private guestStateVersion = -1;
  private initialConnectionCompleted = false;
  private status: SessionStatus = "idle";

  constructor(private readonly transport: ProtocolTransport = onlineManager) {}

  configure(callbacks: TwoVTwoSessionCallbacks): void {
    this.callbacks = callbacks;
    this.transport.setProtocolCallbacks({
      onMessage: (message) => this.receive(message),
      onTransportConnected: () => this.transportConnected(),
      onTransportDisconnected: () => { this.hostGuard?.disconnect(); this.status = "reconnecting"; this.callbacks?.onDisconnected(); },
      onReconnecting: (attempt) => { this.status = "reconnecting"; this.callbacks?.onReconnecting(attempt); },
      onError: (message) => { this.status = "error"; this.callbacks?.onError(message); },
    });
  }

  async createRoom(): Promise<string> {
    this.reset(false); this.status = "connecting"; this.hostGuard = new HostSessionGuard();
    return this.transport.createRoom("v2");
  }

  async joinRoom(code: string, playerName: string): Promise<void> {
    this.reset(false); this.status = "connecting"; this.playerName = sanitizePlayerName(playerName, "Joueur 2");
    await this.transport.joinRoom(code, "v2");
  }

  playCard(seat: Seat, cardId: string): void { this.act("PLAY_CARD", seat, cardId, null); }
  chooseCapture(seat: Seat, cardId: string, captureIds: string[]): void { this.act("CHOOSE_CAPTURE", seat, cardId, captureIds); }
  requestNextRound(): void { this.sendRequest("REQUEST_NEXT_ROUND"); }
  requestRematch(): void { this.sendRequest("REQUEST_REMATCH"); }
  requestSync(): void {
    if (!this.matchId || !this.playerToken) return;
    this.transport.sendProtocolMessage({ type: "SYNC_REQUEST", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: this.matchId, playerToken: this.playerToken, lastKnownStateVersion: this.guestStateVersion });
  }
  publishHostState(state: Online2v2State): void { if (this.transport.isHost) this.commit(state); }
  updateHostState(updater: (state: Online2v2State) => Online2v2State): void { if (this.transport.isHost && this.hostState) this.commit(updater(this.hostState)); }
  getHostState(): Online2v2State | null { return this.hostState; }
  getStatus(): SessionStatus { return this.status; }
  destroy(): void { this.reset(true); this.status = "closed"; this.transport.destroy(); }

  private transportConnected(): void {
    this.status = "handshaking";
    if (this.transport.isHost) return;
    const resume = readResume(this.transport.roomCode);
    if (resume) {
      this.matchId = resume.matchId; this.playerToken = resume.playerToken;
      this.transport.sendProtocolMessage({ type: "REJOIN", protocolVersion: ONLINE_PROTOCOL_VERSION, mode: "2v2", matchId: resume.matchId, playerToken: resume.playerToken, playerName: this.playerName, lastKnownStateVersion: this.guestStateVersion });
    } else {
      this.transport.sendProtocolMessage({ type: "JOIN", protocolVersion: ONLINE_PROTOCOL_VERSION, mode: "2v2", playerName: this.playerName });
    }
  }

  private receive(message: OnlineMessage): void {
    if (!isProtocolCompatible(message)) {
      if (this.transport.isHost) this.transport.sendProtocolMessage({ type: "VERSION_MISMATCH", protocolVersion: ONLINE_PROTOCOL_VERSION, expectedVersion: ONLINE_PROTOCOL_VERSION });
      return;
    }
    if (this.transport.isHost) this.receiveAsHost(message); else this.receiveAsGuest(message);
  }

  private receiveAsHost(message: OnlineMessage): void {
    if (!this.hostGuard) return;
    if (message.type === "JOIN") {
      if (message.mode !== "2v2") return;
      const admission = this.hostGuard.join();
      if (!admission.ok) { this.transport.sendProtocolMessage({ type: "ROOM_FULL", protocolVersion: ONLINE_PROTOCOL_VERSION }); return; }
      this.hostState = this.callbacks?.createHostState(sanitizePlayerName(message.playerName, "Joueur 2")) ?? null;
      if (!this.hostState) return;
      this.transport.sendProtocolMessage({ type: "WELCOME", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: admission.matchId, playerToken: admission.playerToken, role: "guest", stateVersion: this.hostGuard.stateVersion, view: create2v2View(this.hostState, "B") });
      this.callbacks?.onHostState(this.hostState); this.sessionReady(false); return;
    }
    if (message.type === "REJOIN") {
      if (message.mode !== "2v2") return;
      const admission = this.hostGuard.rejoin(message.matchId, message.playerToken);
      if (!admission.ok || !this.hostState) {
        this.transport.sendProtocolMessage({ type: "REJOIN_REJECTED", protocolVersion: ONLINE_PROTOCOL_VERSION, reasonCode: admission.ok ? "REJOIN_DENIED" : admission.reason }); return;
      }
      this.transport.sendProtocolMessage({ type: "REJOIN_ACCEPTED", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: admission.matchId, playerToken: admission.playerToken, stateVersion: this.hostGuard.stateVersion, view: create2v2View(this.hostState, "B") });
      this.sessionReady(true); return;
    }
    if (message.type === "SYNC_REQUEST") {
      if (this.hostState && !this.hostGuard.validate(message.matchId, message.playerToken)) this.sendSnapshot();
      return;
    }
    if (message.type !== "PLAY_CARD" && message.type !== "CHOOSE_CAPTURE" && message.type !== "REQUEST_NEXT_ROUND" && message.type !== "REQUEST_REMATCH") return;
    const reason = this.hostGuard.authorize(message.matchId, message.playerToken, message.actionId);
    if (reason) { this.reject(message.actionId, reason); if (reason === "DUPLICATE_ACTION") this.sendSnapshot(); return; }
    if (!this.hostState) return;
    if (message.type === "PLAY_CARD" || message.type === "CHOOSE_CAPTURE") {
      if (!isSeat(message.seat)) { this.reject(message.actionId, "INVALID_MESSAGE"); return; }
      const result = apply2v2Action(this.hostState, "B", message.seat, message.cardId, message.type === "CHOOSE_CAPTURE" ? message.captureIds : null);
      if (result.ok) this.commit({ ...result.state, mode: "online" }); else this.reject(message.actionId, result.reason);
    } else if (message.type === "REQUEST_NEXT_ROUND") {
      if (message.mode !== "2v2") { this.reject(message.actionId, "INVALID_MESSAGE"); return; }
      const next = this.callbacks?.onNextRoundRequested(); if (next) this.commit(next);
    } else {
      if (message.mode !== "2v2") { this.reject(message.actionId, "INVALID_MESSAGE"); return; }
      const next = this.callbacks?.onRematchRequested(); if (next) this.commit(next);
    }
  }

  private receiveAsGuest(message: OnlineMessage): void {
    if (message.type === "WELCOME" || message.type === "REJOIN_ACCEPTED") {
      if (message.view.mode !== "2v2") return;
      this.matchId = message.matchId; this.playerToken = message.playerToken; this.guestStateVersion = message.stateVersion;
      this.persist(); this.callbacks?.onGuestView(message.view); this.sessionReady(message.type === "REJOIN_ACCEPTED"); return;
    }
    if (message.type === "STATE_SNAPSHOT") {
      if (message.matchId !== this.matchId || message.view.mode !== "2v2" || !shouldAcceptSnapshot(this.guestStateVersion, message.stateVersion)) return;
      this.guestStateVersion = message.stateVersion; this.persist(); this.callbacks?.onGuestView(message.view);
    } else if (message.type === "ROOM_FULL") this.callbacks?.onError("Cette partie a deja deux equipes.");
    else if (message.type === "VERSION_MISMATCH") this.callbacks?.onError("Les deux appareils doivent utiliser la meme version de CHKOBBA.");
    else if (message.type === "REJOIN_REJECTED") { localStorage.removeItem(STORAGE_KEY); this.callbacks?.onError("Impossible de reprendre la partie."); }
  }

  private act(type: "PLAY_CARD" | "CHOOSE_CAPTURE", seat: Seat, cardId: string, captureIds: string[] | null): void {
    if (this.transport.isHost) {
      if (!this.hostState) return;
      const result = apply2v2Action(this.hostState, "A", seat, cardId, captureIds);
      if (result.ok) this.commit({ ...result.state, mode: "online" });
      return;
    }
    if (!this.matchId || !this.playerToken) return;
    const base = { protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: this.matchId, playerToken: this.playerToken, actionId: createActionId(), seat, cardId };
    this.transport.sendProtocolMessage(type === "PLAY_CARD" ? { ...base, type } : { ...base, type, captureIds: captureIds ?? [] });
  }

  private sendRequest(type: "REQUEST_NEXT_ROUND" | "REQUEST_REMATCH"): void {
    if (!this.matchId || !this.playerToken) return;
    this.transport.sendProtocolMessage({ type, protocolVersion: ONLINE_PROTOCOL_VERSION, mode: "2v2", matchId: this.matchId, playerToken: this.playerToken, actionId: createActionId() });
  }
  private commit(state: Online2v2State): void { this.hostState = state; this.hostGuard?.nextVersion(); this.callbacks?.onHostState(state); this.sendSnapshot(); }
  private sendSnapshot(): void {
    if (!this.hostGuard || !this.hostState) return;
    const message: ServerMessage = { type: "STATE_SNAPSHOT", protocolVersion: ONLINE_PROTOCOL_VERSION, matchId: this.hostGuard.matchId, stateVersion: this.hostGuard.stateVersion, view: create2v2View(this.hostState, "B") };
    this.transport.sendProtocolMessage(message);
  }
  private reject(actionId: string, reasonCode: RejectReason): void { this.transport.sendProtocolMessage({ type: "ACTION_REJECTED", protocolVersion: ONLINE_PROTOCOL_VERSION, actionId, reasonCode }); }
  private sessionReady(reconnected: boolean): void { if (!reconnected && this.initialConnectionCompleted) return; this.initialConnectionCompleted = true; this.status = "connected"; this.callbacks?.onSessionConnected(reconnected); }
  private persist(): void { localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode: this.transport.roomCode, matchId: this.matchId, playerToken: this.playerToken, protocolVersion: ONLINE_PROTOCOL_VERSION, timestamp: Date.now(), mode: "2v2" } satisfies ResumeData)); }
  private reset(clearStorage: boolean): void {
    this.hostGuard?.close(); this.hostGuard = null; this.hostState = null; this.matchId = ""; this.playerToken = ""; this.guestStateVersion = -1; this.initialConnectionCompleted = false; this.status = "idle";
    if (clearStorage) localStorage.removeItem(STORAGE_KEY);
  }
}

export const twoVTwoSession = new TwoVTwoOnlineSession();
