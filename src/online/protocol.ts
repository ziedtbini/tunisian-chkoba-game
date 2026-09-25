import type { Card, GamePhase, PlayerSide, Score } from "../types";

export const ONLINE_PROTOCOL_VERSION = 2 as const;
export const RECONNECT_WINDOW_MS = 60_000;
export const MAX_PLAYER_NAME_LENGTH = 20;
export const MAX_CAPTURE_IDS = 12;

export type OnlineMode = "1v1" | "2v2";
export type RejectReason =
  | "INVALID_MESSAGE"
  | "VERSION_MISMATCH"
  | "INVALID_MATCH"
  | "NOT_YOUR_TURN"
  | "CARD_NOT_FOUND"
  | "INVALID_CAPTURE"
  | "INVALID_PHASE"
  | "DUPLICATE_ACTION"
  | "ROOM_FULL"
  | "REJOIN_DENIED"
  | "SESSION_EXPIRED";

export type PublicPlayer = {
  name: string;
  handCount: number;
  captured: Card[];
  chkobas: number;
};

export type Online1v1View = {
  mode: "1v1";
  phase: GamePhase;
  table: Card[];
  mySide: PlayerSide;
  myHand: Card[];
  player1: PublicPlayer;
  player2: PublicPlayer;
  deckCount: number;
  currentTurn: PlayerSide;
  lastCapture: PlayerSide | null;
  player1Score: number;
  player2Score: number;
  roundScorePlayer1: Score | null;
  roundScorePlayer2: Score | null;
  targetScore: number;
  message: string;
  selectedCard: Card | null;
  possibleCaptures: Card[][] | null;
  lastAction: string;
  showChkoba: PlayerSide | null;
};

export type Seat = "p1" | "p2" | "p3" | "p4";
export type Team = "A" | "B";
export type PublicTeamInfo = { captured: Card[]; chkobas: number; score: number; roundPoints: number };

export type Online2v2View = {
  mode: "2v2";
  phase: "playing" | "roundEnd" | "gameOver";
  table: Card[];
  myTeam: Team;
  myHands: Partial<Record<Seat, Card[]>>;
  handCounts: Record<Seat, number>;
  seatNames: Record<Seat, string>;
  deckCount: number;
  currentTurn: Seat;
  lastCaptureTeam: Team | null;
  teamA: PublicTeamInfo;
  teamB: PublicTeamInfo;
  targetScore: number;
  message: string;
};

type Envelope = { protocolVersion: typeof ONLINE_PROTOCOL_VERSION };
type SessionEnvelope = Envelope & { matchId: string };
type ActionEnvelope = SessionEnvelope & { actionId: string; playerToken: string };

export type ClientMessage =
  | (Envelope & { type: "JOIN"; mode: OnlineMode; playerName: string })
  | (SessionEnvelope & { type: "REJOIN"; mode: OnlineMode; playerName: string; playerToken: string; lastKnownStateVersion: number })
  | (ActionEnvelope & { type: "PLAY_CARD"; cardId: string; seat?: Seat })
  | (ActionEnvelope & { type: "CHOOSE_CAPTURE"; cardId: string; captureIds: string[]; seat?: Seat })
  | (ActionEnvelope & { type: "REQUEST_NEXT_ROUND"; mode: OnlineMode })
  | (ActionEnvelope & { type: "REQUEST_REMATCH"; mode: OnlineMode })
  | (SessionEnvelope & { type: "SYNC_REQUEST"; playerToken: string; lastKnownStateVersion: number })
  | (Envelope & { type: "PING"; timestamp: number });

export type ServerMessage =
  | (SessionEnvelope & { type: "WELCOME"; playerToken: string; role: "guest"; stateVersion: number; view: Online1v1View | Online2v2View })
  | (SessionEnvelope & { type: "STATE_SNAPSHOT"; stateVersion: number; view: Online1v1View | Online2v2View })
  | (Envelope & { type: "ACTION_REJECTED"; reasonCode: RejectReason; actionId?: string; message?: string })
  | (Envelope & { type: "ROOM_FULL" })
  | (Envelope & { type: "VERSION_MISMATCH"; expectedVersion: number })
  | (SessionEnvelope & { type: "REJOIN_ACCEPTED"; playerToken: string; stateVersion: number; view: Online1v1View | Online2v2View })
  | (Envelope & { type: "REJOIN_REJECTED"; reasonCode: RejectReason })
  | (Envelope & { type: "PONG"; timestamp: number });

export type OnlineMessage = ClientMessage | ServerMessage;

export function createSecureId(bytes = 16): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createActionId(): string {
  return createSecureId(12);
}
