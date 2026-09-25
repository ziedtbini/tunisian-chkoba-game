import React, { useState, useEffect, useRef, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Card, GameState, Score, GameMode, PlayerSide, OnlinePhase } from './types';
import { CardComponent, CardBack } from './CardComponent';
import {
  findCaptures,
  computerPlay,
  dealCards,
  computeRoundScores,
  initializeRound,
  cardName,
} from './gameLogic';
import { cn } from './utils/cn';
import { onlineManager, ROOM_CODE_LENGTH } from './onlineManager';
import Chkoba2v2 from './Chkoba2v2';
import { feedback, setupAudioUnlock } from './utils/premiumFx';
import { ACHIEVEMENTS, AchievementId, getAchievementMeta, getUnlockedAchievements, unlockAchievement } from './utils/achievements';
import QuitConfirmModal from './components/QuitConfirmModal';
import NotEnoughCoinsModal from './components/NotEnoughCoinsModal';
import BannerAd, { hideBannerAd } from './components/BannerAd';
import OnlineMenuScreen from './screens/OnlineMenuScreen';
import ClassicMenuScreen from './screens/ClassicMenuScreen';
import { DEFAULT_MATCH_ENTRIES, loadMatchEntries, saveMatchEntries } from './game/matchEntries';
import { showRewardedMatchEntryAd } from './services/admobService';
import { oneVOneSession } from './online/oneVOneSession';
import type { Online1v1View } from './online/protocol';
import TurnTimer from './components/TurnTimer';
import { BackButton, MenuActionCard, NonGameHero, NonGameScreen, ScoreChoiceModal } from './components/NonGameUI';
import UiIcon from './components/UiIcon';

type VisualTheme = 'classic' | 'gold' | 'royal';
type ScoreTarget = 11 | 21;
type CaptureFx = { key: number; playedCard: Card; capturedCards: Card[] };
const ONLINE_MATCH_COST = 1;

function gameStateFrom1v1View(view: Online1v1View): GameState {
  return {
    phase: view.phase,
    mode: 'online',
    deck: [],
    table: view.table,
    player1: { name: view.player1.name, hand: view.mySide === 'player1' ? view.myHand : [], captured: view.player1.captured, chkobas: view.player1.chkobas },
    player2: { name: view.player2.name, hand: view.mySide === 'player2' ? view.myHand : [], captured: view.player2.captured, chkobas: view.player2.chkobas },
    currentTurn: view.currentTurn,
    lastCapture: view.lastCapture,
    player1Score: view.player1Score,
    player2Score: view.player2Score,
    roundScorePlayer1: view.roundScorePlayer1,
    roundScorePlayer2: view.roundScorePlayer2,
    targetScore: view.targetScore,
    message: view.message,
    selectedCard: view.selectedCard,
    possibleCaptures: view.possibleCaptures,
    lastAction: view.lastAction,
    showChkoba: view.showChkoba,
  };
}

