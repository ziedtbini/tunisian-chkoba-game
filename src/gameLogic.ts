import { Card, Suit, Player, Score, GameState, GameMode } from './types';

const SUITS: Suit[] = ['pique', 'coeur', 'carreau', 'trefle'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const SUIT_SYMBOLS: Record<Suit, string> = {
  pique: '♠',
  coeur: '♥',
  carreau: '♦',
  trefle: '♣',
};

export const SUIT_NAMES: Record<Suit, string> = {
  pique: 'Pique',
  coeur: 'Cœur',
  carreau: 'Carreau',
  trefle: 'Trèfle',
};

export function cardValue(card: Card): number {
  return card.rank;
}

export function rankLabel(rank: number): string {
  switch (rank) {
    case 1: return 'A';
    case 8: return 'D';
    case 9: return 'V';
    case 10: return 'R';
    default: return String(rank);
  }
}

export function rankFullName(rank: number): string {
  switch (rank) {
    case 1: return 'As';
    case 8: return 'Dame';
    case 9: return 'Valet';
    case 10: return 'Roi';
    default: return String(rank);
  }
}

export function cardName(card: Card): string {
  return `${rankFullName(card.rank)} de ${SUIT_NAMES[card.suit]} ${SUIT_SYMBOLS[card.suit]}`;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${suit}-${rank}` });
    }
  }
  return shuffleDeck(deck);
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[], count: number): { dealt: Card[]; remaining: Card[] } {
  return {
    dealt: deck.slice(0, count),
    remaining: deck.slice(count),
  };
}

// Find all possible capture combinations for a given card
export function findCaptures(card: Card, tableCards: Card[]): Card[][] {
  const targetValue = cardValue(card);
  const exactMatches: Card[][] = [];

  // Rule: if an exact-value card exists on table, player must take exact match.
  for (const tc of tableCards) {
    if (cardValue(tc) === targetValue) exactMatches.push([tc]);
  }
  if (exactMatches.length > 0) return exactMatches;

  const results: Card[][] = [];
  // No exact match available: allow sum combinations.
  if (targetValue > 1) findCombinations(tableCards, targetValue, [], 0, results);

  // Deduplicate
  const filtered: Card[][] = [];
  const seen = new Set<string>();
  for (const combo of results) {
    const key = combo.map(c => c.id).sort().join(',');
    if (!seen.has(key)) {
      seen.add(key);
      filtered.push(combo);
    }
  }

  return filtered;
}

function findCombinations(
  cards: Card[],
  target: number,
  current: Card[],
  startIndex: number,
  results: Card[][]
) {
  const sum = current.reduce((s, c) => s + cardValue(c), 0);

  if (current.length >= 2 && sum === target) {
    results.push([...current]);
  }

  if (sum >= target) return;

  for (let i = startIndex; i < cards.length; i++) {
    current.push(cards[i]);
    findCombinations(cards, target, current, i + 1, results);
    current.pop();
  }
}

export function calculateScore(player: Player): Score {
  const cards = player.captured.length;
  const carreaux = player.captured.filter(c => c.suit === 'carreau').length;
  const septCarreau = player.captured.some(c => c.suit === 'carreau' && c.rank === 7) ? 1 : 0;
  const sevens = player.captured.filter(c => c.rank === 7).length;
  const bermila = sevens >= 3 ? 1 : 0;

  return {
    cards,
    carreaux,
    septCarreau,
    bermila,
    chkobas: player.chkobas,
    total: 0,
  };
}

export function computeRoundScores(p1: Player, p2: Player): { score1: Score; score2: Score } {
  const ps = calculateScore(p1);
  const cs = calculateScore(p2);

  let pTotal = 0;
  let cTotal = 0;

  // Cards: who has more
  if (ps.cards > cs.cards) pTotal += 1;
  else if (cs.cards > ps.cards) cTotal += 1;

  // Carreaux: who has more
  if (ps.carreaux > cs.carreaux) pTotal += 1;
  else if (cs.carreaux > ps.carreaux) cTotal += 1;

  // 7 of carreau
  pTotal += ps.septCarreau;
  cTotal += cs.septCarreau;

  // Bermila (most 7s, 3+)
  const pSevens = p1.captured.filter(c => c.rank === 7).length;
  const cSevens = p2.captured.filter(c => c.rank === 7).length;
  if (pSevens >= 3 && pSevens > cSevens) pTotal += 1;
  else if (cSevens >= 3 && cSevens > pSevens) cTotal += 1;

  // Chkobas
  pTotal += ps.chkobas;
  cTotal += cs.chkobas;

  ps.total = pTotal;
  cs.total = cTotal;

  return { score1: ps, score2: cs };
}

// AI: Choose best card and capture
export function computerPlay(hand: Card[], tableCards: Card[]): { card: Card; capture: Card[] | null } {
  let bestCard: Card = hand[0];
  let bestCapture: Card[] | null = null;
  let bestScore = -Infinity;

  for (const card of hand) {
    const captures = findCaptures(card, tableCards);

    if (captures.length === 0) {
      // No capture possible - evaluate how safe it is to drop
      let dropScore = 0;
      if (card.suit !== 'carreau') dropScore += 2;
      if (card.rank !== 7) dropScore += 2;
      if (card.rank <= 3) dropScore += 1;

      if (bestCapture === null && dropScore > bestScore) {
        bestScore = dropScore;
        bestCard = card;
        bestCapture = null;
      }
      continue;
    }

    for (const capture of captures) {
      let score = 10;
      const allCaptured = [...capture, card];

      score += capture.length * 2;
      score += allCaptured.filter(c => c.suit === 'carreau').length * 3;
      if (allCaptured.some(c => c.suit === 'carreau' && c.rank === 7)) score += 15;
      score += allCaptured.filter(c => c.rank === 7).length * 5;

      // Chkoba bonus
      const remainingTable = tableCards.filter(tc => !capture.some(cc => cc.id === tc.id));
      if (remainingTable.length === 0) score += 20;

      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
        bestCapture = capture;
      }
    }
  }

  return { card: bestCard, capture: bestCapture };
}

export function initializeRound(
  p1Score: number,
  p2Score: number,
  targetScore: number,
  mode: GameMode
): GameState {
  const deck = createDeck();

  const { dealt: p1Hand, remaining: deck1 } = dealCards(deck, 3);
  const { dealt: p2Hand, remaining: deck2 } = dealCards(deck1, 3);
  const { dealt: tableCards, remaining: deck3 } = dealCards(deck2, 4);

  const p2Name = mode === 'vs-cpu' ? 'Ordinateur' : 'Joueur 2';

  return {
    phase: 'playing',
    mode,
    deck: deck3,
    table: tableCards,
    player1: { name: 'Joueur 1', hand: p1Hand, captured: [], chkobas: 0 },
    player2: { name: p2Name, hand: p2Hand, captured: [], chkobas: 0 },
    currentTurn: 'player1',
    lastCapture: null,
    player1Score: p1Score,
    player2Score: p2Score,
    roundScorePlayer1: null,
    roundScorePlayer2: null,
    targetScore,
    message: mode === 'vs-cpu' ? 'Votre tour ! Sélectionnez une carte.' : 'Joueur 1, sélectionnez une carte.',
    selectedCard: null,
    possibleCaptures: null,
    lastAction: '',
    showChkoba: null,
  };
}
