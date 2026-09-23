import { useEffect, useMemo, useRef, useState } from "react";
import { CardComponent, CardBack } from "./CardComponent";
import { cardName, createDeck, dealCards, findCaptures } from "./gameLogic";
import { Card, OnlineMessage } from "./types";
import { onlineManager, ROOM_CODE_LENGTH } from "./onlineManager";
import { feedback, setupAudioUnlock } from "./utils/premiumFx";
import QuitConfirmModal from "./components/QuitConfirmModal";
import NotEnoughCoinsModal from "./components/NotEnoughCoinsModal";

type Team = "A" | "B";
type Seat = "p1" | "p2" | "p3" | "p4";
type OnlinePhase = "idle" | "creating" | "waiting" | "joining" | "connected" | "disconnected" | "error";
type TwoVsTwoMode = "local" | "online";
type ScoreTarget = 11 | 21;
type PlayPayload = { seat: Seat; cardId: string; captureIds?: string[] };

type TeamInfo = {
  captured: Card[];
  chkobas: number;
  score: number;
  roundPoints: number;
};

type Game2v2 = {
  phase: "playing" | "roundEnd" | "gameOver";
  mode: TwoVsTwoMode;
  deck: Card[];
  table: Card[];
  hands: Record<Seat, Card[]>;
  seatNames: Record<Seat, string>;
  currentTurn: Seat;
  lastCaptureTeam: Team | null;
  teamA: TeamInfo;
  teamB: TeamInfo;
  targetScore: number;
  message: string;
};

type PendingChoice = {
  seat: Seat;
  card: Card;
  options: Card[][];
};