export const ChkobaGame: React.FC = () => {
  const [mode2v2, setMode2v2] = useState<null | 'online'>(null);
  const [targetScore2v2, setTargetScore2v2] = useState<ScoreTarget>(11);
  const [game, setGame] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [visualTheme, setVisualTheme] = useState<VisualTheme>(() => {
    const saved = localStorage.getItem('chkoba-theme');
    return (saved === 'gold' || saved === 'royal' || saved === 'classic') ? saved : 'classic';
  });
  const [scoreFx, setScoreFx] = useState({ p1: false, p2: false });
  const prevScoreRef = useRef<{ p1: number; p2: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const onlineResumeTimerRef = useRef<number | null>(null);
  const gameRef = useRef<GameState | null>(null);

  // Online state
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const [mySide, setMySide] = useState<PlayerSide>('player1');
  const [playerName, setPlayerName] = useState('');
  const [showOnlineLobby, setShowOnlineLobby] = useState(false);
  const [onlineTargetScore, setOnlineTargetScore] = useState<ScoreTarget>(11);
  const [copied, setCopied] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem('chkoba-onboarding-v2') !== 'done');
  const [unlocked, setUnlocked] = useState<AchievementId[]>(() => getUnlockedAchievements());
  const [achievementToast, setAchievementToast] = useState<string | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [captureFx, setCaptureFx] = useState<CaptureFx | null>(null);
  const [availableMatches, setAvailableMatches] = useState(() => loadMatchEntries(DEFAULT_MATCH_ENTRIES));
  const [consumeMatchOnOnlineStart, setConsumeMatchOnOnlineStart] = useState(false);
  const [showNotEnoughMatchEntries, setShowNotEnoughMatchEntries] = useState(false);
  const [rewardedAdOpen, setRewardedAdOpen] = useState(false);
  const [matchEntryToast, setMatchEntryToast] = useState<string | null>(null);
  const [matchEntryError, setMatchEntryError] = useState<string | null>(null);
  const [onlineHandCounts, setOnlineHandCounts] = useState<Record<PlayerSide, number>>({ player1: 0, player2: 0 });

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (mode2v2) return;
    oneVOneSession.configure({
      createHostState: (guestName) => {
        const initial = initializeRound(0, 0, onlineTargetScore, 'online');
        return {
          ...initial,
          player1: { ...initial.player1, name: playerName.trim() || 'Joueur 1' },
          player2: { ...initial.player2, name: guestName },
        };
      },
      onHostState: (state) => {
        gameRef.current = state;
        setGame(state);
        setBusy(false);
      },
      onGuestView: (view) => {
        setMySide('player2');
        setOnlineHandCounts({ player1: view.player1.handCount, player2: view.player2.handCount });
        const state = gameStateFrom1v1View(view);
        gameRef.current = state;
        setGame(state);
        setBusy(false);
      },
      onSessionConnected: (reconnected) => {
        setOnlinePhase('connected');
        setOnlineError('');
        if (!reconnected && consumeMatchOnOnlineStart) {
          setAvailableMatches((prev) => Math.max(0, prev - ONLINE_MATCH_COST));
          setConsumeMatchOnOnlineStart(false);
        }
        if (onlineManager.isHost) setMySide('player1');
      },
      onReconnecting: (attempt) => {
        setOnlinePhase('disconnected');
        setOnlineError(`Connexion perdue. Reconnexion… (${attempt})`);
      },
      onDisconnected: () => {
        setOnlinePhase('disconnected');
        setOnlineError('Connexion perdue. Tentative de reconnexion…');
      },
      onError: (message) => {
        setOnlineError(message);
        setOnlinePhase('error');
        setConsumeMatchOnOnlineStart(false);
      },
      onNextRoundRequested: () => {
        const current = gameRef.current;
        if (!current || current.phase !== 'roundEnd') return null;
        const next = initializeRound(current.player1Score, current.player2Score, current.targetScore, 'online');
        return { ...next, player1: { ...next.player1, name: current.player1.name }, player2: { ...next.player2, name: current.player2.name } };
      },
      onRematchRequested: () => {
        const current = gameRef.current;
        if (!current || current.phase !== 'gameOver') return null;
        const next = initializeRound(0, 0, current.targetScore, 'online');
        return { ...next, player1: { ...next.player1, name: current.player1.name }, player2: { ...next.player2, name: current.player2.name } };
      },
    });
  }, [mode2v2, onlineTargetScore, playerName, consumeMatchOnOnlineStart]);

  useEffect(() => {
    setupAudioUnlock();
  }, []);

  useEffect(() => {
    // Gameplay owns the full viewport; ads stay limited to menus and lobbies.
    if (game?.phase === 'playing') {
      void hideBannerAd();
    }
  }, [game?.phase]);

  useEffect(() => {
    localStorage.setItem('chkoba-theme', visualTheme);
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove('theme-classic', 'theme-gold', 'theme-royal');
    root.classList.add(`theme-${visualTheme}`);
    body.classList.remove('theme-classic', 'theme-gold', 'theme-royal');
    body.classList.add(`theme-${visualTheme}`);
  }, [visualTheme]);

  useEffect(() => {
    saveMatchEntries(availableMatches);
  }, [availableMatches]);

  const unlock = useCallback((id: AchievementId) => {
    if (!unlockAchievement(id)) return;
    const now = getUnlockedAchievements();
    setUnlocked(now);
    const meta = getAchievementMeta(id);
    setAchievementToast(`🏅 ${meta.title} debloque`);
    setTimeout(() => setAchievementToast(null), 2000);
    feedback('victory');
  }, []);

  useEffect(() => {
    if (!game) return;
    const prev = prevScoreRef.current;
    if (prev) {
      if (prev.p1 !== game.player1Score) {
        setScoreFx((s) => ({ ...s, p1: true }));
        setTimeout(() => setScoreFx((s) => ({ ...s, p1: false })), 520);
      }
      if (prev.p2 !== game.player2Score) {
        setScoreFx((s) => ({ ...s, p2: true }));
        setTimeout(() => setScoreFx((s) => ({ ...s, p2: false })), 520);
      }
    }
    prevScoreRef.current = { p1: game.player1Score, p2: game.player2Score };
  }, [game?.player1Score, game?.player2Score]);

  useEffect(() => {
    if (!game) return;
    if (game.phase === 'gameOver') {
      const p1Won = game.player1Score >= game.targetScore;
      const iWon =
        game.mode === 'online'
          ? (mySide === 'player1' && p1Won) || (mySide === 'player2' && !p1Won)
          : p1Won;
      if (iWon) unlock('first_win');
      feedback('victory');
      return;
    }
    if (game.phase === 'roundEnd') {
      feedback('roundEnd');
      return;
    }
    if (game.lastAction.includes('chkoba')) {
      unlock('first_chkoba');
      feedback('chkoba');
    } else if (game.lastAction.includes('capture')) {
      feedback('capture');
    } else if (game.lastAction.includes('drop')) {
      feedback('card');
    }
  }, [game?.lastAction, game?.phase, game?.player1Score, game?.player2Score, mySide, unlock]);

  useEffect(() => {
    if (!captureFx) return;
    const t = window.setTimeout(() => setCaptureFx(null), 1500);
    return () => window.clearTimeout(t);
  }, [captureFx]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const updateGameState = useCallback((updater: (state: GameState) => GameState) => {
    if (onlineManager.isHost && gameRef.current?.mode === 'online') {
      oneVOneSession.updateHostState(updater);
      return;
    }
    setGame((current) => current ? updater(current) : current);
  }, []);

  useEffect(() => {
    const cancelResume = () => {
      if (onlineResumeTimerRef.current !== null) {
        window.clearTimeout(onlineResumeTimerRef.current);
        onlineResumeTimerRef.current = null;
      }
    };
    const scheduleResume = () => {
      if (!showOnlineLobby && game?.mode !== 'online' && !mode2v2) return;
      if (document.visibilityState === 'hidden' || onlineResumeTimerRef.current !== null) return;
      onlineResumeTimerRef.current = window.setTimeout(() => {
        onlineResumeTimerRef.current = null;
        onlineManager.resumeConnection();
        if (onlineManager.isConnected() && !onlineManager.isHost && !mode2v2) oneVOneSession.requestSync();
      }, 150);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleResume();
      else cancelResume();
    };
    window.addEventListener('online', scheduleResume);
    window.addEventListener('offline', cancelResume);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const appStateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) scheduleResume();
      else cancelResume();
    });
    return () => {
      cancelResume();
      window.removeEventListener('online', scheduleResume);
      window.removeEventListener('offline', cancelResume);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void appStateListener.then((listener) => listener.remove());
    };
  }, [showOnlineLobby, game?.mode, mode2v2]);

  // ---- Online actions ----
  const createOnlineRoom = async (targetScore: ScoreTarget) => {
    if (availableMatches < ONLINE_MATCH_COST) {
      setShowNotEnoughMatchEntries(true);
      return;
    }
    unlock('first_online');
    setOnlineError('');
    setOnlineTargetScore(targetScore);
    setOnlinePhase('creating');
    setConsumeMatchOnOnlineStart(true);
    try {
      const code = await oneVOneSession.createRoom();
      setRoomCode(code);
      setOnlinePhase('waiting');
    } catch {
      setOnlinePhase('error');
      setConsumeMatchOnOnlineStart(false);
    }
  };

  const joinOnlineRoom = async () => {
    if (availableMatches < ONLINE_MATCH_COST) {
      setShowNotEnoughMatchEntries(true);
      return;
    }
    unlock('first_online');
    const normalizedCode = onlineManager.normalizeRoomCode(joinCode);
    if (normalizedCode.length !== ROOM_CODE_LENGTH) {
      setOnlineError(`Le code du salon doit contenir ${ROOM_CODE_LENGTH} caractères.`);
      return;
    }
    setOnlineError('');
    setOnlinePhase('joining');
    setConsumeMatchOnOnlineStart(true);
    try {
      await oneVOneSession.joinRoom(normalizedCode, playerName);
    } catch {
      setOnlinePhase('error');
      setConsumeMatchOnOnlineStart(false);
    }
  };

  const leaveOnline = () => {
    clearTimer();
    setBusy(false);
    oneVOneSession.destroy();
    setOnlinePhase('idle');
    setGame(null);
    setRoomCode('');
    setJoinCode('');
    setOnlineError('');
    setShowOnlineLobby(false);
    setCopied(false);
    setConsumeMatchOnOnlineStart(false);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleAddMatchEntry = useCallback(async () => {
    if (rewardedAdOpen) return;
    feedback('button');
    setMatchEntryError(null);
    setRewardedAdOpen(true);
    try {
      const result = await showRewardedMatchEntryAd();
      if (result !== "rewarded") {
        const message = result === "consent-required"
          ? "Votre choix de confidentialité est encore nécessaire. Relancez l'app puis réessayez."
          : result === "unavailable"
            ? "Aucune publicité n'est disponible pour le moment. Réessayez dans quelques instants."
            : "La publicité n'a pas pu être chargée. Vérifiez votre connexion puis réessayez.";
        setMatchEntryError(message);
        return;
      }
      setAvailableMatches((prev) => prev + 1);
      setMatchEntryToast('+1 partie ajoutée');
      setTimeout(() => setMatchEntryToast(null), 1600);
    } finally {
      setRewardedAdOpen(false);
    }
  }, [rewardedAdOpen]);

  const requestQuitGame = () => {
    feedback('button');
    setShowQuitConfirm(true);
  };

  const confirmQuitGame = () => {
    setShowQuitConfirm(false);
    if (game?.mode === 'online') {
      leaveOnline();
      return;
    }
    clearTimer();
    setBusy(false);
    setGame(null);
  };

  // ---- Offline game start ----
  const startNewGame = (mode: GameMode, targetScore: ScoreTarget) => {
    if (mode === 'online') {
      setOnlineTargetScore(targetScore);
      setShowOnlineLobby(true);
      return;
    }
    unlock('first_game');
    clearTimer();
    setBusy(false);
    setGame(initializeRound(0, 0, targetScore, mode));
  };

  const otherSide = (side: PlayerSide): PlayerSide =>
    side === 'player1' ? 'player2' : 'player1';

  // ---- A player plays a card ----
  const handlePlayCard = (card: Card, who: PlayerSide) => {
    if (game?.mode === 'online') {
      if (who === mySide && game.currentTurn === mySide && game.phase === 'playing') {
        oneVOneSession.playCard(card.id);
      }
      return;
    }

    // Offline modes
    setGame(prev => {
      if (!prev || prev.currentTurn !== who || prev.phase !== 'playing') return prev;
      if (prev.selectedCard?.id === card.id) {
        return { ...prev, selectedCard: null, possibleCaptures: null, message: `${prev[who].name}, sélectionnez une carte.` };
      }
      const captures = findCaptures(card, prev.table);
      if (captures.length === 0) {
        const newHand = prev[who].hand.filter((c: Card) => c.id !== card.id);
        const nextTurn = otherSide(who);
        const needsTransition = prev.mode === 'vs-player';
        return {
          ...prev,
          [who]: { ...prev[who], hand: newHand },
          table: [...prev.table, card],
          selectedCard: null,
          possibleCaptures: null,
          currentTurn: nextTurn,
          phase: needsTransition ? 'turnTransition' as const : 'playing' as const,
          message: `${prev[who].name} a posé ${cardName(card)} sur la table.`,
          lastAction: 'drop',
          showChkoba: null,
        };
      }
      if (captures.length === 1) {
        return doCapture(prev, card, captures[0], who);
      }
      return {
        ...prev,
        selectedCard: card,
        possibleCaptures: captures,
        message: 'Choisissez les cartes à capturer.',
      };
    });
  };

  const handleCaptureChoice = (captureGroup: Card[]) => {
    if (game?.mode === 'online') {
      if (game.currentTurn !== mySide || !game.selectedCard) return;
      oneVOneSession.chooseCapture(game.selectedCard.id, captureGroup.map((card) => card.id));
      return;
    }

    setGame(prev => {
      if (!prev || !prev.selectedCard) return prev;
      return doCapture(prev, prev.selectedCard, captureGroup, prev.currentTurn);
    });
  };

  function doCapture(state: GameState, playedCard: Card, capturedCards: Card[], who: PlayerSide): GameState {
    setCaptureFx({
      key: Date.now(),
      playedCard,
      capturedCards,
    });

    const actor = state[who];
    const newHand = actor.hand.filter((c: Card) => c.id !== playedCard.id);
    const newTable = state.table.filter((tc: Card) => !capturedCards.some((cc: Card) => cc.id === tc.id));
    const newCaptured = [...actor.captured, playedCard, ...capturedCards];
    const isChkoba = newTable.length === 0;
    const chkobas = actor.chkobas + (isChkoba ? 1 : 0);
    const nextTurn = otherSide(who);
    const playerName = state[who].name;
    const msgCapture = isChkoba
      ? `🎉 ${playerName} fait une CHKOBA ! +1 point !`
      : `${playerName} a capturé ${capturedCards.length + 1} carte(s).`;

    const needsTransition = state.mode === 'vs-player' && !isChkoba;

    return {
      ...state,
      [who]: { ...actor, hand: newHand, captured: newCaptured, chkobas },
      table: newTable,
      selectedCard: null,
      possibleCaptures: null,
      currentTurn: nextTurn,
      lastCapture: who,
      phase: needsTransition ? 'turnTransition' as const : 'playing' as const,
      message: msgCapture,
      lastAction: isChkoba ? `${who}-chkoba` : `${who}-capture`,
      showChkoba: isChkoba ? who : null,
    };
  }

  const handleTurnExpired = () => {
    const current = gameRef.current;
    if (!current || current.phase !== 'playing' || busy) return;
    if (current.mode === 'online') {
      if (onlineManager.isHost) oneVOneSession.forceTimedTurn();
      return;
    }
    if (current.mode === 'vs-cpu' && current.currentTurn === 'player2') return;

    setGame((prev) => {
      if (!prev || prev.phase !== 'playing') return prev;
      const who = prev.currentTurn;
      if (prev.selectedCard && prev.possibleCaptures?.length) {
        const next = doCapture(prev, prev.selectedCard, prev.possibleCaptures[0], who);
        return { ...next, message: `Temps écoulé. ${next.message}` };
      }
      const hand = prev[who].hand;
      if (hand.length === 0) return prev;
      const { card, capture } = computerPlay(hand, prev.table);
      if (capture) {
        const next = doCapture(prev, card, capture, who);
        return { ...next, message: `Temps écoulé. ${next.message}` };
      }
      const nextTurn = otherSide(who);
      return {
        ...prev,
        [who]: { ...prev[who], hand: hand.filter((item) => item.id !== card.id) },
        table: [...prev.table, card],
        selectedCard: null,
        possibleCaptures: null,
        currentTurn: nextTurn,
        phase: prev.mode === 'vs-player' ? 'turnTransition' : 'playing',
        message: `Temps écoulé. ${prev[who].name} pose automatiquement ${cardName(card)}.`,
        lastAction: 'timeout-drop',
        showChkoba: null,
      };
    });
  };

  const confirmTurnTransition = () => {
    setGame(prev => {
      if (!prev) return null;
      return {
        ...prev,
        phase: 'playing' as const,
        message: `${prev[prev.currentTurn].name}, sélectionnez une carte.`,
        showChkoba: null,
      };
    });
  };

  // ---- Main game loop effect ----
  useEffect(() => {
    if (!game || game.phase !== 'playing' || busy) return;

    // Online is host-authoritative: guest only renders incoming state.
    if (game.mode === 'online' && !onlineManager.isHost) return;

    const p1Empty = game.player1.hand.length === 0;
    const p2Empty = game.player2.hand.length === 0;

    // --- Both hands empty: deal or end round ---
    if (p1Empty && p2Empty) {
      if (game.deck.length > 0) {
        setBusy(true);
        timerRef.current = window.setTimeout(() => {
          updateGameState(prev => {
            const { dealt: p1Hand, remaining: d1 } = dealCards(prev.deck, 3);
            const { dealt: p2Hand, remaining: d2 } = dealCards(d1, 3);
            const nextTurn: PlayerSide = 'player1';
            const needsTransition = prev.mode === 'vs-player';
            const newState: GameState = {
              ...prev,
              deck: d2,
              player1: { ...prev.player1, hand: p1Hand },
              player2: { ...prev.player2, hand: p2Hand },
              currentTurn: nextTurn,
              phase: needsTransition ? 'turnTransition' as const : 'playing' as const,
              message: 'Nouvelles cartes distribuées !',
              showChkoba: null,
            };
            return newState;
          });
          setBusy(false);
        }, 800);
        return;
      } else {
        setBusy(true);
        timerRef.current = window.setTimeout(() => {
          updateGameState(prev => {
            const p1 = { ...prev.player1, captured: [...prev.player1.captured] };
            const p2 = { ...prev.player2, captured: [...prev.player2.captured] };

            if (prev.table.length > 0 && prev.lastCapture) {
              if (prev.lastCapture === 'player1') {
                p1.captured = [...p1.captured, ...prev.table];
              } else {
                p2.captured = [...p2.captured, ...prev.table];
              }
            }

            const { score1, score2 } = computeRoundScores(p1, p2);
            const newP1 = prev.player1Score + score1.total;
            const newP2 = prev.player2Score + score2.total;
            const isOver = newP1 >= prev.targetScore || newP2 >= prev.targetScore;

            const p2Name = prev.player2.name;
            const isCpuMode = prev.mode === 'vs-cpu';

            const newState: GameState = {
              ...prev,
              phase: isOver ? 'gameOver' as const : 'roundEnd' as const,
              table: [],
              player1: p1,
              player2: p2,
              player1Score: newP1,
              player2Score: newP2,
              roundScorePlayer1: score1,
              roundScorePlayer2: score2,
              message: isOver
                ? (newP1 >= prev.targetScore
                  ? (isCpuMode ? '🎊 Vous avez gagné la partie !' : `🎊 ${prev.player1.name} a gagné la partie !`)
                  : `😞 ${p2Name} a gagné la partie.`)
                : 'Fin du round !',
              showChkoba: null,
              selectedCard: null,
              possibleCaptures: null,
            };
            return newState;
          });
          setBusy(false);
        }, 1000);
        return;
      }
    }

    // --- Computer's turn ---
    if (game.mode === 'vs-cpu' && game.currentTurn === 'player2' && game.player2.hand.length > 0) {
      setBusy(true);
      const delay = game.showChkoba ? 2000 : 1200;
      timerRef.current = window.setTimeout(() => {
        setGame(prev => {
          if (!prev) return null;
          const { card, capture } = computerPlay(prev.player2.hand, prev.table);
          if (!capture) {
            const newHand = prev.player2.hand.filter((c: Card) => c.id !== card.id);
            return {
              ...prev,
              player2: { ...prev.player2, hand: newHand },
              table: [...prev.table, card],
              currentTurn: 'player1' as const,
              message: `L'ordinateur a posé ${cardName(card)} sur la table.`,
              lastAction: 'computer-drop',
              showChkoba: null,
            };
          }
          return doCapture(prev, card, capture, 'player2');
        });
        setBusy(false);
      }, delay);
      return;
    }

    // Handle empty hand edge cases
    if (game.currentTurn === 'player2' && game.player2.hand.length === 0 && game.player1.hand.length > 0) {
      setGame(prev => prev ? { ...prev, currentTurn: 'player1' as const, showChkoba: null } : null);
    }
    if (game.currentTurn === 'player1' && game.player1.hand.length === 0 && game.player2.hand.length > 0) {
      setGame(prev => prev ? { ...prev, currentTurn: 'player2' as const, showChkoba: null } : null);
    }

    // In vs-player mode, auto-hide chkoba
    if (game.mode === 'vs-player' && game.showChkoba) {
      setBusy(true);
      timerRef.current = window.setTimeout(() => {
        setGame(prev => {
          if (!prev) return null;
          return {
            ...prev,
            showChkoba: null,
            phase: 'turnTransition' as const,
          };
        });
        setBusy(false);
      }, 2000);
    }

    // In online mode, auto-hide chkoba
    if (game.mode === 'online' && game.showChkoba && onlineManager.isHost) {
      setBusy(true);
      timerRef.current = window.setTimeout(() => {
        updateGameState(prev => {
          const s: GameState = { ...prev, showChkoba: null };
          return s;
        });
        setBusy(false);
      }, 2500);
    }
  }, [game, busy, updateGameState]);

  const startNextRound = () => {
    if (!game) return;
    if (game.mode === 'online') {
      if (onlineManager.isHost) {
        clearTimer();
        setBusy(false);
        const newState = initializeRound(game.player1Score, game.player2Score, game.targetScore, 'online');
        oneVOneSession.publishHostState({ ...newState, player1: { ...newState.player1, name: game.player1.name }, player2: { ...newState.player2, name: game.player2.name } });
      } else {
        oneVOneSession.requestNextRound();
      }
      return;
    }
    clearTimer();
    setBusy(false);
    setGame(initializeRound(game.player1Score, game.player2Score, game.targetScore, game.mode));
  };

  const playAgain = () => {
    if (!game) return;
    if (game.mode === 'online') {
      if (onlineManager.isHost) {
        const newState = initializeRound(0, 0, game.targetScore, 'online');
        oneVOneSession.publishHostState({ ...newState, player1: { ...newState.player1, name: game.player1.name }, player2: { ...newState.player2, name: game.player2.name } });
      } else {
        oneVOneSession.requestRematch();
      }
      return;
    }
    startNewGame(game.mode, game.targetScore as ScoreTarget);
  };

  // =============== RENDERING ===============

  if (mode2v2) {
    return (
      <Chkoba2v2
        initialMode={mode2v2}
        initialTargetScore={targetScore2v2}
        availableMatches={availableMatches}
        onConsumeMatchEntry={() => setAvailableMatches((prev) => Math.max(0, prev - ONLINE_MATCH_COST))}
        onAddMatchEntry={handleAddMatchEntry}
        rewardedAdOpen={rewardedAdOpen}
        matchEntryToast={matchEntryToast}
        matchEntryError={matchEntryError}
        onExit={() => {
          setMode2v2(null);
          setGame(null);
          setShowOnlineLobby(false);
        }}
      />
    );
  }

  // Online lobby
  if (showOnlineLobby && (!game || onlinePhase !== 'connected')) {
    return (
      <>
        <OnlineLobbyScreen
          onlinePhase={onlinePhase}
          roomCode={roomCode}
          joinCode={joinCode}
          onlineError={onlineError}
          playerName={playerName}
          copied={copied}
          availableMatches={availableMatches}
          showNotEnoughMatchEntries={showNotEnoughMatchEntries}
          onShowNotEnoughMatchEntries={() => setShowNotEnoughMatchEntries(true)}
          onDismissNotEnoughMatchEntries={() => setShowNotEnoughMatchEntries(false)}
          onSetPlayerName={setPlayerName}
          onSetJoinCode={setJoinCode}
          onCreateRoom={createOnlineRoom}
          onJoinRoom={joinOnlineRoom}
          onCopyCode={copyRoomCode}
          onAddMatchEntry={handleAddMatchEntry}
          rewardedAdOpen={rewardedAdOpen}
          matchEntryToast={matchEntryToast}
          matchEntryError={matchEntryError}
          onBack={leaveOnline}
        />
        <BannerAd />
      </>
    );
  }

  if (!game) {
    return (
      <MenuScreen
        onStart={(mode, targetScore) => {
          feedback('button');
          startNewGame(mode, targetScore);
        }}
        onStart2v2Online={(targetScore) => {
          feedback('button');
          unlock('first_2v2');
          unlock('first_online');
          setTargetScore2v2(targetScore);
          setMode2v2('online');
        }}
        onAddMatchEntry={handleAddMatchEntry}
        rewardedAdOpen={rewardedAdOpen}
        matchEntryToast={matchEntryToast}
        matchEntryError={matchEntryError}
        visualTheme={visualTheme}
        availableMatches={availableMatches}
        onSetTheme={(t) => {
          feedback('button');
          setVisualTheme(t);
        }}
        showOnboarding={showOnboarding}
        onCloseOnboarding={() => {
          localStorage.setItem('chkoba-onboarding-v2', 'done');
          setShowOnboarding(false);
          feedback('button');
        }}
        unlocked={unlocked}
      />
    );
  }

  if (game.phase === 'gameOver') {
    return (
      <GameOverScreen
        game={game}
        mySide={mySide}
        onPlayAgain={playAgain}
        onMenu={() => {
          if (game.mode === 'online') {
            leaveOnline();
          } else {
            clearTimer();
            setBusy(false);
            setGame(null);
          }
        }}
      />
    );
  }

  if (game.phase === 'roundEnd') {
    return <RoundEndScreen game={game} mySide={mySide} onNextRound={startNextRound} />;
  }

  if (game.phase === 'turnTransition') {
    return (
      <TurnTransitionScreen
        game={game}
        onReady={confirmTurnTransition}
      />
    );
  }

  // Playing phase
  const isCpuMode = game.mode === 'vs-cpu';
  const isOnline = game.mode === 'online';
  const isCurrentTurnActive = !busy;

  // Online: I always see my own cards face up, opponent face down
  // vs-cpu: player1 face up, player2 face down
  // vs-player: current turn face up, other face down
  let showP1Cards: boolean;
  let showP2Cards: boolean;
  let canP1Play: boolean;
  let canP2Play: boolean;

  if (isOnline) {
    showP1Cards = mySide === 'player1';
    showP2Cards = mySide === 'player2';
    canP1Play = mySide === 'player1' && game.currentTurn === 'player1' && isCurrentTurnActive;
    canP2Play = mySide === 'player2' && game.currentTurn === 'player2' && isCurrentTurnActive;
  } else if (isCpuMode) {
    showP1Cards = true;
    showP2Cards = false;
    canP1Play = game.currentTurn === 'player1' && isCurrentTurnActive;
    canP2Play = false;
  } else {
    showP1Cards = game.currentTurn === 'player1';
    showP2Cards = game.currentTurn === 'player2';
    canP1Play = game.currentTurn === 'player1' && isCurrentTurnActive;
    canP2Play = game.currentTurn === 'player2' && isCurrentTurnActive;
  }

  // In online mode, flip layout: the "me" player is always at the bottom
  const topSide: PlayerSide = isOnline ? otherSide(mySide) : 'player2';
  const bottomSide: PlayerSide = isOnline ? mySide : 'player1';
  const topPlayer = game[topSide];
  const bottomPlayer = game[bottomSide];
  const showTopCards = topSide === 'player1' ? showP1Cards : showP2Cards;
  const showBottomCards = bottomSide === 'player1' ? showP1Cards : showP2Cards;
  const canTopPlay = topSide === 'player1' ? canP1Play : canP2Play;
  const canBottomPlay = bottomSide === 'player1' ? canP1Play : canP2Play;
  const canChooseCapture =
    !!game.possibleCaptures &&
    !!game.selectedCard &&
    isCurrentTurnActive &&
    (!isOnline || game.currentTurn === mySide);
  const visibleHandCount = (side: PlayerSide, actual: number): number =>
    isOnline && !onlineManager.isHost && side !== mySide ? onlineHandCounts[side] : actual;

  const topLabel = isOnline
    ? (topSide === 'player1'
      ? (game.player1.name || 'Joueur 1')
      : (game.player2.name || 'Joueur 2'))
    : (isCpuMode ? '🤖 Ordinateur' : '👤 Joueur 2');

  const bottomLabel = isOnline
    ? (bottomSide === 'player1'
      ? (game.player1.name || 'Joueur 1')
      : (game.player2.name || 'Joueur 2'))
    : (isCpuMode ? '👤 Vous' : '👤 Joueur 1');

  const isMyTurn = isOnline ? game.currentTurn === mySide : undefined;
  const p1HeaderLabel = isOnline ? (game.player1.name || 'Joueur 1') : (isCpuMode ? 'Vous' : 'J1');
  const p2HeaderLabel = isOnline ? (game.player2.name || 'Joueur 2') : (isCpuMode ? 'PC' : 'J2');
  const turnTimerKey = `${game.currentTurn}:${game.player1.hand.length}:${game.player2.hand.length}:${game.player1.captured.length}:${game.player2.captured.length}:${game.table.map((card) => card.id).join(',')}`;
  const timerActive = game.phase === 'playing' && !busy && !game.showChkoba && (!isOnline || onlinePhase === 'connected');
  const timerIsAuthoritative = !isOnline || onlineManager.isHost;

  return (
    <div className="premium-screen safe-area premium-entrance gameplay-screen text-white select-none">
      <div className="game-mosaic-rail game-mosaic-rail--left" aria-hidden="true" />
      <div className="game-mosaic-rail game-mosaic-rail--right" aria-hidden="true" />
      <div className="game-cafe-cup" aria-hidden="true" />
      <div className="game-brass-charm" aria-hidden="true">◆</div>
      {/* Chkoba overlay */}
      {game.showChkoba && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="chkoba-celebration">
            <span>♠ ◆ ♥</span>
            <strong>CHKOBA</strong>
            <small>Prise parfaite</small>
          </div>
        </div>
      )}

      {captureFx && (
        <div className="capture-fx-wrap" key={captureFx.key}>
          <div className="capture-fx-stage">
            <div className="capture-fx-captured">
              {captureFx.capturedCards.map((c, i) => (
                <div key={`${captureFx.key}-${c.id}-${i}`} className="capture-fx-card" style={{ ['--i' as any]: i }}>
                  <span className="capture-fx-trail" />
                  <CardComponent card={c} small />
                </div>
              ))}
            </div>
            <div className="capture-fx-played">
              <CardComponent card={captureFx.playedCard} />
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="premium-panel game-hud px-2 py-1.5 flex items-center gap-2 whitespace-nowrap overflow-hidden">
          <span className="game-hud-suits text-base leading-none shrink-0">♠ <b>♥</b> <b>♦</b> ♣</span>
          <div className="flex items-center gap-1 min-w-0 flex-1 justify-center text-xs">
            <div className="premium-chip rounded-md px-1.5 py-1">
              <span className="text-green-300">{p1HeaderLabel}:</span>{' '}
              <span className={cn("font-bold text-amber-300 inline-block", scoreFx.p1 && "score-pop")}>{game.player1Score}</span>
            </div>
            <div className="premium-chip rounded-md px-1.5 py-1">
              <span className="text-green-300">{p2HeaderLabel}:</span>{' '}
              <span className={cn("font-bold text-red-300 inline-block", scoreFx.p2 && "score-pop")}>{game.player2Score}</span>
            </div>
          </div>
          <TurnTimer
            compact
            turnKey={turnTimerKey}
            active={timerActive}
            onExpire={timerIsAuthoritative ? handleTurnExpired : undefined}
          />
          <button
            onClick={requestQuitGame}
            className="text-green-400 hover:text-white text-xs hover:bg-green-700/50 rounded px-2 py-1 transition-colors shrink-0"
          >
            Quitter
          </button>
        </header>

      <QuitConfirmModal
        open={showQuitConfirm}
        online={isOnline}
        onCancel={() => setShowQuitConfirm(false)}
        onConfirm={confirmQuitGame}
      />

      {achievementToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] premium-panel rounded-full px-4 py-2 text-amber-200 text-sm font-bold">
          {achievementToast}
        </div>
      )}

      {/* Top player area */}
      <section className={cn("game-player-zone game-player-zone--opponent px-4 py-2", game.currentTurn === topSide && "game-player-zone--active")}>
        <div className="game-player-meta flex items-center gap-2 mb-1">
          <span className="text-sm text-green-300">
            {isOnline ? '🌐 ' : ''}{topLabel}
          </span>
          <span className="text-xs text-green-500">
            ({topPlayer.captured.length} cartes | {topPlayer.chkobas} chkoba{topPlayer.chkobas !== 1 ? 's' : ''})
          </span>
          {game.currentTurn === topSide && isCpuMode && busy && (
            <span className="text-xs bg-red-500/80 rounded-full px-2 py-0.5 animate-pulse">
              Réflexion...
            </span>
          )}
          {game.currentTurn === topSide && !isCpuMode && (
            <span className="text-xs bg-blue-500/80 rounded-full px-2 py-0.5">
              Son tour
            </span>
          )}
        </div>
        <div className="game-card-row stagger-row flex gap-2 justify-center min-h-[68px] items-center">
          {showTopCards ? (
            topPlayer.hand.map((card: Card) => (
              <CardComponent
                key={card.id}
                card={card}
                onClick={() => canTopPlay && handlePlayCard(card, topSide)}
                selected={game.selectedCard?.id === card.id}
                disabled={!canTopPlay}
              />
            ))
          ) : (
            Array.from({ length: visibleHandCount(topSide, topPlayer.hand.length) }, (_, i) => <CardBack key={i} />)
          )}
          {visibleHandCount(topSide, topPlayer.hand.length) === 0 && (
            <div className="text-green-600 text-sm italic">Pas de cartes</div>
          )}
        </div>
      </section>

      {/* Table */}
      <main className="game-table-zone px-4 py-2">
        <div className="game-table-surface rounded-2xl p-4 relative">
          <div className="game-table-label absolute -top-3 left-1/2 -translate-x-1/2 premium-chip text-green-200 text-xs px-3 py-1 rounded-full">
            Table ({game.table.length} carte{game.table.length !== 1 ? 's' : ''})
          </div>

          <div className="game-table-cards stagger-row flex flex-wrap gap-2 justify-center items-center pt-2 min-h-[80px]">
            {game.table.length === 0 ? (
              <div className="text-green-600 text-sm italic py-8">Table vide</div>
            ) : (
              game.table.map((card: Card) => {
                const isInCapture = game.possibleCaptures?.some((group: Card[]) =>
                  group.some((c: Card) => c.id === card.id)
                ) ?? false;
                return (
                  <CardComponent
                    key={card.id}
                    card={card}
                    highlighted={isInCapture}
                    onClick={() => {
                      if (!canChooseCapture) return;
                      if (game.possibleCaptures && game.selectedCard) {
                        const match = game.possibleCaptures.find((group: Card[]) =>
                          group.some((c: Card) => c.id === card.id)
                        );
                        if (match) handleCaptureChoice(match);
                      }
                    }}
                  />
                );
              })
            )}
          </div>

          {/* Capture choice buttons */}
          {game.possibleCaptures && game.possibleCaptures.length > 1 && (
            <div className="mt-3 pt-3 border-t border-green-600/20">
              <p className="text-xs text-amber-300 mb-2">Choisissez un groupe à capturer :</p>
              <div className="flex flex-wrap gap-3 justify-center">
                {game.possibleCaptures.map((group: Card[], i: number) => (
                  <button
                    key={i}
                    onClick={() => handleCaptureChoice(group)}
                    disabled={!canChooseCapture}
                    className="flex gap-1 bg-green-600/40 hover:bg-amber-600/50 rounded-lg p-2 border border-green-500/30 hover:border-amber-400 transition-colors"
                  >
                    {group.map((c: Card) => (
                      <CardComponent key={c.id} card={c} small />
                    ))}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Message */}
      <div className="game-status-zone px-4 py-1">
        <div className={cn(
          "game-status text-center text-sm py-2 px-4 rounded-lg transition-colors",
          game.lastAction.includes('chkoba')
            ? 'bg-amber-500/30 text-amber-200 font-bold'
            : 'bg-black/20 text-green-200',
          isOnline && isMyTurn === false && 'bg-blue-900/30 text-blue-200',
          isOnline && isMyTurn === true && 'bg-emerald-900/30 text-emerald-200',
        )}>
          {isOnline && isMyTurn !== undefined && (
            <span className="mr-2">{isMyTurn ? '🟢 Votre tour !' : '🔵 Tour adverse...'}</span>
          )}
          {game.message}
        </div>
      </div>

      {/* Bottom player area (Me) */}
      <section className={cn("game-player-zone game-player-zone--local px-4 py-3", game.currentTurn === bottomSide && "game-player-zone--active")}>
        <div className="game-player-meta flex items-center gap-2 mb-1">
          <span className="text-sm text-amber-300">
            {isOnline ? '👤 ' : '👤 '}{bottomLabel}
          </span>
          <span className="text-xs text-green-500">
            ({bottomPlayer.captured.length} cartes | {bottomPlayer.chkobas} chkoba{bottomPlayer.chkobas !== 1 ? 's' : ''})
          </span>
          {canBottomPlay && (
            <span className="text-xs bg-green-500/80 rounded-full px-2 py-0.5">
              {isCpuMode ? 'Votre tour' : isOnline ? 'Votre tour' : 'Son tour'}
            </span>
          )}
        </div>
        <div className="game-card-row game-card-row--local stagger-row flex gap-3 justify-center min-h-[80px] items-center">
          {showBottomCards ? (
            bottomPlayer.hand.map((card: Card) => (
              <CardComponent
                key={card.id}
                card={card}
                onClick={() => canBottomPlay && handlePlayCard(card, bottomSide)}
                selected={game.selectedCard?.id === card.id}
                disabled={!canBottomPlay}
              />
            ))
          ) : (
            Array.from({ length: visibleHandCount(bottomSide, bottomPlayer.hand.length) }, (_, i) => <CardBack key={i} />)
          )}
          {visibleHandCount(bottomSide, bottomPlayer.hand.length) === 0 && (
            <div className="text-green-600 text-sm italic">
              {game.deck.length > 0 ? 'Distribution en cours...' : 'Fin du round...'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

/* =================== SUB-SCREENS =================== */

const SAMPLE_CARDS: Card[] = [
  { suit: 'pique', rank: 1, id: 'sample-s1' },
  { suit: 'coeur', rank: 10, id: 'sample-h10' },
  { suit: 'carreau', rank: 7, id: 'sample-d7' },
  { suit: 'trefle', rank: 9, id: 'sample-c9' },
];

// ---- Menu Screen ----
const MenuScreen: React.FC<{
  onStart: (mode: GameMode, targetScore: ScoreTarget) => void;
  onStart2v2Online: (targetScore: ScoreTarget) => void;
  onAddMatchEntry: () => void;
  rewardedAdOpen: boolean;
  matchEntryToast: string | null;
  matchEntryError: string | null;
  visualTheme: VisualTheme;
  availableMatches: number;
  onSetTheme: (t: VisualTheme) => void;
  showOnboarding: boolean;
  onCloseOnboarding: () => void;
  unlocked: AchievementId[];
}> = ({ onStart, onStart2v2Online, onAddMatchEntry, rewardedAdOpen, matchEntryToast, matchEntryError, visualTheme, availableMatches, onSetTheme, showOnboarding, onCloseOnboarding, unlocked }) => (
  <MenuScreenContent
    onStart={onStart}
    onStart2v2Online={onStart2v2Online}
    onAddMatchEntry={onAddMatchEntry}
    rewardedAdOpen={rewardedAdOpen}
    matchEntryToast={matchEntryToast}
    matchEntryError={matchEntryError}
    visualTheme={visualTheme}
    availableMatches={availableMatches}
    onSetTheme={onSetTheme}
    showOnboarding={showOnboarding}
    onCloseOnboarding={onCloseOnboarding}
    unlocked={unlocked}
  />
);

const MenuScreenContent: React.FC<{
  onStart: (mode: GameMode, targetScore: ScoreTarget) => void;
  onStart2v2Online: (targetScore: ScoreTarget) => void;
  onAddMatchEntry: () => void;
  rewardedAdOpen: boolean;
  matchEntryToast: string | null;
  matchEntryError: string | null;
  visualTheme: VisualTheme;
  availableMatches: number;
  onSetTheme: (t: VisualTheme) => void;
  showOnboarding: boolean;
  onCloseOnboarding: () => void;
  unlocked: AchievementId[];
}> = ({ onStart, onStart2v2Online, onAddMatchEntry, rewardedAdOpen, matchEntryToast, matchEntryError, visualTheme, availableMatches, onSetTheme, showOnboarding, onCloseOnboarding, unlocked }) => {
  const [menuScreen, setMenuScreen] = useState<'home' | 'online' | 'classic' | 'themes' | 'rules' | 'settings'>('home');

  const launchOnline1v1 = () => {
    onStart('online', 11);
  };

  const launchOnline2v2 = () => {
    onStart2v2Online(11);
  };

  const launchClassicVsCpu = (targetScore: ScoreTarget) => {
    onStart('vs-cpu', targetScore);
  };

  const launchClassicVsLocal = (targetScore: ScoreTarget) => {
    onStart('vs-player', targetScore);
  };

  const openOnlineMenu = () => {
    setMenuScreen('online');
  };

  if (menuScreen === 'online') {
    return (
      <>
        <OnlineMenuScreen
          onBack={() => setMenuScreen('home')}
          onPlay1v1={launchOnline1v1}
          onPlay2v2={launchOnline2v2}
        />
        <BannerAd />
      </>
    );
  }

  if (menuScreen === 'classic') {
    return (
      <>
        <ClassicMenuScreen
          onBack={() => setMenuScreen('home')}
          onPlaySolo={launchClassicVsCpu}
          onPlayLocal={launchClassicVsLocal}
        />
        <BannerAd />
      </>
    );
  }

  if (menuScreen === 'themes') {
    return (
      <>
        <ThemesScreen
          visualTheme={visualTheme}
          onSetTheme={onSetTheme}
          onBack={() => setMenuScreen('home')}
        />
        <BannerAd />
      </>
    );
  }

  if (menuScreen === 'rules') {
    return <><RulesScreen onBack={() => setMenuScreen('home')} /><BannerAd /></>;
  }

  if (menuScreen === 'settings') {
    return (
      <>
        <SettingsScreen
          unlocked={unlocked}
          onBack={() => setMenuScreen('home')}
        />
        <BannerAd />
      </>
    );
  }

  return (
    <NonGameScreen className="home-menu-screen premium-entrance" contentClassName="home-menu-content">
      {showOnboarding && (
        <div className="non-game-modal-backdrop z-[60]">
          <div className="non-game-modal max-w-md">
            <p className="non-game-kicker">Ahlan wa sahlan</p>
            <h3 className="non-game-modal__title">Bienvenue dans Chkoba</h3>
            <div className="space-y-3 text-sm text-green-100/90">
              <div className="onboarding-feature"><span>♠</span> Jouez en solo, en local ou avec vos amis à distance.</div>
              <div className="onboarding-feature"><span>✦</span> Choisissez un univers visuel classique, doré ou royal.</div>
              <div className="onboarding-feature"><span>♪</span> Profitez des sons et retours tactiles à chaque action clé.</div>
            </div>
            <button
              onClick={onCloseOnboarding}
              className="non-game-primary-button mt-5 w-full"
            >
              Entrer dans le jeu
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col min-h-[calc(100dvh-1rem)]">
        <div className="home-profile-bar">
          <div className="flex items-center gap-2 min-w-0">
            <div className="home-avatar">
              <UiIcon name="profile" size={25} />
            </div>
            <div className="min-w-0">
              <p className="home-profile-label">Profil joueur</p>
              <p className="home-profile-name">Invité</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="home-ticket-badge" aria-label={`${availableMatches} parties disponibles`}>
              <UiIcon name="ticket" size={19} />
              <strong>{availableMatches}</strong>
            </div>
            <button
              onClick={onAddMatchEntry}
              className="home-header-button home-header-button--add"
              aria-label="Gagner une partie"
              title="Regarder une vidéo pour gagner une partie"
              disabled={rewardedAdOpen}
            >
              <UiIcon name="plus" size={19} />
            </button>
            <button
              onClick={() => setMenuScreen('settings')}
              className="home-header-button"
              aria-label="Paramètres"
            >
              <UiIcon name="settings" size={20} />
            </button>
          </div>
        </div>

        {matchEntryError && (
          <div className="non-game-alert non-game-alert--error mb-4">
            <span aria-hidden="true">!</span> {matchEntryError}
          </div>
        )}

        <section className="home-brand-stage">
          <div className="home-brand-suits" aria-hidden="true"><span>♠</span><b>♥</b><b>♦</b><span>♣</span></div>
          <p className="non-game-kicker">Le jeu de cartes tunisien</p>
          <h1 className="home-brand-title">CHKOBA</h1>
          <p className="home-brand-arabic" lang="ar">شكبة</p>
          <div className="home-card-fan" aria-label="Cartes de Chkoba">
            {SAMPLE_CARDS.slice(0, 3).map((card) => (
              <CardComponent key={card.id} card={card} small />
            ))}
          </div>
        </section>

        <div className="home-action-stack">
          <MenuActionCard
            onClick={openOnlineMenu}
            title="Jouer en ligne"
            subtitle="1v1 et 2v2 à distance"
            icon={<UiIcon name="online" size={27} />}
            tone="online"
          />

          <MenuActionCard
            onClick={() => setMenuScreen('classic')}
            title="Jouer classique"
            subtitle="Solo ou à deux sur le même appareil"
            icon={<UiIcon name="cards" size={27} />}
            tone="classic"
          />
        </div>

        <div className="home-secondary-nav">
          <button
            onClick={() => setMenuScreen('themes')}
            className="non-game-secondary-button"
          >
            <UiIcon name="theme" size={18} /> Thèmes
          </button>
          <button
            onClick={() => setMenuScreen('rules')}
            className="non-game-secondary-button"
          >
            <UiIcon name="rules" size={18} /> Règles
          </button>
        </div>

        <div className="home-signature mt-auto">
          <span aria-hidden="true" />
          <p>Conçu en Tunisie</p>
          <span aria-hidden="true" />
        </div>

        <BannerAd />

        {matchEntryToast && (
          <div className="non-game-toast">
            {matchEntryToast}
          </div>
        )}
      </div>

    </NonGameScreen>
  );
};

const MenuSubScreenShell: React.FC<{ title: string; subtitle: string; onBack: () => void; children: React.ReactNode }> = ({
  title,
  subtitle,
  onBack,
  children,
}) => (
  <NonGameScreen className="menu-selection-screen" contentClassName="non-game-page-pad">
      <BackButton onClick={onBack} />
      <NonGameHero title={title} subtitle={subtitle} eyebrow="Chkoba" compact />
      {children}
  </NonGameScreen>
);

const ThemesScreen: React.FC<{
  visualTheme: VisualTheme;
  onSetTheme: (t: VisualTheme) => void;
  onBack: () => void;
}> = ({ visualTheme, onSetTheme, onBack }) => (
  <MenuSubScreenShell
    title="Thèmes"
    subtitle="Personnalisez l'apparence du jeu"
    onBack={onBack}
  >
    <div className="non-game-settings-panel">
      {(['classic', 'gold', 'royal'] as VisualTheme[]).map((t) => (
        <button
          key={t}
          onClick={() => onSetTheme(t)}
          className={cn(
            "theme-choice",
            `theme-choice--${t}`,
            visualTheme === t && "theme-choice--active"
          )}
        >
          <span className="theme-choice__swatch" aria-hidden="true" />
          <span><strong>{t === 'classic' ? 'Classique' : t === 'gold' ? 'Or' : 'Royal'}</strong><small>{t === 'classic' ? 'Vert profond et laiton' : t === 'gold' ? 'Bois chaud et lumière dorée' : 'Bleu nuit méditerranéen'}</small></span>
          {visualTheme === t && <b>Actif</b>}
        </button>
      ))}
    </div>
  </MenuSubScreenShell>
);

const RulesScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <MenuSubScreenShell
    title="Règles"
    subtitle="Principes de base de la Chkoba tunisienne"
    onBack={onBack}
  >
    <div className="non-game-settings-panel rules-panel">
      <ul>
        <li>
          <span>01</span>
          <span>40 cartes : ♠ Pique, ♥ Cœur, ♦ Carreau, ♣ Trèfle</span>
        </li>
        <li>
          <span>02</span>
          <span>Valeurs : As (1), 2 à 7, Dame (8), Valet (9), Roi (10)</span>
        </li>
        <li>
          <span>03</span>
          <span>Capture : somme égale à la carte jouée</span>
        </li>
        <li>
          <span>04</span>
          <span>Chkoba : table vidée = +1 point</span>
        </li>
      </ul>
    </div>
  </MenuSubScreenShell>
);

const SettingsScreen: React.FC<{ unlocked: AchievementId[]; onBack: () => void }> = ({ unlocked, onBack }) => (
  <MenuSubScreenShell
    title="Paramètres"
    subtitle="Progression et personnalisation"
    onBack={onBack}
  >
    <div className="non-game-settings-panel achievements-panel">
      <h4>Progression</h4>
      <div className="achievement-list">
        {ACHIEVEMENTS.map((a) => {
          const done = unlocked.includes(a.id);
          return (
            <div key={a.id} className={cn("achievement-item", done && "achievement-item--done")}>
              <span>{done ? "✓" : "·"}</span>
              <div><strong>{a.title}</strong><small>{a.description}</small></div>
            </div>
          );
        })}
      </div>
    </div>
  </MenuSubScreenShell>
);

// ---- Online Lobby Screen ----
const OnlineLobbyScreen: React.FC<{
  onlinePhase: OnlinePhase;
  roomCode: string;
  joinCode: string;
  onlineError: string;
  playerName: string;
  copied: boolean;
  availableMatches: number;
  showNotEnoughMatchEntries: boolean;
  onShowNotEnoughMatchEntries: () => void;
  onDismissNotEnoughMatchEntries: () => void;
  onSetPlayerName: (n: string) => void;
  onSetJoinCode: (c: string) => void;
  onCreateRoom: (targetScore: ScoreTarget) => void;
  onJoinRoom: () => void;
  onCopyCode: () => void;
  onAddMatchEntry: () => void;
  rewardedAdOpen: boolean;
  matchEntryToast: string | null;
  matchEntryError: string | null;
  onBack: () => void;
}> = ({ onlinePhase, roomCode, joinCode, onlineError, playerName, copied, availableMatches, showNotEnoughMatchEntries, onShowNotEnoughMatchEntries, onDismissNotEnoughMatchEntries, onSetPlayerName, onSetJoinCode, onCreateRoom, onJoinRoom, onCopyCode, onAddMatchEntry, rewardedAdOpen, matchEntryToast, matchEntryError, onBack }) => {
  const [showCreateScorePicker, setShowCreateScorePicker] = useState(false);
  const handleCreateClick = () => {
    if (availableMatches < ONLINE_MATCH_COST) {
      onShowNotEnoughMatchEntries();
      return;
    }
    setShowCreateScorePicker(true);
  };
  const chooseCreateScore = (targetScore: ScoreTarget) => {
    setShowCreateScorePicker(false);
    onCreateRoom(targetScore);
  };

  return (
  <NonGameScreen className="online-lobby-screen" contentClassName="online-lobby-content non-game-page-pad">
    <NonGameHero
      icon={<span className="mode-mark">1×1</span>}
      eyebrow="Salon privé"
      title="1v1 en ligne"
      subtitle="Invitez un ami et disputez un duel à distance."
      compact
    />

    {(onlinePhase === 'idle' || onlinePhase === 'error') && (
      <div className="lobby-balance-wrap">
        <div className="lobby-balance">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lobby-balance__icon" aria-hidden="true"><UiIcon name="ticket" size={20} /></span>
            <span className="lobby-balance__copy"><small>Votre solde</small><strong>{availableMatches} partie{availableMatches > 1 ? 's' : ''}</strong></span>
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

    <div className="lobby-field-group">
      <label className="lobby-label" htmlFor="online-player-name"><span>01</span> Votre pseudo</label>
      <input
        id="online-player-name"
        type="text"
        value={playerName}
        onChange={(e) => onSetPlayerName(e.target.value)}
        placeholder="Entrez votre pseudo..."
        maxLength={20}
        className="lobby-input"
      />
    </div>

    {onlinePhase === 'idle' || onlinePhase === 'error' ? (
      <div className="lobby-actions">
        <button
          onClick={handleCreateClick}
          className="lobby-create-card"
        >
          <span className="lobby-create-card__icon" aria-hidden="true"><UiIcon name="plus" size={25} /></span>
          <span className="lobby-create-card__copy"><strong>Créer une partie</strong><small>Recevez un code à partager</small></span>
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
              type="text"
              value={joinCode}
              onChange={(e) => onSetJoinCode(onlineManager.normalizeRoomCode(e.target.value))}
              placeholder="CODE SALON"
              maxLength={ROOM_CODE_LENGTH}
              className="lobby-input lobby-code-input"
              aria-label="Code du salon"
            />
            <button
              onClick={onJoinRoom}
              className="lobby-join-button"
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
    ) : onlinePhase === 'creating' || onlinePhase === 'joining' ? (
      <div className="lobby-state-card">
        <div className="lobby-loader" aria-hidden="true" />
        <p>
          {onlinePhase === 'creating' ? 'Création du salon...' : 'Connexion en cours...'}
        </p>
      </div>
    ) : onlinePhase === 'waiting' ? (
      <div className="lobby-state-card lobby-waiting-card">
          <div className="lobby-waiting-mark" aria-hidden="true"><span /></div>
          <h2>En attente d'un adversaire</h2>
          <p>Partagez ce code avec votre ami</p>
          
          <div className="lobby-room-row">
              <div className="lobby-room-code">
                {roomCode}
              </div>
              <button
                onClick={onCopyCode}
                className={cn("lobby-copy-button", copied && "lobby-copy-button--copied")}
                title="Copier le code"
              >
                <UiIcon name={copied ? 'check' : 'copy'} size={20} />
              </button>
          </div>
            {copied && (
              <p className="lobby-copied animate-bounce-in">Code copié !</p>
            )}

          <div className="lobby-live-status">
            <i />
            <span>En attente de connexion...</span>
          </div>
      </div>
    ) : onlinePhase === 'disconnected' ? (
      <div className="lobby-state-card lobby-state-card--error">
        <UiIcon name="link" size={34} className="mb-3" />
        <p>L'adversaire s'est déconnecté</p>
      </div>
    ) : onlinePhase === 'connected' ? (
      <div className="lobby-state-card">
        <div className="lobby-loader" aria-hidden="true" />
        <p>Synchronisation de la partie...</p>
      </div>
    ) : null}

    <button
      onClick={onBack}
      className="lobby-exit-button"
    >
      <UiIcon name="back" size={17} /> Quitter
    </button>

    <ScoreChoiceModal
      open={showCreateScorePicker}
      description="Choisissez la durée de votre duel en ligne."
      onClose={() => setShowCreateScorePicker(false)}
      onSelect={chooseCreateScore}
    />

    <NotEnoughCoinsModal
      open={showNotEnoughMatchEntries}
      title="Pas assez de parties"
      message="Vous n'avez plus de parties disponibles pour jouer en ligne."
      primaryLabel="Gagner une partie"
      secondaryLabel="Annuler"
      onCancel={onDismissNotEnoughMatchEntries}
      onEarnCoins={() => {
        feedback('button');
        onDismissNotEnoughMatchEntries();
      }}
    />

    {matchEntryToast && (
      <div className="non-game-toast">
        {matchEntryToast}
      </div>
    )}
  </NonGameScreen>
  );
};

// ---- Turn Transition Screen ----
const TurnTransitionScreen: React.FC<{ game: GameState; onReady: () => void }> = ({ game, onReady }) => {
  const nextPlayerName = game[game.currentTurn].name;
  const emoji = game.currentTurn === 'player1' ? '🔵' : '🔴';

  return (
  <div className="premium-screen safe-area min-h-screen flex flex-col items-center justify-center text-white p-6">
      {game.message && (
        <div className={cn(
          "text-center text-base py-2 px-6 rounded-lg mb-6",
          game.lastAction.includes('chkoba')
            ? 'bg-amber-500/30 text-amber-200 font-bold'
            : 'bg-black/20 text-green-200'
        )}>
          {game.message}
        </div>
      )}

      <div className="premium-panel rounded-3xl p-8 text-center max-w-sm w-full">
        <div className="text-6xl mb-4">{emoji}</div>
        <h2 className="text-2xl font-bold text-amber-300 mb-2">
          Au tour de {nextPlayerName}
        </h2>
        <p className="text-green-300 mb-2 text-sm">
          Passez le téléphone / l'écran à {nextPlayerName}
        </p>

        <div className="flex justify-center gap-4 my-4">
          <div className="bg-green-700/50 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-green-400">{game.player1.name || 'Joueur 1'}</div>
            <div className="text-xl font-bold text-amber-300">{game.player1Score}</div>
            <div className="text-xs text-green-500">{game.player1.captured.length} cartes</div>
          </div>
          <div className="bg-green-700/50 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-green-400">{game.player2.name || 'Joueur 2'}</div>
            <div className="text-xl font-bold text-red-300">{game.player2Score}</div>
            <div className="text-xs text-green-500">{game.player2.captured.length} cartes</div>
          </div>
        </div>

        <button
          onClick={onReady}
          className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-amber-950 font-bold text-lg px-10 py-3 rounded-xl shadow-lg hover:scale-105 transition-all mt-2"
        >
          ✋ Je suis prêt !
        </button>
      </div>

      <div className="mt-6 text-green-600 text-xs text-center">
        Les cartes de l'adversaire sont cachées pour éviter la triche 😉
      </div>
    </div>
  );
};

// ---- Round End Screen ----
const RoundEndScreen: React.FC<{ game: GameState; mySide: PlayerSide; onNextRound: () => void }> = ({ game, mySide, onNextRound }) => {
  const isCpu = game.mode === 'vs-cpu';
  const isOnline = game.mode === 'online';
  const p1Name = game.player1.name || 'Joueur 1';
  const p2Name = game.player2.name || 'Joueur 2';
  const p1Label = isOnline ? (mySide === 'player1' ? `👤 ${p1Name}` : `🌐 ${p1Name}`) : (isCpu ? '👤 Vous' : `🔵 ${p1Name}`);
  const p2Label = isOnline ? (mySide === 'player2' ? `👤 ${p2Name}` : `🌐 ${p2Name}`) : (isCpu ? '🤖 Ordinateur' : `🔴 ${p2Name}`);
  const cards = isOnline
    ? (mySide === 'player1'
      ? [
          { title: p1Label, score: game.roundScorePlayer1!, totalScore: game.player1Score, isPlayer: true },
          { title: p2Label, score: game.roundScorePlayer2!, totalScore: game.player2Score, isPlayer: false },
        ]
      : [
          { title: p2Label, score: game.roundScorePlayer2!, totalScore: game.player2Score, isPlayer: true },
          { title: p1Label, score: game.roundScorePlayer1!, totalScore: game.player1Score, isPlayer: false },
        ])
    : [
        { title: p1Label, score: game.roundScorePlayer1!, totalScore: game.player1Score, isPlayer: true },
        { title: p2Label, score: game.roundScorePlayer2!, totalScore: game.player2Score, isPlayer: false },
      ];

  return (
  <div className="premium-screen safe-area min-h-screen flex flex-col items-center justify-center text-white p-6">
      <h2 className="text-3xl font-bold mb-6 text-amber-300">🏁 Fin du Round</h2>

      <div className="grid grid-cols-2 gap-4 max-w-lg w-full mb-8">
        {cards.map((card, idx) => (
          <ScoreCard
            key={idx}
            title={card.title}
            score={card.score}
            totalScore={card.totalScore}
            isPlayer={card.isPlayer}
          />
        ))}
      </div>

      <button
        onClick={onNextRound}
        className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-amber-950 font-bold text-lg px-8 py-3 rounded-xl shadow-lg hover:scale-105 transition-all"
      >
        Round Suivant ➡️
      </button>
    </div>
  );
};

// ---- Game Over Screen ----
const GameOverScreen: React.FC<{ game: GameState; mySide: PlayerSide; onPlayAgain: () => void; onMenu: () => void }> = ({ game, mySide, onPlayAgain, onMenu }) => {
  const isCpu = game.mode === 'vs-cpu';
  const isOnline = game.mode === 'online';
  const p1Won = game.player1Score >= game.targetScore;
  let iWon = false;

  let title: string;
  let emoji: string;
  if (isOnline) {
    iWon = (mySide === 'player1' && p1Won) || (mySide === 'player2' && !p1Won);
    title = iWon ? 'Victoire !' : 'Défaite !';
    emoji = iWon ? '🏆' : '😢';
  } else if (isCpu) {
    iWon = p1Won;
    title = p1Won ? 'Victoire !' : 'Défaite !';
    emoji = p1Won ? '🏆' : '😢';
  } else {
    iWon = p1Won;
    title = p1Won ? 'Joueur 1 gagne !' : 'Joueur 2 gagne !';
    emoji = '🏆';
  }

  const p1Name = game.player1.name || 'Joueur 1';
  const p2Name = game.player2.name || 'Joueur 2';
  const p1Label = isOnline ? (mySide === 'player1' ? `👤 ${p1Name}` : `🌐 ${p1Name}`) : (isCpu ? '👤 Vous' : `🔵 ${p1Name}`);
  const p2Label = isOnline ? (mySide === 'player2' ? `👤 ${p2Name}` : `🌐 ${p2Name}`) : (isCpu ? '🤖 Ordinateur' : `🔴 ${p2Name}`);
  const scoreCards = isOnline
    ? (mySide === 'player1'
      ? [
          { title: p1Label, score: game.roundScorePlayer1!, totalScore: game.player1Score, isPlayer: true },
          { title: p2Label, score: game.roundScorePlayer2!, totalScore: game.player2Score, isPlayer: false },
        ]
      : [
          { title: p2Label, score: game.roundScorePlayer2!, totalScore: game.player2Score, isPlayer: true },
          { title: p1Label, score: game.roundScorePlayer1!, totalScore: game.player1Score, isPlayer: false },
        ])
    : [
        { title: p1Label, score: game.roundScorePlayer1!, totalScore: game.player1Score, isPlayer: true },
        { title: p2Label, score: game.roundScorePlayer2!, totalScore: game.player2Score, isPlayer: false },
      ];

  return (
    <div className="premium-screen safe-area min-h-screen flex flex-col items-center justify-center text-white p-6">
      <VictoryCinematic active={iWon} />
      <div className="text-6xl mb-4">{emoji}</div>
      <h2 className={cn(
        "text-4xl font-black mb-2",
        (isOnline ? ((mySide === 'player1' && p1Won) || (mySide === 'player2' && !p1Won)) : p1Won) ? "text-amber-300" : "text-red-400"
      )}>
        {title}
      </h2>
      <p className="text-green-300 mb-8 text-lg">
        {isOnline && mySide === 'player2'
          ? `${game.player2Score} - ${game.player1Score}`
          : `${game.player1Score} - ${game.player2Score}`}
      </p>

      {game.roundScorePlayer1 && game.roundScorePlayer2 && (
        <div className="grid grid-cols-2 gap-4 max-w-lg w-full mb-8">
          {scoreCards.map((card, idx) => (
            <ScoreCard
              key={idx}
              title={card.title}
              score={card.score!}
              totalScore={card.totalScore}
              isPlayer={card.isPlayer}
            />
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={onPlayAgain}
          className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-amber-950 font-bold text-lg px-8 py-3 rounded-xl shadow-lg hover:scale-105 transition-all"
        >
          🔄 Rejouer
        </button>
        <button
          onClick={onMenu}
          className="bg-green-700 hover:bg-green-600 text-white font-bold text-lg px-8 py-3 rounded-xl shadow-lg hover:scale-105 transition-all"
        >
          🏠 Quitter
        </button>
      </div>
    </div>
  );
};

const VictoryCinematic: React.FC<{ active: boolean }> = ({ active }) => {
  if (!active) return null;
  const colors = ['#ffd166', '#fca311', '#06d6a0', '#4cc9f0', '#f72585'];
  return (
    <div className="confetti-wrap" aria-hidden>
      {Array.from({ length: 48 }).map((_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${(i * 97) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 12) * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
};

// ---- Score Card ----
const ScoreCard: React.FC<{ title: string; score: Score; totalScore: number; isPlayer: boolean }> = ({ title, score, totalScore, isPlayer }) => (
  <div className={cn(
    "rounded-xl p-4 border",
    isPlayer ? "bg-green-700/40 border-green-500/30" : "bg-red-900/30 border-red-500/30"
  )}>
    <h3 className="font-bold text-lg mb-3">{title}</h3>
    <div className="space-y-1 text-sm">
      <ScoreRow label="🃏 Cartes" value={`${score.cards}`} point={score.cards > 20 ? 1 : 0} />
      <ScoreRow label="♦ Carreaux" value={`${score.carreaux}`} point={score.carreaux > 5 ? 1 : 0} />
      <ScoreRow label="7♦" value={score.septCarreau ? '✅' : '❌'} point={score.septCarreau} />
      <ScoreRow label="Bermila" value={score.bermila ? '✅' : '❌'} point={score.bermila} />
      <ScoreRow label="Chkoba" value={`${score.chkobas}`} point={score.chkobas} />
      <div className="border-t border-white/20 mt-2 pt-2">
        <div className="flex justify-between font-bold">
          <span>Round</span>
          <span className="text-amber-300">+{score.total}</span>
        </div>
        <div className="flex justify-between font-bold text-lg">
          <span>Total</span>
          <span className={isPlayer ? "text-amber-300" : "text-red-300"}>{totalScore}</span>
        </div>
      </div>
    </div>
  </div>
);

const ScoreRow: React.FC<{ label: string; value: string; point: number }> = ({ label, value, point }) => (
  <div className="flex justify-between">
    <span className="text-green-300">{label}</span>
    <span>
      {value}
      {point > 0 && <span className="text-amber-400 ml-1">(+{point})</span>}
    </span>
  </div>
);

export default ChkobaGame;
