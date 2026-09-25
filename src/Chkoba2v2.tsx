import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { CardComponent, CardBack } from "./CardComponent";
import { cardName, computerPlay, createDeck, dealCards, findCaptures } from "./gameLogic";
import { Card } from "./types";
import { onlineManager, ROOM_CODE_LENGTH } from "./onlineManager";
import { feedback, setupAudioUnlock } from "./utils/premiumFx";
import QuitConfirmModal from "./components/QuitConfirmModal";
import TurnTimer from "./components/TurnTimer";
import NotEnoughCoinsModal from "./components/NotEnoughCoinsModal";
import { sameIdSet } from "./online/validation";
import { twoVTwoSession, type Online2v2State } from "./online/twoVTwoSession";
import type { Online2v2View } from "./online/protocol";
import { NonGameHero, NonGameScreen, ScoreChoiceModal } from "./components/NonGameUI";
import UiIcon from "./components/UiIcon";
import BannerAd, { hideBannerAd } from "./components/BannerAd";

type Team = "A" | "B";
type Seat = "p1" | "p2" | "p3" | "p4";
type OnlinePhase = "idle" | "creating" | "waiting" | "joining" | "connected" | "disconnected" | "error";
type TwoVsTwoMode = "local" | "online";
type ScoreTarget = 11 | 21;

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

