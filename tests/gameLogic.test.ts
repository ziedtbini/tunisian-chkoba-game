import { describe, expect, test } from "vitest";
import { calculateScore, computeRoundScores, createDeck, dealCards, findCaptures } from "../src/gameLogic.ts";
import type { Card, Player } from "../src/types.ts";

const card = (rank: number, suit: Card["suit"] = "pique"): Card => ({
  rank,
  suit,
  id: `${suit}-${rank}`,
});

const player = (captured: Card[], chkobas = 0): Player => ({
  name: "Test",
  hand: [],
  captured,
  chkobas,
});

describe("Chkoba game logic", () => {
  test("a deck contains 40 unique Tunisian cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((item) => item.id)).size).toBe(40);
  });

  test("dealCards does not mutate or lose cards", () => {
    const deck = createDeck();
    const { dealt, remaining } = dealCards(deck, 3);
    expect(dealt).toHaveLength(3);
    expect(remaining).toHaveLength(37);
    expect([...dealt, ...remaining]).toEqual(deck);
  });

  test("an exact rank capture takes priority over sum combinations", () => {
    const exact = card(7, "coeur");
    const captures = findCaptures(card(7, "pique"), [exact, card(3), card(4, "trefle")]);
    expect(captures).toEqual([[exact]]);
  });

  test("sum captures are found and deduplicated when no exact rank exists", () => {
    const three = card(3);
    const four = card(4, "coeur");
    const two = card(2, "trefle");
    const five = card(5, "carreau");
    const captures = findCaptures(card(7), [three, four, two, five]);
    expect(captures.map((combo) => combo.map((item) => item.id).sort()).sort()).toEqual(
      [[four.id, three.id].sort(), [five.id, two.id].sort()].sort(),
    );
  });

  test("score counts diamonds, seven of diamonds, bermila and chkobas", () => {
    const captured = [card(7, "carreau"), card(7, "coeur"), card(7, "pique"), card(2, "carreau")];
    expect(calculateScore(player(captured, 2))).toEqual({
      cards: 4,
      carreaux: 2,
      septCarreau: 1,
      bermila: 1,
      chkobas: 2,
      total: 0,
    });
  });

  test("round totals award category majorities without points on ties", () => {
    const p1 = player([card(7, "carreau"), card(7, "coeur"), card(7, "pique"), card(2, "carreau")], 1);
    const p2 = player([card(2), card(3), card(4)], 0);
    const { score1, score2 } = computeRoundScores(p1, p2);
    expect(score1.total).toBe(5);
    expect(score2.total).toBe(0);
  });
});
