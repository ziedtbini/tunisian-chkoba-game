import { cardName, findCaptures } from "../gameLogic";
import type { Card, GameState, PlayerSide } from "../types";
import type { RejectReason, Seat, Team } from "./protocol";
import type { Authoritative2v2State } from "./stateView";
import { sameIdSet } from "./validation";

export type AuthorityResult<T> = { ok: true; state: T } | { ok: false; reason: RejectReason };

function otherSide(side: PlayerSide): PlayerSide { return side === "player1" ? "player2" : "player1"; }

function capture(state: GameState, played: Card, cards: Card[], who: PlayerSide): GameState {
  const actor = state[who];
  const table = state.table.filter((item) => !cards.some((captured) => captured.id === item.id));
  const chkoba = table.length === 0;
  return {
    ...state,
    [who]: {
      ...actor,
      hand: actor.hand.filter((item) => item.id !== played.id),
      captured: [...actor.captured, played, ...cards],
      chkobas: actor.chkobas + (chkoba ? 1 : 0),
    },
    table,
    currentTurn: otherSide(who),
    lastCapture: who,
    selectedCard: null,
    possibleCaptures: null,
    message: chkoba ? `${actor.name} fait CHKOBA !` : `${actor.name} capture ${cards.length + 1} cartes.`,
    lastAction: chkoba ? "chkoba" : "capture",
    showChkoba: chkoba ? who : null,
  };
}

export function apply1v1Play(state: GameState, who: PlayerSide, cardId: string): AuthorityResult<GameState> {
  if (state.phase !== "playing") return { ok: false, reason: "INVALID_PHASE" };
  if (state.currentTurn !== who) return { ok: false, reason: "NOT_YOUR_TURN" };
  const actor = state[who];
  const card = actor.hand.find((item) => item.id === cardId);
  if (!card) return { ok: false, reason: "CARD_NOT_FOUND" };
  const legal = findCaptures(card, state.table);
  if (legal.length === 0) {
    return { ok: true, state: {
      ...state,
      [who]: { ...actor, hand: actor.hand.filter((item) => item.id !== card.id) },
      table: [...state.table, card],
      currentTurn: otherSide(who),
      selectedCard: null,
      possibleCaptures: null,
      message: `${actor.name} a posé ${cardName(card)} sur la table.`,
      lastAction: "drop",
      showChkoba: null,
    } };
  }
  if (legal.length === 1) return { ok: true, state: capture(state, card, legal[0], who) };
  return { ok: true, state: { ...state, selectedCard: card, possibleCaptures: legal, message: `${actor.name} choisit les cartes à capturer...` } };
}

export function apply1v1Capture(state: GameState, who: PlayerSide, cardId: string, captureIds: string[]): AuthorityResult<GameState> {
  if (state.phase !== "playing") return { ok: false, reason: "INVALID_PHASE" };
  if (state.currentTurn !== who) return { ok: false, reason: "NOT_YOUR_TURN" };
  const card = state[who].hand.find((item) => item.id === cardId);
  if (!card || state.selectedCard?.id !== cardId) return { ok: false, reason: "CARD_NOT_FOUND" };
  const legal = findCaptures(card, state.table);
  const selected = legal.find((group) => sameIdSet(captureIds, group.map((item) => item.id)));
  if (!selected) return { ok: false, reason: "INVALID_CAPTURE" };
  return { ok: true, state: capture(state, card, selected, who) };
}

export class ActionDeduplicator {
  private readonly entries = new Map<string, number>();
  constructor(private readonly limit = 128) {}
  has(id: string): boolean { return this.entries.has(id); }
  add(id: string): void {
    this.entries.set(id, Date.now());
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
  }
  clear(): void { this.entries.clear(); }
}

const TURN_ORDER: Seat[] = ["p1", "p2", "p3", "p4"];
const TEAM_OF: Record<Seat, Team> = { p1: "A", p2: "B", p3: "A", p4: "B" };

function next2v2Seat(hands: Authoritative2v2State["hands"], from: Seat): Seat {
  let index = TURN_ORDER.indexOf(from);
  for (let attempt = 0; attempt < TURN_ORDER.length; attempt += 1) {
    index = (index + 1) % TURN_ORDER.length;
    if (hands[TURN_ORDER[index]].length > 0) return TURN_ORDER[index];
  }
  return from;
}

export function apply2v2Action(
  state: Authoritative2v2State,
  actorTeam: Team,
  seat: Seat,
  cardId: string,
  captureIds: string[] | null,
): AuthorityResult<Authoritative2v2State> {
  if (state.phase !== "playing") return { ok: false, reason: "INVALID_PHASE" };
  if (TEAM_OF[seat] !== actorTeam) return { ok: false, reason: "INVALID_MATCH" };
  if (state.currentTurn !== seat) return { ok: false, reason: "NOT_YOUR_TURN" };
  const card = state.hands[seat].find((candidate) => candidate.id === cardId);
  if (!card) return { ok: false, reason: "CARD_NOT_FOUND" };

  const legal = findCaptures(card, state.table);
  let selected: Card[] | null = null;
  if (legal.length === 0) {
    if (captureIds && captureIds.length > 0) return { ok: false, reason: "INVALID_CAPTURE" };
  } else if (captureIds) {
    selected = legal.find((group) => sameIdSet(captureIds, group.map((item) => item.id))) ?? null;
    if (!selected) return { ok: false, reason: "INVALID_CAPTURE" };
  } else if (legal.length === 1) {
    selected = legal[0];
  } else {
    return { ok: false, reason: "INVALID_CAPTURE" };
  }

  const hands = { ...state.hands, [seat]: state.hands[seat].filter((candidate) => candidate.id !== card.id) };
  const currentTurn = next2v2Seat(hands, seat);
  if (!selected) {
    return { ok: true, state: {
      ...state,
      hands,
      table: [...state.table, card],
      currentTurn,
      message: `${seat.toUpperCase()} pose ${cardName(card)}.`,
    } };
  }

  const table = state.table.filter((tableCard) => !selected.some((captured) => captured.id === tableCard.id));
  const isChkoba = table.length === 0;
  const teamKey = actorTeam === "A" ? "teamA" : "teamB";
  return { ok: true, state: {
    ...state,
    hands,
    table,
    currentTurn,
    lastCaptureTeam: actorTeam,
    [teamKey]: {
      ...state[teamKey],
      captured: [...state[teamKey].captured, card, ...selected],
      chkobas: state[teamKey].chkobas + (isChkoba ? 1 : 0),
    },
    message: isChkoba ? `${seat.toUpperCase()} fait CHKOBA!` : `${seat.toUpperCase()} capture ${selected.length + 1} cartes.`,
  } };
}