function gameFromOnlineView(view: Online2v2View): Game2v2 {
  return {
    phase: view.phase,
    mode: "online",
    deck: [],
    table: view.table,
    hands: {
      p1: view.myHands.p1 ?? [],
      p2: view.myHands.p2 ?? [],
      p3: view.myHands.p3 ?? [],
      p4: view.myHands.p4 ?? [],
    },
    seatNames: view.seatNames,
    currentTurn: view.currentTurn,
    lastCaptureTeam: view.lastCaptureTeam,
    teamA: view.teamA,
    teamB: view.teamB,
    targetScore: view.targetScore,
    message: view.message,
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
    const wanted = captures.find((group) => sameIdSet(captureIds, group.map((item) => item.id)));
    if (!wanted) return state;
    chosen = wanted;
  } else if (captures.length > 0) {
    // A capture is mandatory; an empty/omitted remote choice cannot drop the card.
    chosen = captures[0];
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
  const onlineResumeTimerRef = useRef<number | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [targetScore, setTargetScore] = useState<ScoreTarget>(initialTargetScore);
  const [showCreateScorePicker, setShowCreateScorePicker] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [showNotEnoughMatches, setShowNotEnoughMatches] = useState(false);
  const [consumeMatchOnConnect, setConsumeMatchOnConnect] = useState(false);
  const [remoteHandCounts, setRemoteHandCounts] = useState<Record<Seat, number>>({ p1: 0, p2: 0, p3: 0, p4: 0 });

  const myTeam: Team = useMemo(() => (onlineManager.isHost ? "A" : "B"), [onlinePhase]);
  const oppTeam: Team = myTeam === "A" ? "B" : "A";
  const controllableSeats: Seat[] = mode === "online" ? (myTeam === "A" ? ["p1", "p3"] : ["p2", "p4"]) : TURN_ORDER;

  useEffect(() => {
    setupAudioUnlock();
  }, []);

  useEffect(() => {
    // Native banners are overlays: remove them for every in-match screen so
    // they can never cover the local player's cards.
    if (game) void hideBannerAd();
  }, [game]);

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

  const updateAuthoritativeState = useCallback((updater: (state: Game2v2) => Game2v2) => {
    if (mode === "online" && onlineManager.isHost) {
      twoVTwoSession.updateHostState((state) => updater(state) as Online2v2State);
      return;
    }
    setGame(updater);
  }, [mode]);

  useEffect(() => {
    if (mode !== "online") return;
    twoVTwoSession.configure({
      createHostState: (guestName) => {
        const start = initialize2v2("online", 0, 0, targetScore) as Online2v2State;
        const hostName = playerName.trim() || "Joueur 1";
        return { ...start, seatNames: { p1: hostName, p2: guestName, p3: hostName, p4: guestName } };
      },
      onHostState: (state) => {
        gameRef.current = state;
        setGame(state);
        setPending(null);
      },
      onGuestView: (view) => {
        setRemoteHandCounts(view.handCounts);
        const state = gameFromOnlineView(view);
        gameRef.current = state;
        setGame(state);
        setPending(null);
      },
      onSessionConnected: (reconnected) => {
        setOnlinePhase("connected");
        setOnlineError("");
        if (!reconnected && consumeMatchOnConnect) {
          onConsumeMatchEntry();
          setConsumeMatchOnConnect(false);
        }
      },
      onDisconnected: () => {
        setOnlinePhase("disconnected");
        setOnlineError("Connexion perdue. Tentative de reconnexion…");
      },
      onReconnecting: (attempt) => {
        setOnlinePhase("disconnected");
        setOnlineError(`Connexion perdue. Reconnexion… (${attempt})`);
      },
      onError: (message) => {
        setOnlineError(message);
        setOnlinePhase("error");
        setConsumeMatchOnConnect(false);
      },
      onNextRoundRequested: () => {
        const current = gameRef.current;
        if (current.phase !== "roundEnd") return null;
        const next = initialize2v2("online", current.teamA.score, current.teamB.score, current.targetScore as ScoreTarget) as Online2v2State;
        return { ...next, seatNames: current.seatNames };
      },
      onRematchRequested: () => {
        const current = gameRef.current;
        if (current.phase !== "gameOver") return null;
        const next = initialize2v2("online", 0, 0, current.targetScore as ScoreTarget) as Online2v2State;
        return { ...next, seatNames: current.seatNames };
      },
    });
  }, [mode, targetScore, playerName, consumeMatchOnConnect, onConsumeMatchEntry]);

  useEffect(() => {
    if (mode !== "online") return;
    const cancelResume = () => {
      if (onlineResumeTimerRef.current !== null) {
        window.clearTimeout(onlineResumeTimerRef.current);
        onlineResumeTimerRef.current = null;
      }
    };
    const scheduleResume = () => {
      if (document.visibilityState === "hidden" || onlineResumeTimerRef.current !== null) return;
      onlineResumeTimerRef.current = window.setTimeout(() => {
        onlineResumeTimerRef.current = null;
        onlineManager.resumeConnection();
        if (onlineManager.isConnected() && !onlineManager.isHost) twoVTwoSession.requestSync();
      }, 150);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleResume();
      else cancelResume();
    };
    window.addEventListener("online", scheduleResume);
    window.addEventListener("offline", cancelResume);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const appStateListener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) scheduleResume();
      else cancelResume();
    });
    return () => {
      cancelResume();
      window.removeEventListener("online", scheduleResume);
      window.removeEventListener("offline", cancelResume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void appStateListener.then((listener) => listener.remove());
    };
  }, [mode]);

  useEffect(() => {
    if (game.phase !== "playing") return;
    if (mode === "online" && !onlineManager.isHost) return;
    const everyoneEmpty = TURN_ORDER.every((s) => game.hands[s].length === 0);
    if (everyoneEmpty && game.deck.length > 0) {
      updateAuthoritativeState((prev) => {
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
        return nextState;
      });
      return;
    }
    if (everyoneEmpty && game.deck.length === 0) {
      updateAuthoritativeState((prev) => {
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
        return nextState;
      });
    }
  }, [game, mode, updateAuthoritativeState]);

  const onPlay = (seat: Seat, card: Card) => {
    if (game.phase !== "playing" || game.currentTurn !== seat) return;
    if (!controllableSeats.includes(seat)) return;
    const options = findCaptures(card, game.table);
    if (options.length > 1) {
      setPending({ seat, card, options });
      return;
    }
    if (mode === "online") {
      twoVTwoSession.playCard(seat, card.id);
      return;
    }
    const captureIds = options[0]?.map((captured) => captured.id) ?? [];
    setGame((prev) => {
      const next = applyPlay(prev, seat, card.id, captureIds);
      return next;
    });
  };

  const chooseCapture = (group: Card[]) => {
    if (!pending) return;
    if (game.phase !== "playing" || game.currentTurn !== pending.seat) return;
    if (!controllableSeats.includes(pending.seat)) return;
    const captureIds = group.map((c) => c.id);
    if (mode === "online") {
      twoVTwoSession.chooseCapture(pending.seat, pending.card.id, captureIds);
      setPending(null);
      return;
    }
    setGame((prev) => {
      const next = applyPlay(prev, pending.seat, pending.card.id, captureIds);
      return next;
    });
    setPending(null);
  };

  const handleTurnExpired = () => {
    const current = gameRef.current;
    if (current.phase !== "playing") return;
    setPending(null);
    if (mode === "online") {
      if (onlineManager.isHost) twoVTwoSession.forceTimedTurn();
      return;
    }
    updateAuthoritativeState((prev) => {
      if (prev.phase !== "playing") return prev;
      const seat = prev.currentTurn;
      const hand = prev.hands[seat];
      if (hand.length === 0) return prev;
      const { card, capture } = computerPlay(hand, prev.table);
      const next = applyPlay(prev, seat, card.id, capture?.map((item) => item.id));
      return { ...next, message: `Temps écoulé. ${next.message}` };
    });
  };

  const startNextRound = () => {
    if (mode === "online" && !onlineManager.isHost) {
      twoVTwoSession.requestNextRound();
      return;
    }
    const next = initialize2v2(mode, game.teamA.score, game.teamB.score, game.targetScore as ScoreTarget);
    setPending(null);
    if (mode === "online" && onlineManager.isHost) {
      twoVTwoSession.publishHostState({ ...next, seatNames: game.seatNames } as Online2v2State);
    } else {
      setGame(next);
    }
  };

  const playAgain = () => {
    if (mode === "online" && !onlineManager.isHost) {
      twoVTwoSession.requestRematch();
      return;
    }
    const next = initialize2v2(mode, 0, 0, game.targetScore as ScoreTarget);
    setPending(null);
    if (mode === "online" && onlineManager.isHost) {
      twoVTwoSession.publishHostState({ ...next, seatNames: game.seatNames } as Online2v2State);
    } else {
      setGame(next);
    }
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
      const code = await twoVTwoSession.createRoom();
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
    if (mode === "online") twoVTwoSession.destroy();
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
      setOnlineError(`Le code du salon doit contenir ${ROOM_CODE_LENGTH} caractères.`);
      return;
    }
    setOnlineError("");
    setOnlinePhase("joining");
    setConsumeMatchOnConnect(true);
    try {
      await twoVTwoSession.joinRoom(code, playerName);
    } catch {
      setOnlinePhase("error");
      setConsumeMatchOnConnect(false);
    }
  };

  if (mode === "online" && onlinePhase !== "connected") {
    return (
      <>
      <NonGameScreen className="online-lobby-screen" contentClassName="online-lobby-content non-game-page-pad">
        <NonGameHero
          icon={<span className="mode-mark">2×2</span>}
          eyebrow="Salon en équipe"
          title="2v2 en ligne"
          subtitle="Invitez vos amis et formez deux équipes à distance."
          compact
        />

        {(onlinePhase === "idle" || onlinePhase === "error") && (
          <div className="lobby-balance-wrap">
            <div className="lobby-balance">
              <div className="flex items-center gap-2 min-w-0">
                <span className="lobby-balance__icon" aria-hidden="true"><UiIcon name="ticket" size={20} /></span>
                <span className="lobby-balance__copy"><small>Votre solde</small><strong>{availableMatches} partie{availableMatches > 1 ? "s" : ""}</strong></span>
              </div>
              <button
                onClick={onAddMatchEntry}
                className="lobby-add-button"
                title="Regarder une vidéo pour gagner une partie"
                aria-label="Ajouter une partie via vidéo"
                disabled={rewardedAdOpen}
              >
                <UiIcon name="plus" size={16} /> Ajouter
              </button>
            </div>
            {matchEntryError && (
              <div className="non-game-alert non-game-alert--error mt-2">
                <span aria-hidden="true">!</span> {matchEntryError}
              </div>
            )}
          </div>
        )}

        {(onlinePhase === "idle" || onlinePhase === "error") && (
          <div className="lobby-actions">
            <div className="lobby-field-group">
              <label className="lobby-label" htmlFor="online-2v2-player-name"><span>01</span> Votre pseudo</label>
              <input
                id="online-2v2-player-name"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Entrez votre pseudo..."
                maxLength={20}
                className="lobby-input"
              />
            </div>
            <button
              className="lobby-create-card"
              onClick={() => setShowCreateScorePicker(true)}
            >
              <span className="lobby-create-card__icon" aria-hidden="true"><UiIcon name="plus" size={25} /></span>
              <span className="lobby-create-card__copy"><strong>Créer une partie</strong><small>Ouvrez un salon privé 2v2</small></span>
              <span className="lobby-create-card__arrow" aria-hidden="true">›</span>
            </button>

            <div className="lobby-divider">
              <span />
              <b>ou</b>
              <span />
            </div>

            <div className="lobby-join-card">
              <div className="lobby-join-card__heading">
                <span aria-hidden="true"><UiIcon name="link" size={19} /></span>
                <div><strong>Rejoindre une partie</strong><small>Saisissez le code reçu</small></div>
              </div>
              <div className="lobby-join-form">
                <input
                  className="lobby-input lobby-code-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(onlineManager.normalizeRoomCode(e.target.value))}
                  maxLength={ROOM_CODE_LENGTH}
                  placeholder="CODE SALON"
                  aria-label="Code du salon"
                />
                <button
                  className="lobby-join-button"
                  onClick={joinRoom}
                >
                  Rejoindre
                </button>
              </div>
            </div>

            {onlineError && (
              <div className="non-game-alert non-game-alert--error">
                <span aria-hidden="true">!</span> {onlineError}
              </div>
            )}
          </div>
        )}

        <ScoreChoiceModal
          open={showCreateScorePicker && (onlinePhase === "idle" || onlinePhase === "error")}
          description="Choisissez la durée de votre partie en équipe."
          onClose={() => setShowCreateScorePicker(false)}
          onSelect={(score) => {
            setShowCreateScorePicker(false);
            createRoom(score);
          }}
        />

        {(onlinePhase === "creating" || onlinePhase === "joining") && (
          <div className="lobby-state-card">
            <div className="lobby-loader" aria-hidden="true" />
            <p>
              {onlinePhase === "creating" ? "Création du salon..." : "Connexion en cours..."}
            </p>
          </div>
        )}

        {onlinePhase === "waiting" && (
          <div className="lobby-state-card lobby-waiting-card">
              <div className="lobby-waiting-mark" aria-hidden="true"><span /></div>
              <h2>En attente de l'équipe adverse</h2>
              <p>Partagez ce code avec vos amis</p>
              <div className="lobby-room-code">
                {roomCode}
              </div>
              <div className="lobby-live-status"><i /><span>Salon ouvert</span></div>
          </div>
        )}

        {onlinePhase === "disconnected" && (
          <div className="lobby-state-card lobby-state-card--error">
            <UiIcon name="link" size={34} className="mb-3" />
            <p>L'adversaire s'est déconnecté</p>
          </div>
        )}

        <button
          className="lobby-exit-button"
          onClick={() => {
            feedback("button");
            if (mode === "online") twoVTwoSession.destroy();
            setConsumeMatchOnConnect(false);
            onExit();
          }}
        >
          <UiIcon name="back" size={17} /> Quitter
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
          <div className="non-game-toast">
            {matchEntryToast}
          </div>
        )}
      </NonGameScreen>
      <BannerAd />
      </>
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
  const turnTimerKey = `${game.currentTurn}:${TURN_ORDER.map((seat) => game.hands[seat].length).join(':')}:${game.teamA.captured.length}:${game.teamB.captured.length}:${game.table.map((card) => card.id).join(',')}`;
  const timerActive = game.phase === "playing" && (mode !== "online" || onlinePhase === "connected");
  const timerIsAuthoritative = mode !== "online" || onlineManager.isHost;

  return (
    <div className="premium-screen safe-area min-h-screen text-white p-4 tunisian-gameplay gameplay-2v2-screen">
      <div className="game-mosaic-rail game-mosaic-rail--left" aria-hidden="true" />
      <div className="game-mosaic-rail game-mosaic-rail--right" aria-hidden="true" />
      <div className="premium-panel tunisian-hud rounded-2xl flex items-center justify-between mb-3 p-3">
        <h1 className="premium-title text-xl font-bold">Chkoba 2v2 {isOnline ? "Online" : "Local"}</h1>
        <div className="premium-chip rounded-lg px-3 py-1 text-sm">A: {game.teamA.score} | B: {game.teamB.score}</div>
        <TurnTimer compact turnKey={turnTimerKey} active={timerActive} onExpire={timerIsAuthoritative ? handleTurnExpired : undefined} />
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
              {isOnline && !controllableSeats.includes(s)
                ? Array.from({ length: !onlineManager.isHost ? remoteHandCounts[s] : game.hands[s].length }, (_, index) => <CardBack key={index} />)
                : game.hands[s].map((c) => <CardComponent key={c.id} card={c} onClick={() => onPlay(s, c)} disabled={game.currentTurn !== s || !controllableSeats.includes(s)} />)}
            </div>
          </div>
        ))}
      </div>

      <div className="premium-panel tunisian-2v2-table rounded-xl p-3 mb-4">
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
              {isOnline && !controllableSeats.includes(s)
                ? Array.from({ length: !onlineManager.isHost ? remoteHandCounts[s] : game.hands[s].length }, (_, index) => <CardBack key={index} />)
                : game.hands[s].map((c) => <CardComponent key={c.id} card={c} onClick={() => onPlay(s, c)} disabled={game.currentTurn !== s || !controllableSeats.includes(s)} />)}
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
