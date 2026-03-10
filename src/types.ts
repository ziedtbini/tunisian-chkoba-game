export type Suit = 'pique' | 'coeur' | 'carreau' | 'trefle';

export interface Card {
  suit: Suit;
  rank: number; // 1-10 (1=As, 2-7, 8=Dame, 9=Valet, 10=Roi)
  id: string;
}

export interface Player {
  name: string;
  hand: Card[];
  captured: Card[];
  chkobas: number;
}

export type GamePhase = 'menu' | 'playing' | 'turnTransition' | 'roundEnd' | 'gameOver';
export type GameMode = 'vs-cpu' | 'vs-player' | 'online';
export type PlayerSide = 'player1' | 'player2';

export interface Score {
  cards: number;
  carreaux: number;
  septCarreau: number;
  bermila: number;
  chkobas: number;
  total: number;
}

export interface GameState {
  phase: GamePhase;
  mode: GameMode;
  deck: Card[];
  table: Card[];
  player1: Player;
  player2: Player;
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
}

// Online-specific types
export type OnlinePhase = 'idle' | 'creating' | 'waiting' | 'joining' | 'connected' | 'disconnected' | 'error';

export interface OnlineMessage {
  type: 'game-state' | 'play-card' | 'capture-choice' | 'next-round' | 'play-again' | 'ping' | 'pong' | 'player-name' | 'sync-request' | '2v2-state' | '2v2-play' | '2v2-sync' | '2v2-player-name';
  payload?: any;
}