const TURN_ORDER: Seat[] = ["p1", "p2", "p3", "p4"];
const TEAM_OF: Record<Seat, Team> = { p1: "A", p2: "B", p3: "A", p4: "B" };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isSeat(value: unknown): value is Seat {
  return value === "p1" || value === "p2" || value === "p3" || value === "p4";
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parsePlayPayload(value: unknown): PlayPayload | null {
  if (!isObject(value)) return null;
  if (!isSeat(value.seat)) return null;
  if (typeof value.cardId !== "string") return null;
  if (value.captureIds !== undefined) {
    if (!Array.isArray(value.captureIds)) return null;
    if (!value.captureIds.every((v) => typeof v === "string")) return null;
  }
  return {
    seat: value.seat,
    cardId: value.cardId,
    captureIds: value.captureIds as string[] | undefined,
  };
}

function nextSeat(seat: Seat): Seat {
  const idx = TURN_ORDER.indexOf(seat);
  return TURN_ORDER[(idx + 1) % TURN_ORDER.length];
}

function nextSeatWithCards(hands: Record<Seat, Card[]>, from: Seat): Seat {
  let s = from;
  for (let i = 0; i < TURN_ORDER.length; i++) {
    s = nextSeat(s);
    if (hands[s].length > 0) return s;
  }
  return from;
}

function initialize2v2(mode: TwoVsTwoMode, teamAScore = 0, teamBScore = 0, targetScore: ScoreTarget = 11): Game2v2 {
  const deck = createDeck();
  const d1 = dealCards(deck, 3);
  const d2 = dealCards(d1.remaining, 3);
  const d3 = dealCards(d2.remaining, 3);
  const d4 = dealCards(d3.remaining, 3);
  const table = dealCards(d4.remaining, 4);

  return {
    phase: "playing",
    mode,
    deck: table.remaining,
    table: table.dealt,
    hands: {
      p1: d1.dealt,
      p2: d2.dealt,
      p3: d3.dealt,
      p4: d4.dealt,
    },
    seatNames: {
      p1: "Joueur 1",
      p2: "Joueur 2",
      p3: "Joueur 3",
      p4: "Joueur 4",
    },
    currentTurn: "p1",
    lastCaptureTeam: null,
    teamA: { captured: [], chkobas: 0, score: teamAScore, roundPoints: 0 },
    teamB: { captured: [], chkobas: 0, score: teamBScore, roundPoints: 0 },
    targetScore,
    message: "Tour de Joueur 1 (Equipe A)",
  };
}

function teamRoundStats(cards: Card[], chkobas: number) {
  const cardsCount = cards.length;
  const carreaux = cards.filter((c) => c.suit === "carreau").length;
  const septCarreau = cards.some((c) => c.suit === "carreau" && c.rank === 7) ? 1 : 0;
  const sevens = cards.filter((c) => c.rank === 7).length;
  const bermila = sevens >= 3 ? 1 : 0;
  return { cardsCount, carreaux, septCarreau, sevens, bermila, chkobas };
}

function computeRoundPoints(teamA: TeamInfo, teamB: TeamInfo) {
  const a = teamRoundStats(teamA.captured, teamA.chkobas);
  const b = teamRoundStats(teamB.captured, teamB.chkobas);
  let pa = 0;
  let pb = 0;
  if (a.cardsCount > b.cardsCount) pa += 1;
  else if (b.cardsCount > a.cardsCount) pb += 1;
  if (a.carreaux > b.carreaux) pa += 1;
  else if (b.carreaux > a.carreaux) pb += 1;
  pa += a.septCarreau;
  pb += b.septCarreau;
  if (a.sevens >= 3 && a.sevens > b.sevens) pa += 1;
  else if (b.sevens >= 3 && b.sevens > a.sevens) pb += 1;
  pa += a.chkobas;
  pb += b.chkobas;
  return { pa, pb };
}

function applyPlay(state: Game2v2, seat: Seat, cardId: string, captureIds?: string[]): Game2v2 {
  if (state.phase !== "playing" || state.currentTurn !== seat) return state;
  const hand = state.hands[seat];
  const card = hand.find((c) => c.id === cardId);
  if (!card) return state;

  const captures = findCaptures(card, state.table);
  const team = TEAM_OF[seat];
  const teamKey = team === "A" ? "teamA" : "teamB";
  const next = nextSeatWithCards(
    { ...state.hands, [seat]: hand.filter((c) => c.id !== card.id) },
    seat
  );

  if (captures.length === 0) {
    return {
      ...state,
      hands: { ...state.hands, [seat]: hand.filter((c) => c.id !== card.id) },
      table: [...state.table, card],
      currentTurn: next,
      message: `${seat.toUpperCase()} pose ${cardName(card)}.`,
    };
  }

  let chosen = captures[0];
  if (captureIds && captureIds.length > 0) {
    const wanted = captures.find((g) => g.length === captureIds.length && g.every((c) => captureIds.includes(c.id)));
    if (wanted) chosen = wanted;
  }

  const newTable = state.table.filter((tc) => !chosen.some((cc) => cc.id === tc.id));
  const isChkoba = newTable.length === 0;
  const oldTeam = state[teamKey];
  const newTeam: TeamInfo = {
    ...oldTeam,
    captured: [...oldTeam.captured, card, ...chosen],
    chkobas: oldTeam.chkobas + (isChkoba ? 1 : 0),
  };

  return {
    ...state,
    hands: { ...state.hands, [seat]: hand.filter((c) => c.id !== card.id) },
    table: newTable,
    currentTurn: next,
    lastCaptureTeam: team,
    [teamKey]: newTeam,
    message: isChkoba ? `${seat.toUpperCase()} fait CHKOBA!` : `${seat.toUpperCase()} capture ${chosen.length + 1} cartes.`,
  };
}

type Props = {
  initialMode: TwoVsTwoMode;
  initialTargetScore?: ScoreTarget;
  availableMatches: number;
  onConsumeMatchEntry: () => void;
  onAddMatchEntry: () => void;
  rewardedAdOpen: boolean;
  matchEntryToast: string | null;
  matchEntryError: string | null;
  onExit: () => void;
};

export default function Chkoba2v2({
  initialMode,
  initialTargetScore = 11,
  availableMatches,
  onConsumeMatchEntry,
  onAddMatchEntry,
  rewardedAdOpen,
  matchEntryToast,
  matchEntryError,
  onExit,
}: Props) {
  const [mode] = useState<TwoVsTwoMode>(initialMode);
  const [game, setGame] = useState<Game2v2>(() => initialize2v2(initialMode, 0, 0, initialTargetScore));
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>(initialMode === "online" ? "idle" : "connected");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [onlineError, setOnlineError] = useState("");
  const prevMsgRef = useRef("");
  const gameRef = useRef<Game2v2>(game);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [targetScore, setTargetScore] = useState<ScoreTarget>(initialTargetScore);
  const [showCreateScorePicker, setShowCreateScorePicker] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [showNotEnoughMatches, setShowNotEnoughMatches] = useState(false);
  const [consumeMatchOnConnect, setConsumeMatchOnConnect] = useState(false);

  const myTeam: Team = useMemo(() => (onlineManager.isHost ? "A" : "B"), [onlinePhase]);
  const oppTeam: Team = myTeam === "A" ? "B" : "A";
  const controllableSeats: Seat[] = mode === "online" ? (myTeam === "A" ? ["p1", "p3"] : ["p2", "p4"]) : TURN_ORDER;
  const remoteSeatsForHost: Seat[] = ["p2", "p4"];

  useEffect(() => {
    setupAudioUnlock();
  }, []);

  useEffect(() => {
    if (game.phase === "gameOver") {
      feedback("victory");
      return;
    }
    if (game.phase === "roundEnd") {
      feedback("roundEnd");
      return;
    }
    if (game.message === prevMsgRef.current) return;
    prevMsgRef.current = game.message;
    if (game.message.includes("CHKOBA")) feedback("chkoba");
    else if (game.message.includes("capture")) feedback("capture");
    else if (game.message.includes("pose")) feedback("card");
  }, [game.phase, game.message]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    if (mode !== "online") return;
    const onMessage = (msg: OnlineMessage) => {
      if (msg.type === "2v2-state") {
        if (!isObject(msg.payload)) return;
        setGame(msg.payload as Game2v2);
        setPending(null);
      } else if (msg.type === "2v2-player-name") {
        const name = isObject(msg.payload) ? readString(msg.payload.name) : null;
        if (!name) return;
        setGame((prev) => {
          const updated: Game2v2 = onlineManager.isHost
            ? { ...prev, seatNames: { ...prev.seatNames, p2: name, p4: name } }
            : { ...prev, seatNames: { ...prev.seatNames, p1: name, p3: name } };
          if (onlineManager.isHost) {
            onlineManager.send({ type: "2v2-state", payload: updated });
          }
          return updated;
        });
      } else if (msg.type === "2v2-sync" && onlineManager.isHost) {
        onlineManager.send({ type: "2v2-state", payload: gameRef.current });
      } else if (msg.type === "2v2-play" && onlineManager.isHost) {
        const parsed = parsePlayPayload(msg.payload);
        if (!parsed) return;
        const { seat, cardId, captureIds } = parsed;
        if (!remoteSeatsForHost.includes(seat)) return;
        setGame((prev) => {
          const next = applyPlay(prev, seat, cardId, captureIds);
          onlineManager.send({ type: "2v2-state", payload: next });
          return next;
        });
      }
    };
    onlineManager.setCallbacks({
      onMessage,
      onConnected: () => {
        setOnlinePhase("connected");
        setOnlineError("");
        if (consumeMatchOnConnect) {
          onConsumeMatchEntry();
          setConsumeMatchOnConnect(false);
        }
        const resolvedName = playerName.trim() || (onlineManager.isHost ? "Joueur 1" : "Joueur 2");
        onlineManager.send({ type: "2v2-player-name", payload: { name: resolvedName } });
        if (onlineManager.isHost) {
          const start = initialize2v2("online", 0, 0, targetScore);
          start.seatNames.p1 = resolvedName;
          start.seatNames.p3 = resolvedName;
          setGame(start);
          onlineManager.send({ type: "2v2-state", payload: start });
        } else {
          onlineManager.send({ type: "2v2-sync" });
        }
      },
      onDisconnected: () => setOnlinePhase("disconnected"),
      onError: (err) => {
        setOnlineError(err);
        setOnlinePhase("error");
        setConsumeMatchOnConnect(false);
      },
    });
  }, [mode, targetScore, playerName, consumeMatchOnConnect, onConsumeMatchEntry]);

  useEffect(() => {
    if (game.phase !== "playing") return;
    const everyoneEmpty = TURN_ORDER.every((s) => game.hands[s].length === 0);
    if (everyoneEmpty && game.deck.length > 0) {
      setGame((prev) => {
        const d1 = dealCards(prev.deck, 3);
        const d2 = dealCards(d1.remaining, 3);
        const d3 = dealCards(d2.remaining, 3);
        const d4 = dealCards(d3.remaining, 3);
        const nextState: Game2v2 = {
          ...prev,
          deck: d4.remaining,
          hands: { p1: d1.dealt, p2: d2.dealt, p3: d3.dealt, p4: d4.dealt },
          currentTurn: "p1",
          message: "Nouvelles cartes distribuees",
        };
        if (mode === "online" && onlineManager.isHost) onlineManager.send({ type: "2v2-state", payload: nextState });
        return nextState;
      });
      return;
    }
    if (everyoneEmpty && game.deck.length === 0) {
      setGame((prev) => {
        const tA = { ...prev.teamA };
        const tB = { ...prev.teamB };
        if (prev.table.length > 0 && prev.lastCaptureTeam) {
          if (prev.lastCaptureTeam === "A") tA.captured = [...tA.captured, ...prev.table];
          else tB.captured = [...tB.captured, ...prev.table];
        }
        const { pa, pb } = computeRoundPoints(tA, tB);
        tA.roundPoints = pa;
        tB.roundPoints = pb;
        tA.score += pa;
        tB.score += pb;
        const over = tA.score >= prev.targetScore || tB.score >= prev.targetScore;
        const nextState: Game2v2 = {
          ...prev,
          phase: over ? "gameOver" : "roundEnd",
          table: [],
          teamA: tA,
          teamB: tB,
          message: over ? (tA.score >= prev.targetScore ? "Equipe A gagne!" : "Equipe B gagne!") : "Fin du round 2v2",
        };
        if (mode === "online" && onlineManager.isHost) onlineManager.send({ type: "2v2-state", payload: nextState });
        return nextState;
      });
    }
  }, [game, mode]);

  const onPlay = (seat: Seat, card: Card) => {
    if (game.phase !== "playing" || game.currentTurn !== seat) return;
    if (!controllableSeats.includes(seat)) return;
    const options = findCaptures(card, game.table);
    if (options.length > 1) {
      setPending({ seat, card, options });
      return;
    }
    const captureIds = options[0]?.map((c) => c.id) ?? [];
    if (mode === "online" && !onlineManager.isHost) {
      onlineManager.send({ type: "2v2-play", payload: { seat, cardId: card.id, captureIds } });
      return;
    }
    setGame((prev) => {
      const next = applyPlay(prev, seat, card.id, captureIds);
      if (mode === "online" && onlineManager.isHost) onlineManager.send({ type: "2v2-state", payload: next });
      return next;
    });
  };

  const chooseCapture = (group: Card[]) => {
    if (!pending) return;
    if (game.phase !== "playing" || game.currentTurn !== pending.seat) return;
    if (!controllableSeats.includes(pending.seat)) return;
    const captureIds = group.map((c) => c.id);
    if (mode === "online" && !onlineManager.isHost) {
      onlineManager.send({ type: "2v2-play", payload: { seat: pending.seat, cardId: pending.card.id, captureIds } });
      setPending(null);
      return;
    }
    setGame((prev) => {
      const next = applyPlay(prev, pending.seat, pending.card.id, captureIds);
      if (mode === "online" && onlineManager.isHost) onlineManager.send({ type: "2v2-state", payload: next });
      return next;
    });
    setPending(null);
  };

  const startNextRound = () => {
    const next = initialize2v2(mode, game.teamA.score, game.teamB.score, game.targetScore as ScoreTarget);
    setPending(null);
    setGame(next);
    if (mode === "online" && onlineManager.isHost) onlineManager.send({ type: "2v2-state", payload: next });
    if (mode === "online" && !onlineManager.isHost) onlineManager.send({ type: "2v2-sync" });
  };

  const playAgain = () => {
    const next = initialize2v2(mode, 0, 0, game.targetScore as ScoreTarget);
    setPending(null);
    setGame(next);
    if (mode === "online" && onlineManager.isHost) onlineManager.send({ type: "2v2-state", payload: next });
    if (mode === "online" && !onlineManager.isHost) onlineManager.send({ type: "2v2-sync" });
  };

  const createRoom = async (chosenTargetScore: ScoreTarget) => {
    if (availableMatches < 1) {
      setShowNotEnoughMatches(true);
      return;
    }
    setTargetScore(chosenTargetScore);
    setOnlineError("");
    setOnlinePhase("creating");
    setConsumeMatchOnConnect(true);
    try {
      const code = await onlineManager.createRoom();
      setRoomCode(code);
      setOnlinePhase("waiting");
    } catch {
      setOnlinePhase("error");
      setConsumeMatchOnConnect(false);
    }
  };

  const requestQuit = () => {
    feedback("button");
    setShowQuitConfirm(true);
  };

  const confirmQuit = () => {
    setShowQuitConfirm(false);
    if (mode === "online") onlineManager.destroy();
    setConsumeMatchOnConnect(false);
    onExit();
  };

  const joinRoom = async () => {
    if (availableMatches < 1) {
      setShowNotEnoughMatches(true);
      return;
    }
    const code = onlineManager.normalizeRoomCode(joinCode);
    if (code.length !== ROOM_CODE_LENGTH) {
      setOnlineError(`Code room ${ROOM_CODE_LENGTH} caracteres`);
      return;
    }
    setOnlineError("");
    setOnlinePhase("joining");
    setConsumeMatchOnConnect(true);
    try {
      await onlineManager.joinRoom(code);
    } catch {
      setOnlinePhase("error");
      setConsumeMatchOnConnect(false);
    }
  };

  if (mode === "online" && onlinePhase !== "connected") {
    return (
      <div className="premium-screen premium-scroll safe-area min-h-screen flex flex-col items-center justify-center text-white p-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🌐</div>
          <h1 className="text-4xl font-black bg-gradient-to-r from-emerald-300 to-teal-400 bg-clip-text text-transparent mb-1">
            Jeu en Ligne 2v2
          </h1>
          <p className="text-green-300">Jouez en equipe avec un ami a distance</p>
        </div>

        {(onlinePhase === "idle" || onlinePhase === "error") && (
          <div className="w-full max-w-sm mb-4">
            <div className="bg-cyan-400/90 text-cyan-950 rounded-2xl px-4 py-3 flex items-center justify-between shadow-[0_14px_30px_rgba(0,0,0,0.24)] border border-cyan-100/40">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg">🎬</span>
                <span className="font-bold text-sm truncate">Parties disponibles : {availableMatches}</span>
              </div>
              <button
                onClick={onAddMatchEntry}
                className="rounded-full border border-cyan-200/70 bg-white/40 hover:bg-white/55 transition-colors px-3 py-1 text-sm font-semibold"
                title="Regarder une vidéo pour gagner une partie"
                aria-label="Ajouter une partie via vidéo"
                disabled={rewardedAdOpen}
              >
                + Ajouter
              </button>
            </div>
            {matchEntryError && (
              <div className="mt-2 bg-red-900/40 border border-red-500/30 rounded-xl p-3 text-red-300 text-xs text-center">
                ⚠️ {matchEntryError}
              </div>
            )}
          </div>
        )}

        {(onlinePhase === "idle" || onlinePhase === "error") && (
          <div className="w-full max-w-sm space-y-4">
            <div className="w-full">
              <label className="text-sm text-green-300 mb-1 block">Votre pseudo :</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Entrez votre pseudo..."
                maxLength={20}
                className="w-full bg-green-800/50 border border-green-600/30 rounded-xl px-4 py-3 text-white placeholder-green-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
              />
            </div>
            <button
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-lg px-6 py-4 rounded-xl shadow-lg hover:scale-105 transition-all flex items-center justify-center gap-3"
              onClick={() => setShowCreateScorePicker(true)}
            >
              <span className="text-2xl">🏠</span>
              <div className="text-left">
                <div>Creer une Partie</div>
                <div className="text-sm font-normal text-emerald-200">Room 2v2 avec code</div>
              </div>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-green-600/30"></div>
              <span className="text-green-500 text-sm">ou</span>
              <div className="flex-1 border-t border-green-600/30"></div>
            </div>

            <div className="bg-green-800/40 rounded-xl p-4 border border-green-600/30">
              <h3 className="text-emerald-300 font-bold mb-3 flex items-center gap-2">
                <span>🔗</span> Rejoindre une Partie
              </h3>
              <div className="flex flex-col gap-2">
                <input
                  className="w-full bg-green-900/50 border border-green-600/30 rounded-lg px-4 py-3 text-white text-center text-lg font-mono tracking-widest placeholder-green-600 focus:outline-none focus:border-emerald-400 uppercase"
                  value={joinCode}
                  onChange={(e) => setJoinCode(onlineManager.normalizeRoomCode(e.target.value))}
                  maxLength={ROOM_CODE_LENGTH}
                  placeholder="Code de la room..."
                />
                <button
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-lg transition-colors"
                  onClick={joinRoom}
                >
                  Rejoindre
                </button>
              </div>
            </div>

            {onlineError && (
              <div className="bg-red-900/40 border border-red-500/30 rounded-xl p-3 text-red-300 text-sm text-center">
                ⚠️ {onlineError}
              </div>
            )}
          </div>
        )}

        {showCreateScorePicker && (onlinePhase === "idle" || onlinePhase === "error") && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="premium-panel rounded-2xl max-w-sm w-full p-5 relative">
              <button
                onClick={() => setShowCreateScorePicker(false)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full premium-chip text-green-200 hover:text-white"
                aria-label="Fermer"
              >
                ✕
              </button>
              <h3 className="premium-title text-2xl font-black text-amber-200 mb-2">Choisir Le Score</h3>
              <p className="text-green-200/90 text-sm mb-4">Créer la partie 2v2 en ligne jusqu a:</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setShowCreateScorePicker(false);
                    createRoom(11);
                  }}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl premium-glow"
                >
                  11 points
                </button>
                <button
                  onClick={() => {
                    setShowCreateScorePicker(false);
                    createRoom(21);
                  }}
                  className="bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 font-bold py-3 rounded-xl premium-glow"
                >
                  21 points
                </button>
              </div>
            </div>
          </div>
        )}

        {(onlinePhase === "creating" || onlinePhase === "joining") && (
          <div className="text-center">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <p className="text-green-300 text-lg">
              {onlinePhase === "creating" ? "Creation de la room..." : "Connexion en cours..."}
            </p>
          </div>
        )}

        {onlinePhase === "waiting" && (
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-green-800/60 backdrop-blur rounded-2xl p-6 border border-emerald-500/30 text-center">
              <div className="text-2xl mb-3">⏳</div>
              <p className="text-green-300 mb-4">En attente de l'equipe adverse...</p>
              <p className="text-xs text-green-500 mb-2">Partagez ce code:</p>
              <div className="bg-green-900/80 border-2 border-emerald-400 rounded-xl px-6 py-4 text-3xl font-mono font-black tracking-[0.3em] text-emerald-300 select-all">
                {roomCode}
              </div>
            </div>
          </div>
        )}

        {onlinePhase === "disconnected" && (
          <div className="text-center">
            <div className="text-4xl mb-4">😔</div>
            <p className="text-red-300 text-lg mb-4">L'adversaire s'est deconnecte</p>
          </div>
        )}

        <button
          className="mt-6 text-green-400 hover:text-white text-sm hover:bg-green-700/50 rounded-lg px-4 py-2 transition-colors"
          onClick={() => {
            feedback("button");
            if (mode === "online") onlineManager.destroy();
            setConsumeMatchOnConnect(false);
            onExit();
          }}
        >
          ← Quitter
        </button>

        <NotEnoughCoinsModal
          open={showNotEnoughMatches}
          title="Pas assez de parties"
          message="Vous n'avez plus de parties disponibles pour jouer en ligne."
          primaryLabel="Gagner une partie"
          secondaryLabel="Annuler"
          onCancel={() => setShowNotEnoughMatches(false)}
          onEarnCoins={() => {
            feedback("button");
            setShowNotEnoughMatches(false);
          }}
        />

        {matchEntryToast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[95] premium-panel rounded-full px-4 py-2 text-emerald-200 text-sm font-bold">
            {matchEntryToast}
          </div>
        )}
      </div>
    );
  }

  const seatLabel: Record<Seat, string> = {
    p1: `J1(A) ${game.seatNames.p1 || "Joueur 1"}`,
    p2: `J2(B) ${game.seatNames.p2 || "Joueur 2"}`,
    p3: `J3(A) ${game.seatNames.p3 || "Joueur 3"}`,
    p4: `J4(B) ${game.seatNames.p4 || "Joueur 4"}`,
  };
  const isOnline = mode === "online";
  const canChoosePendingCapture =
    !!pending &&
    game.phase === "playing" &&
    game.currentTurn === pending.seat &&
    controllableSeats.includes(pending.seat);

  return (
    <div className="premium-screen safe-area min-h-screen text-white p-4">
      <div className="premium-panel rounded-2xl flex items-center justify-between mb-3 p-3">
        <h1 className="premium-title text-xl font-bold">Chkoba 2v2 {isOnline ? "Online" : "Local"}</h1>
        <div className="premium-chip rounded-lg px-3 py-1 text-sm">A: {game.teamA.score} | B: {game.teamB.score}</div>
        <button className="text-green-300 underline" onClick={requestQuit}>Quitter</button>
      </div>
      <QuitConfirmModal
        open={showQuitConfirm}
        online={isOnline}
        onCancel={() => setShowQuitConfirm(false)}
        onConfirm={confirmQuit}
      />
      <div className="premium-chip rounded-lg text-sm mb-2 px-3 py-2">{game.message}</div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {(["p2", "p3"] as Seat[]).map((s) => (
          <div key={s} className="premium-panel p-2 rounded-xl">
            <div className="text-xs mb-2">{seatLabel[s]} {game.currentTurn === s ? "• tour" : ""}</div>
            <div className="stagger-row flex gap-2 justify-center">
              {game.hands[s].map((c) => (
                isOnline && !controllableSeats.includes(s)
                  ? <CardBack key={c.id} />
                  : <CardComponent key={c.id} card={c} onClick={() => onPlay(s, c)} disabled={game.currentTurn !== s || !controllableSeats.includes(s)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="premium-panel rounded-xl p-3 mb-4">
        <div className="text-xs mb-2">Table ({game.table.length})</div>
        <div className="stagger-row flex flex-wrap gap-2 justify-center">
          {game.table.map((c) => <CardComponent key={c.id} card={c} />)}
        </div>
      </div>

      {pending && (
        <div className="premium-panel rounded-xl p-3 mb-4">
          <div className="text-sm mb-2">Choisir la capture</div>
          <div className="flex flex-wrap gap-2">
            {pending.options.map((g, i) => (
              <button
                key={i}
                className="bg-amber-700/70 rounded-xl p-2 flex gap-1 premium-glow disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => chooseCapture(g)}
                disabled={!canChoosePendingCapture}
              >
                {g.map((c) => <CardComponent key={c.id} card={c} small />)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        {(["p1", "p4"] as Seat[]).map((s) => (
          <div key={s} className="premium-panel p-2 rounded-xl">
            <div className="text-xs mb-2">{seatLabel[s]} {game.currentTurn === s ? "• tour" : ""}</div>
            <div className="stagger-row flex gap-2 justify-center">
              {game.hands[s].map((c) => (
                isOnline && !controllableSeats.includes(s)
                  ? <CardBack key={c.id} />
                  : <CardComponent key={c.id} card={c} onClick={() => onPlay(s, c)} disabled={game.currentTurn !== s || !controllableSeats.includes(s)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs text-green-200 mb-3">
        Captures equipe A: {game.teamA.captured.length} (chkoba {game.teamA.chkobas}) | equipe B: {game.teamB.captured.length} (chkoba {game.teamB.chkobas})
      </div>

      {game.phase === "roundEnd" && (
        <div className="premium-panel rounded-xl p-3">
          <div className="mb-2">
            Round fini:{" "}
            {isOnline
              ? `Vous +${myTeam === "A" ? game.teamA.roundPoints : game.teamB.roundPoints}, Adversaires +${oppTeam === "A" ? game.teamA.roundPoints : game.teamB.roundPoints}`
              : `A +${game.teamA.roundPoints}, B +${game.teamB.roundPoints}`}
          </div>
          <button className="bg-amber-500 text-black px-4 py-2 rounded" onClick={() => { feedback("button"); startNextRound(); }}>Round suivant</button>
        </div>
      )}
      {game.phase === "gameOver" && (
        <div className="premium-panel rounded-xl p-3">
          <div className="mb-2 font-bold">
            {isOnline
              ? ((myTeam === "A" ? game.teamA.score : game.teamB.score) >= game.targetScore ? "Vous gagnez !" : "Adversaires gagnent")
              : (game.teamA.score >= game.targetScore ? "Equipe A gagne" : "Equipe B gagne")}
          </div>
          <button className="bg-amber-500 text-black px-4 py-2 rounded mr-2" onClick={() => { feedback("button"); playAgain(); }}>Rejouer</button>
          <button className="bg-green-600 px-4 py-2 rounded" onClick={requestQuit}>Quitter</button>
        </div>
      )}
    </div>
  );
}
