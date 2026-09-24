import {
  MAX_CAPTURE_IDS,
  MAX_PLAYER_NAME_LENGTH,
  ONLINE_PROTOCOL_VERSION,
  type ClientMessage,
  type OnlineMessage,
  type OnlineMode,
  type Seat,
} from "./protocol";

const TYPES = new Set([
  "JOIN", "REJOIN", "PLAY_CARD", "CHOOSE_CAPTURE", "REQUEST_NEXT_ROUND", "REQUEST_REMATCH",
  "SYNC_REQUEST", "PING", "WELCOME", "STATE_SNAPSHOT", "ACTION_REJECTED", "ROOM_FULL",
  "VERSION_MISMATCH", "REJOIN_ACCEPTED", "REJOIN_REJECTED", "PONG",
]);
const CLIENT_TYPES = new Set(["JOIN", "REJOIN", "PLAY_CARD", "CHOOSE_CAPTURE", "REQUEST_NEXT_ROUND", "REQUEST_REMATCH", "SYNC_REQUEST", "PING"]);
const MAX_STRING = 128;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shortString(value: unknown, max = MAX_STRING): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function mode(value: unknown): value is OnlineMode { return value === "1v1" || value === "2v2"; }
function seat(value: unknown): value is Seat { return value === "p1" || value === "p2" || value === "p3" || value === "p4"; }
function version(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function side(value: unknown): boolean { return value === "player1" || value === "player2"; }
function nullableSide(value: unknown): boolean { return value === null || side(value); }
function card(value: unknown): boolean {
  return object(value) && shortString(value.id, 80) && Number.isSafeInteger(value.rank) && (value.rank as number) >= 1 && (value.rank as number) <= 10
    && (value.suit === "pique" || value.suit === "coeur" || value.suit === "carreau" || value.suit === "trefle");
}
function cards(value: unknown): boolean { return Array.isArray(value) && value.length <= 52 && value.every(card); }
function score(value: unknown): boolean {
  if (value === null) return true;
  if (!object(value)) return false;
  return ["cards", "carreaux", "septCarreau", "bermila", "chkobas", "total"].every((key) => Number.isSafeInteger(value[key]));
}
function publicPlayer(value: unknown): boolean {
  return object(value) && typeof value.name === "string" && value.name.length <= MAX_PLAYER_NAME_LENGTH
    && version(value.handCount) && cards(value.captured) && version(value.chkobas);
}
function oneVOneView(value: unknown): boolean {
  if (!object(value) || value.mode !== "1v1") return false;
  const phases = new Set(["menu", "playing", "turnTransition", "roundEnd", "gameOver"]);
  return typeof value.phase === "string" && phases.has(value.phase)
    && cards(value.table) && side(value.mySide) && cards(value.myHand)
    && publicPlayer(value.player1) && publicPlayer(value.player2)
    && version(value.deckCount) && side(value.currentTurn) && nullableSide(value.lastCapture)
    && version(value.player1Score) && version(value.player2Score)
    && score(value.roundScorePlayer1) && score(value.roundScorePlayer2) && version(value.targetScore)
    && typeof value.message === "string" && value.message.length <= 500
    && (value.selectedCard === null || card(value.selectedCard))
    && (value.possibleCaptures === null || (Array.isArray(value.possibleCaptures) && value.possibleCaptures.every(cards)))
    && typeof value.lastAction === "string" && value.lastAction.length <= 128 && nullableSide(value.showChkoba);
}
function team(value: unknown): boolean { return value === "A" || value === "B"; }
function nullableTeam(value: unknown): boolean { return value === null || team(value); }
function teamInfo(value: unknown): boolean {
  return object(value) && cards(value.captured) && version(value.chkobas) && version(value.score) && version(value.roundPoints);
}
function twoVTwoView(value: unknown): boolean {
  if (!object(value) || value.mode !== "2v2") return false;
  if (value.phase !== "playing" && value.phase !== "roundEnd" && value.phase !== "gameOver") return false;
  if (!cards(value.table) || !team(value.myTeam) || !object(value.myHands) || !object(value.handCounts) || !object(value.seatNames)) return false;
  for (const currentSeat of ["p1", "p2", "p3", "p4"]) {
    if (!version(value.handCounts[currentSeat]) || typeof value.seatNames[currentSeat] !== "string" || (value.seatNames[currentSeat] as string).length > MAX_PLAYER_NAME_LENGTH) return false;
    if (value.myHands[currentSeat] !== undefined && !cards(value.myHands[currentSeat])) return false;
  }
  return version(value.deckCount) && seat(value.currentTurn) && nullableTeam(value.lastCaptureTeam)
    && teamInfo(value.teamA) && teamInfo(value.teamB) && version(value.targetScore)
    && typeof value.message === "string" && value.message.length <= 500;
}
function onlineView(value: unknown): boolean { return oneVOneView(value) || twoVTwoView(value); }

export function sanitizePlayerName(value: unknown, fallback = "Joueur"): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_PLAYER_NAME_LENGTH);
  return clean || fallback;
}

