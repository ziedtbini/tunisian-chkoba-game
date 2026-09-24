import type { GameState, PlayerSide } from "../types";
import type { Online1v1View, Online2v2View, Seat, Team } from "./protocol";

export type Authoritative2v2State = {
  phase: "playing" | "roundEnd" | "gameOver";
  table: GameState["table"];
  deck: GameState["deck"];
  hands: Record<Seat, GameState["deck"]>;
  seatNames: Record<Seat, string>;
  currentTurn: Seat;
  lastCaptureTeam: Team | null;
  teamA: Online2v2View["teamA"];
  teamB: Online2v2View["teamB"];
  targetScore: number;
  message: string;
};

export function create1v1View(state: GameState, recipient: PlayerSide): Online1v1View {
  const mine = state[recipient];
  const includeChoices = state.currentTurn === recipient;
  return {
    mode: "1v1",
    phase: state.phase,
    table: state.table,
    mySide: recipient,
    myHand: mine.hand,
    player1: { name: state.player1.name, handCount: state.player1.hand.length, captured: state.player1.captured, chkobas: state.player1.chkobas },
    player2: { name: state.player2.name, handCount: state.player2.hand.length, captured: state.player2.captured, chkobas: state.player2.chkobas },
    deckCount: state.deck.length,
    currentTurn: state.currentTurn,
    lastCapture: state.lastCapture,
    player1Score: state.player1Score,
    player2Score: state.player2Score,
    roundScorePlayer1: state.roundScorePlayer1,
    roundScorePlayer2: state.roundScorePlayer2,
    targetScore: state.targetScore,
    message: state.message,
    selectedCard: includeChoices ? state.selectedCard : null,
    possibleCaptures: includeChoices ? state.possibleCaptures : null,
    lastAction: state.lastAction,
    showChkoba: state.showChkoba,
  };
}

export function create2v2View(state: Authoritative2v2State, recipient: Team): Online2v2View {
  const seats: Seat[] = recipient === "A" ? ["p1", "p3"] : ["p2", "p4"];
  const myHands: Partial<Record<Seat, GameState["deck"]>> = {};
  for (const seat of seats) myHands[seat] = state.hands[seat];
  return {
    mode: "2v2",
    phase: state.phase,
    table: state.table,
    myTeam: recipient,
    myHands,
    handCounts: {
      p1: state.hands.p1.length,
      p2: state.hands.p2.length,
      p3: state.hands.p3.length,
      p4: state.hands.p4.length,
    },
    seatNames: state.seatNames,
    deckCount: state.deck.length,
    currentTurn: state.currentTurn,
    lastCaptureTeam: state.lastCaptureTeam,
    teamA: state.teamA,
    teamB: state.teamB,
    targetScore: state.targetScore,
    message: state.message,
  };
}

export function shouldAcceptSnapshot(currentVersion: number, incomingVersion: number): boolean {
  return Number.isSafeInteger(incomingVersion) && incomingVersion > currentVersion;
}