export function parseOnlineMessage(data: unknown): OnlineMessage | null {
  if (!object(data) || !shortString(data.type, 32) || !TYPES.has(data.type)) return null;
  if (data.protocolVersion !== ONLINE_PROTOCOL_VERSION) {
    if (typeof data.protocolVersion !== "number") return null;
  }
  const type = data.type;
  if (type === "PING" || type === "PONG") return typeof data.timestamp === "number" ? data as OnlineMessage : null;
  if (type === "ROOM_FULL") return data as OnlineMessage;
  if (type === "VERSION_MISMATCH") return typeof data.expectedVersion === "number" ? data as OnlineMessage : null;
  if (type === "JOIN") return mode(data.mode) && typeof data.playerName === "string" && data.playerName.length <= MAX_PLAYER_NAME_LENGTH ? data as OnlineMessage : null;
  if (type === "ACTION_REJECTED") return shortString(data.reasonCode, 32) ? data as OnlineMessage : null;
  if (type === "REJOIN_REJECTED") return shortString(data.reasonCode, 32) ? data as OnlineMessage : null;
  if (!shortString(data.matchId, 80)) return null;
  if (type === "WELCOME" || type === "REJOIN_ACCEPTED") {
    if (type === "WELCOME" && data.role !== "guest") return null;
    return shortString(data.playerToken, 128) && version(data.stateVersion) && onlineView(data.view) ? data as OnlineMessage : null;
  }
  if (type === "STATE_SNAPSHOT") return version(data.stateVersion) && onlineView(data.view) ? data as OnlineMessage : null;
  if (type === "SYNC_REQUEST") return shortString(data.playerToken, 128) && version(data.lastKnownStateVersion) ? data as OnlineMessage : null;
  if (type === "REJOIN") return mode(data.mode) && shortString(data.playerToken, 128) && version(data.lastKnownStateVersion) && typeof data.playerName === "string" ? data as OnlineMessage : null;
  if (!shortString(data.actionId, 80) || !shortString(data.playerToken, 128)) return null;
  if (type === "PLAY_CARD") return shortString(data.cardId, 80) && (data.seat === undefined || seat(data.seat)) ? data as OnlineMessage : null;
  if (type === "CHOOSE_CAPTURE") {
    return shortString(data.cardId, 80) && Array.isArray(data.captureIds) && data.captureIds.length <= MAX_CAPTURE_IDS && data.captureIds.every((id) => shortString(id, 80)) && (data.seat === undefined || seat(data.seat)) ? data as OnlineMessage : null;
  }
  if (type === "REQUEST_NEXT_ROUND" || type === "REQUEST_REMATCH") return mode(data.mode) ? data as OnlineMessage : null;
  return null;
}

export function parseClientMessage(data: unknown): ClientMessage | null {
  const parsed = parseOnlineMessage(data);
  return parsed && CLIENT_TYPES.has(parsed.type) ? parsed as ClientMessage : null;
}

export function isProtocolCompatible(message: { protocolVersion: number }): boolean {
  return message.protocolVersion === ONLINE_PROTOCOL_VERSION;
}

export function sameIdSet(requested: string[], legal: string[]): boolean {
  if (requested.length !== legal.length || new Set(requested).size !== requested.length) return false;
  const expected = new Set(legal);
  return requested.every((id) => expected.has(id));
}

export function isLegacyOnlineMessage(data: unknown): boolean {
  if (!object(data) || typeof data.type !== "string") return false;
  return ["game-state", "play-card", "capture-choice", "next-round", "play-again", "player-name", "sync-request",
    "2v2-state", "2v2-play", "2v2-sync", "2v2-player-name", "2v2-next-round", "2v2-play-again"].includes(data.type);
}
