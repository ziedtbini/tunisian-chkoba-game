import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, GameState, Score, GameMode, PlayerSide, OnlinePhase, OnlineMessage } from './types';
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

type VisualTheme = 'classic' | 'gold' | 'royal';
type ScoreTarget = 11 | 21;
type CaptureFx = { key: number; playedCard: Card; capturedCards: Card[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string')) return null;
  return value as string[];
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

  // Online state
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const [mySide, setMySide] = useState<PlayerSide>('player1');
  const [playerName, setPlayerName] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [showOnlineLobby, setShowOnlineLobby] = useState(false);
  const [onlineTargetScore, setOnlineTargetScore] = useState<ScoreTarget>(11);
  const [copied, setCopied] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem('chkoba-onboarding-v2') !== 'done');
  const [unlocked, setUnlocked] = useState<AchievementId[]>(() => getUnlockedAchievements());
  const [achievementToast, setAchievementToast] = useState<string | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [captureFx, setCaptureFx] = useState<CaptureFx | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    setupAudioUnlock();
  }, []);

  useEffect(() => {
    localStorage.setItem('chkoba-theme', visualTheme);
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove('theme-classic', 'theme-gold', 'theme-royal');
    root.classList.add(`theme-${visualTheme}`);
    body.classList.remove('theme-classic', 'theme-gold', 'theme-royal');
    body.classList.add(`theme-${visualTheme}`);
  }, [visualTheme]);

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

  // ---- Online message handler ----
  const handleOnlineMessage = useCallback((msg: OnlineMessage) => {
    switch (msg.type) {
      case 'game-state':
        setGame(msg.payload as GameState);
        setBusy(false);
        break;
      case 'play-card': {
        // The host processes the card play and sends back the new state
        // Only the host processes game logic
        if (onlineManager.isHost) {
          const cardId = isObject(msg.payload) ? readString(msg.payload.cardId) : null;
          if (!cardId) break;
          setGame(prev => {
            if (!prev || prev.phase !== 'playing') return prev;
            // In 1v1 online, remote peer is always player2.
            if (prev.currentTurn !== 'player2') return prev;
            const who = prev.currentTurn;
            const actor = prev[who];
            const card = actor.hand.find((c: Card) => c.id === cardId);
            if (!card) return prev;

            const captures = findCaptures(card, prev.table);
            if (captures.length === 0) {
              const newHand = actor.hand.filter((c: Card) => c.id !== card.id);
              const nextTurn = otherSide(who);
              const newState: GameState = {
                ...prev,
                [who]: { ...actor, hand: newHand },
                table: [...prev.table, card],
                selectedCard: null,
                possibleCaptures: null,
                currentTurn: nextTurn,
                phase: 'playing',
                message: `${actor.name} a posé ${cardName(card)} sur la table.`,
                lastAction: 'drop',
                showChkoba: null,
              };
              onlineManager.send({ type: 'game-state', payload: newState });
              return newState;
            }
            if (captures.length === 1) {
              const newState = doCapture(prev, card, captures[0], who);
              onlineManager.send({ type: 'game-state', payload: newState });
              return newState;
            }
            // Multiple captures - send back to let the player choose
            const stateWithChoices: GameState = {
              ...prev,
              selectedCard: card,
              possibleCaptures: captures,
              message: `${actor.name} choisit les cartes à capturer...`,
            };
            onlineManager.send({ type: 'game-state', payload: stateWithChoices });
            return stateWithChoices;
          });
        }
        break;
      }
      case 'capture-choice': {
        if (onlineManager.isHost) {
          const captureIds = isObject(msg.payload) ? readStringArray(msg.payload.captureIds) : null;
          if (!captureIds) break;
          setGame(prev => {
            if (!prev || !prev.selectedCard) return prev;
            // In 1v1 online, remote peer is always player2.
            if (prev.currentTurn !== 'player2') return prev;
            const capture = prev.table.filter((c: Card) => captureIds.includes(c.id));
            if (capture.length === 0) return prev;
            const newState = doCapture(prev, prev.selectedCard, capture, prev.currentTurn);
            onlineManager.send({ type: 'game-state', payload: newState });
            return newState;
          });
        }
        break;
      }
      case 'next-round': {
        if (onlineManager.isHost) {
          setGame(prev => {
            if (!prev) return null;
            const newState = initializeRound(prev.player1Score, prev.player2Score, prev.targetScore, 'online');
            onlineManager.send({ type: 'game-state', payload: newState });
            return newState;
          });
        }
        break;
      }
      case 'play-again': {
        if (onlineManager.isHost) {
          setGame(prev => {
            const target = (prev?.targetScore as ScoreTarget | undefined) ?? onlineTargetScore;
            const newState = initializeRound(0, 0, target, 'online');
            onlineManager.send({ type: 'game-state', payload: newState });
            return newState;
          });
        }
        break;
      }
      case 'player-name': {
        const name = isObject(msg.payload) ? readString(msg.payload.name) : null;
        const resolved = name || '';
        setOpponentName(resolved);
        setGame(prev => {
          if (!prev || !resolved) return prev;
          const updated = onlineManager.isHost
            ? { ...prev, player2: { ...prev.player2, name: resolved } }
            : { ...prev, player1: { ...prev.player1, name: resolved } };
          if (onlineManager.isHost) {
            onlineManager.send({ type: 'game-state', payload: updated });
          }
          return updated;
        });
        break;
      }
      case 'sync-request': {
        if (onlineManager.isHost) {
          setGame(prev => {
            const syncedState = prev ?? initializeRound(0, 0, onlineTargetScore, 'online');
            onlineManager.send({ type: 'game-state', payload: syncedState });
            return syncedState;
          });
        }
        break;
      }
    }
  }, [onlineTargetScore]);

  // ---- Setup online callbacks ----
  useEffect(() => {
    onlineManager.setCallbacks({
      onMessage: handleOnlineMessage,
      onConnected: () => {
        setOnlinePhase('connected');
        setOnlineError('');
        // Send player name
        const name = playerName || (onlineManager.isHost ? 'Joueur 1' : 'Joueur 2');
        onlineManager.send({ type: 'player-name', payload: { name } });

        if (onlineManager.isHost) {
          // Host starts the game
          const initialState = initializeRound(0, 0, onlineTargetScore, 'online');
          const hostNamedState: GameState = {
            ...initialState,
            player1: { ...initialState.player1, name },
          };
          setGame(hostNamedState);
          onlineManager.send({ type: 'game-state', payload: hostNamedState });
          setMySide('player1');
        } else {
          setMySide('player2');
          // Ask host to force-sync state in case first game-state was missed.
          onlineManager.send({ type: 'sync-request' });
        }
      },
      onDisconnected: () => {
        setOnlinePhase('disconnected');
      },
      onError: (err) => {
        setOnlineError(err);
        setOnlinePhase('error');
      },
    });
  }, [handleOnlineMessage, playerName, onlineTargetScore]);

  // ---- Online actions ----
  const createOnlineRoom = async (targetScore: ScoreTarget) => {
    unlock('first_online');
    setOnlineError('');
    setOnlineTargetScore(targetScore);
    setOnlinePhase('creating');
    try {
      const code = await onlineManager.createRoom();
      setRoomCode(code);
      setOnlinePhase('waiting');
    } catch {
      setOnlinePhase('error');
    }
  };

  const joinOnlineRoom = async () => {
    unlock('first_online');
    const normalizedCode = onlineManager.normalizeRoomCode(joinCode);
    if (normalizedCode.length !== ROOM_CODE_LENGTH) {
      setOnlineError(`Entrez un code de room de ${ROOM_CODE_LENGTH} caracteres`);
      return;
    }
    setOnlineError('');
    setOnlinePhase('joining');
    try {
      await onlineManager.joinRoom(normalizedCode);
    } catch {
      setOnlinePhase('error');
    }
  };

  const leaveOnline = () => {
    clearTimer();
    setBusy(false);
    onlineManager.destroy();
    setOnlinePhase('idle');
    setGame(null);
    setRoomCode('');
    setJoinCode('');
    setOnlineError('');
    setShowOnlineLobby(false);
    setOpponentName('');
    setCopied(false);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

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
      // In online mode, send the action to host
      if (who === mySide) {
        if (onlineManager.isHost) {
          // Host processes locally
          setGame(prev => {
            if (!prev || prev.currentTurn !== who || prev.phase !== 'playing') return prev;
            if (prev.selectedCard?.id === card.id) {
              const s: GameState = { ...prev, selectedCard: null, possibleCaptures: null, message: `${prev[who].name}, sélectionnez une carte.` };
              onlineManager.send({ type: 'game-state', payload: s });
              return s;
            }
            const captures = findCaptures(card, prev.table);
            if (captures.length === 0) {
              const newHand = prev[who].hand.filter((c: Card) => c.id !== card.id);
              const nextTurn = otherSide(who);
              const s: GameState = {
                ...prev,
                [who]: { ...prev[who], hand: newHand },
                table: [...prev.table, card],
                selectedCard: null,
                possibleCaptures: null,
                currentTurn: nextTurn,
                phase: 'playing',
                message: `${prev[who].name} a posé ${cardName(card)} sur la table.`,
                lastAction: 'drop',
                showChkoba: null,
              };
              onlineManager.send({ type: 'game-state', payload: s });
              return s;
            }
            if (captures.length === 1) {
              const s = doCapture(prev, card, captures[0], who);
              onlineManager.send({ type: 'game-state', payload: s });
              return s;
            }
            const s: GameState = {
              ...prev,
              selectedCard: card,
              possibleCaptures: captures,
              message: 'Choisissez les cartes à capturer.',
            };
            onlineManager.send({ type: 'game-state', payload: s });
            return s;
          });
        } else {
          // Guest sends play request to host
          onlineManager.send({ type: 'play-card', payload: { cardId: card.id } });
        }
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
      if (game.currentTurn !== mySide) return;
      if (onlineManager.isHost) {
        setGame(prev => {
          if (!prev || !prev.selectedCard) return prev;
          if (prev.currentTurn !== mySide) return prev;
          const s = doCapture(prev, prev.selectedCard, captureGroup, prev.currentTurn);
          onlineManager.send({ type: 'game-state', payload: s });
          return s;
        });
      } else {
        onlineManager.send({ type: 'capture-choice', payload: { captureIds: captureGroup.map(c => c.id) } });
      }
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
          setGame(prev => {
            if (!prev) return null;
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
            if (prev.mode === 'online' && onlineManager.isHost) {
              onlineManager.send({ type: 'game-state', payload: newState });
            }
            return newState;
          });
          setBusy(false);
        }, 800);
        return;
      } else {
        setBusy(true);
        timerRef.current = window.setTimeout(() => {
          setGame(prev => {
            if (!prev) return null;
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
            if (prev.mode === 'online' && onlineManager.isHost) {
              onlineManager.send({ type: 'game-state', payload: newState });
            }
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
        setGame(prev => {
          if (!prev) return null;
          const s: GameState = { ...prev, showChkoba: null };
          onlineManager.send({ type: 'game-state', payload: s });
          return s;
        });
        setBusy(false);
      }, 2500);
    }
  }, [game, busy]);

  const startNextRound = () => {
    if (!game) return;
    if (game.mode === 'online') {
      if (onlineManager.isHost) {
        clearTimer();
        setBusy(false);
        const newState = initializeRound(game.player1Score, game.player2Score, game.targetScore, 'online');
        setGame(newState);
        onlineManager.send({ type: 'game-state', payload: newState });
      } else {
        onlineManager.send({ type: 'next-round' });
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
        setGame(newState);
        onlineManager.send({ type: 'game-state', payload: newState });
      } else {
        onlineManager.send({ type: 'play-again' });
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
      <OnlineLobbyScreen
        onlinePhase={onlinePhase}
        roomCode={roomCode}
        joinCode={joinCode}
        onlineError={onlineError}
        playerName={playerName}
        copied={copied}
        onSetPlayerName={setPlayerName}
        onSetJoinCode={setJoinCode}
        onCreateRoom={createOnlineRoom}
        onJoinRoom={joinOnlineRoom}
        onCopyCode={copyRoomCode}
        onBack={leaveOnline}
      />
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
        visualTheme={visualTheme}
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

  return (
    <div className="premium-screen safe-area premium-entrance min-h-screen text-white flex flex-col select-none">
      {/* Chkoba overlay */}
      {game.showChkoba && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="animate-bounce">
            <div className={cn(
              "text-4xl md:text-6xl font-black px-8 py-4 rounded-2xl shadow-2xl border-2",
              "bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-900 border-amber-300"
            )}>
              ♠ CHKOBA! ♥ 🎉
            </div>
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
      <header className="premium-panel px-2 py-1.5 flex items-center gap-2 border-b border-green-300/20 whitespace-nowrap overflow-hidden">
          <span className="text-base leading-none shrink-0">♠ ♥ ♦ ♣</span>
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
      <div className="px-4 py-2">
        <div className="flex items-center gap-2 mb-1">
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
        <div className="stagger-row flex gap-2 justify-center min-h-[68px] items-center">
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
            topPlayer.hand.map((_: Card, i: number) => <CardBack key={i} />)
          )}
          {topPlayer.hand.length === 0 && (
            <div className="text-green-600 text-sm italic">Pas de cartes</div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 px-4 py-2">
        <div className="premium-panel rounded-2xl p-4 min-h-[160px] relative">
          <div className="absolute -top-3 left-4 premium-chip text-green-200 text-xs px-3 py-1 rounded-full">
            Table ({game.table.length} carte{game.table.length !== 1 ? 's' : ''})
          </div>

          <div className="stagger-row flex flex-wrap gap-2 justify-center items-center pt-2 min-h-[80px]">
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
      </div>

      {/* Message */}
      <div className="px-4 py-1">
        <div className={cn(
          "text-center text-sm py-2 px-4 rounded-lg transition-colors",
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
      <div className="px-4 py-3 bg-black/20 border-t border-green-600/20">
        <div className="flex items-center gap-2 mb-1">
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
        <div className="stagger-row flex gap-3 justify-center min-h-[80px] items-center">
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
            bottomPlayer.hand.map((_: Card, i: number) => <CardBack key={i} />)
          )}
          {bottomPlayer.hand.length === 0 && (
            <div className="text-green-600 text-sm italic">
              {game.deck.length > 0 ? 'Distribution en cours...' : 'Fin du round...'}
            </div>
          )}
        </div>
      </div>
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
  visualTheme: VisualTheme;
  onSetTheme: (t: VisualTheme) => void;
  showOnboarding: boolean;
  onCloseOnboarding: () => void;
  unlocked: AchievementId[];
}> = ({ onStart, onStart2v2Online, visualTheme, onSetTheme, showOnboarding, onCloseOnboarding, unlocked }) => (
  <MenuScreenContent
    onStart={onStart}
    onStart2v2Online={onStart2v2Online}
    visualTheme={visualTheme}
    onSetTheme={onSetTheme}
    showOnboarding={showOnboarding}
    onCloseOnboarding={onCloseOnboarding}
    unlocked={unlocked}
  />
);

const MenuScreenContent: React.FC<{
  onStart: (mode: GameMode, targetScore: ScoreTarget) => void;
  onStart2v2Online: (targetScore: ScoreTarget) => void;
  visualTheme: VisualTheme;
  onSetTheme: (t: VisualTheme) => void;
  showOnboarding: boolean;
  onCloseOnboarding: () => void;
  unlocked: AchievementId[];
}> = ({ onStart, onStart2v2Online, visualTheme, onSetTheme, showOnboarding, onCloseOnboarding, unlocked }) => {
  const [scorePickerFor, setScorePickerFor] = useState<"main" | null>(null);
  const [pendingMode, setPendingMode] = useState<GameMode>('vs-cpu');

  const openMainMode = (mode: GameMode) => {
    if (mode === 'online') {
      onStart('online', 11);
      return;
    }
    setPendingMode(mode);
    setScorePickerFor('main');
  };

  const open2v2Mode = () => {
    onStart2v2Online(11);
  };

  const chooseTarget = (targetScore: ScoreTarget) => {
    onStart(pendingMode, targetScore);
    setScorePickerFor(null);
  };

  return (
  <div className="premium-screen premium-scroll safe-area premium-entrance min-h-screen flex flex-col items-center justify-start text-white p-6">
    {showOnboarding && (
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="premium-panel rounded-2xl max-w-md w-full p-6">
          <h3 className="premium-title text-2xl font-black text-amber-200 mb-3">Bienvenue a Chkoba Premium</h3>
          <div className="space-y-3 text-sm text-green-100/90">
            <div className="premium-chip rounded-xl p-3">🎯 Jouez en solo, 1v1 local, en ligne, et 2v2 online.</div>
            <div className="premium-chip rounded-xl p-3">✨ Choisissez un theme visuel: classic, gold, royal.</div>
            <div className="premium-chip rounded-xl p-3">🔊 Feedback sonore + haptique pour chaque action cle.</div>
          </div>
          <button
            onClick={onCloseOnboarding}
            className="mt-5 w-full bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 font-bold py-3 rounded-xl premium-glow"
          >
            Entrer dans le jeu
          </button>
        </div>
      </div>
    )}
    <div className="text-center mb-4">
      <div className="text-3xl mb-2 tracking-wider">♠ ♥ ♦ ♣</div>
      <h1 className="premium-title text-5xl font-black bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent mb-1">
        CHKOBA
      </h1>
      <p className="text-2xl text-amber-200/70 font-bold mb-1" style={{ fontFamily: 'serif' }}>شكوبة</p>
      <p className="text-green-300 text-lg">Le jeu de cartes tunisien</p>
    </div>

    {/* Sample cards display */}
    <div className="flex gap-3 mb-6 justify-center">
      {SAMPLE_CARDS.map(card => (
        <CardComponent key={card.id} card={card} small />
      ))}
    </div>

    {/* Mode selection */}
    <div className="flex flex-col gap-4 mb-6 w-full max-w-sm">
      <div className="premium-panel rounded-xl p-2 flex gap-2 justify-center">
        {(['classic', 'gold', 'royal'] as VisualTheme[]).map((t) => (
          <button
            key={t}
            onClick={() => onSetTheme(t)}
            className={cn(
              "text-xs px-3 py-1 rounded-lg border",
              visualTheme === t
                ? "bg-amber-400/20 border-amber-300 text-amber-200"
                : "bg-black/20 border-green-200/20 text-green-200/80 hover:bg-black/35"
            )}
          >
            Theme {t}
          </button>
        ))}
      </div>

      <button
        onClick={() => openMainMode('vs-cpu')}
        className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-amber-950 font-bold text-xl px-8 py-4 rounded-xl shadow-lg hover:shadow-amber-500/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
      >
        <span className="text-3xl">🤖</span>
        <div className="text-left">
          <div>Contre l'Ordinateur</div>
          <div className="text-sm font-normal text-amber-800">1 Joueur vs CPU</div>
        </div>
      </button>

      <button
        onClick={() => openMainMode('vs-player')}
        className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white font-bold text-xl px-8 py-4 rounded-xl shadow-lg hover:shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
      >
        <span className="text-3xl">👥</span>
        <div className="text-left">
          <div>2 Joueurs Local</div>
          <div className="text-sm font-normal text-blue-200">Sur le même écran</div>
        </div>
      </button>

      <button
        onClick={() => openMainMode('online')}
        className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xl px-8 py-4 rounded-xl shadow-lg hover:shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
      >
        <span className="text-3xl">🌐</span>
        <div className="text-left">
          <div>1v1 en ligne</div>
          <div className="text-sm font-normal text-emerald-200">Jouez avec un ami à distance</div>
        </div>
      </button>

      <button
        onClick={open2v2Mode}
        className="bg-gradient-to-r from-fuchsia-500 to-pink-600 hover:from-fuchsia-400 hover:to-pink-500 text-white font-bold text-xl px-8 py-4 rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
      >
        <span className="text-3xl">🌍</span>
        <div className="text-left">
          <div>2v2 En Ligne</div>
          <div className="text-sm font-normal text-pink-100">Equipe A vs Equipe B</div>
        </div>
      </button>
    </div>

    {/* Rules */}
    <div className="premium-panel rounded-2xl p-5 max-w-md w-full">
      <h2 className="text-amber-300 font-bold text-lg mb-3">📋 Règles de la Chkoba</h2>
      <ul className="text-sm text-green-200 space-y-2">
        <li className="flex items-start gap-2">
          <span className="text-amber-400">•</span>
          <span>40 cartes françaises : <strong>♠ Pique</strong>, <strong className="text-red-400">♥ Cœur</strong>, <strong className="text-red-400">♦ Carreau</strong>, <strong>♣ Trèfle</strong></span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-amber-400">•</span>
          <span>Valeurs : As(1), 2-7, Dame(8), Valet(9), Roi(10)</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-amber-400">•</span>
          <span>3 cartes par joueur, 4 sur la table</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-amber-400">•</span>
          <span>Capturez des cartes dont la somme = votre carte</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-amber-400">•</span>
          <span><strong className="text-amber-300">Chkoba</strong> : vider la table = +1 point 🎉</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-amber-400">•</span>
          <span>Choix du score: <strong className="text-amber-300">11 ou 21 points</strong> (popup au lancement)</span>
        </li>
      </ul>
    </div>

    <div className="premium-panel rounded-2xl p-4 max-w-md w-full mt-4">
      <h3 className="text-amber-300 font-bold mb-2">🏆 Achievements</h3>
      <div className="grid grid-cols-1 gap-2">
        {ACHIEVEMENTS.map((a) => {
          const done = unlocked.includes(a.id);
          return (
            <div key={a.id} className={cn("premium-chip rounded-lg px-3 py-2 text-sm", done ? "text-amber-200" : "text-green-200/60")}>
              <span className="mr-2">{done ? "✅" : "⬜"}</span>
              <span className="font-semibold">{a.title}</span>
              <span className="ml-2 text-xs opacity-80">{a.description}</span>
            </div>
          );
        })}
      </div>
    </div>

    {scorePickerFor && (
      <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="premium-panel rounded-2xl max-w-sm w-full p-5 relative">
          <button
            onClick={() => setScorePickerFor(null)}
            className="absolute top-3 right-3 w-8 h-8 rounded-full premium-chip text-green-200 hover:text-white"
            aria-label="Fermer"
          >
            ✕
          </button>
          <h3 className="premium-title text-2xl font-black text-amber-200 mb-2">Choisir Le Score</h3>
          <p className="text-green-200/90 text-sm mb-4">
            Lancer la partie jusqu a:
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => chooseTarget(11)}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl premium-glow"
            >
              11 points
            </button>
            <button
              onClick={() => chooseTarget(21)}
              className="bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 font-bold py-3 rounded-xl premium-glow"
            >
              21 points
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

// ---- Online Lobby Screen ----
const OnlineLobbyScreen: React.FC<{
  onlinePhase: OnlinePhase;
  roomCode: string;
  joinCode: string;
  onlineError: string;
  playerName: string;
  copied: boolean;
  onSetPlayerName: (n: string) => void;
  onSetJoinCode: (c: string) => void;
  onCreateRoom: (targetScore: ScoreTarget) => void;
  onJoinRoom: () => void;
  onCopyCode: () => void;
  onBack: () => void;
}> = ({ onlinePhase, roomCode, joinCode, onlineError, playerName, copied, onSetPlayerName, onSetJoinCode, onCreateRoom, onJoinRoom, onCopyCode, onBack }) => {
  const [showCreateScorePicker, setShowCreateScorePicker] = useState(false);
  const handleCreateClick = () => setShowCreateScorePicker(true);
  const chooseCreateScore = (targetScore: ScoreTarget) => {
    setShowCreateScorePicker(false);
    onCreateRoom(targetScore);
  };

  return (
  <div className="premium-screen premium-scroll safe-area min-h-screen flex flex-col items-center justify-center text-white p-6">
    <div className="text-center mb-6">
      <div className="text-3xl mb-2">🌐</div>
      <h1 className="text-4xl font-black bg-gradient-to-r from-emerald-300 to-teal-400 bg-clip-text text-transparent mb-1">
        1v1 en ligne
      </h1>
      <p className="text-green-300">Jouez avec un ami à distance</p>
    </div>

    {/* Player name input */}
    <div className="w-full max-w-sm mb-6">
      <label className="text-sm text-green-300 mb-1 block">Votre pseudo :</label>
      <input
        type="text"
        value={playerName}
        onChange={(e) => onSetPlayerName(e.target.value)}
        placeholder="Entrez votre pseudo..."
        maxLength={20}
        className="w-full bg-green-800/50 border border-green-600/30 rounded-xl px-4 py-3 text-white placeholder-green-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
      />
    </div>

    {onlinePhase === 'idle' || onlinePhase === 'error' ? (
      <div className="w-full max-w-sm space-y-4">
        {/* Create room */}
        <button
          onClick={handleCreateClick}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-lg px-6 py-4 rounded-xl shadow-lg hover:scale-105 transition-all flex items-center justify-center gap-3"
        >
          <span className="text-2xl">🏠</span>
          <div className="text-left">
            <div>Créer une Partie</div>
            <div className="text-sm font-normal text-emerald-200">Invitez un ami avec un code</div>
          </div>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-green-600/30"></div>
          <span className="text-green-500 text-sm">ou</span>
          <div className="flex-1 border-t border-green-600/30"></div>
        </div>

        {/* Join room */}
        <div className="bg-green-800/40 rounded-xl p-4 border border-green-600/30">
          <h3 className="text-emerald-300 font-bold mb-3 flex items-center gap-2">
            <span>🔗</span> Rejoindre une Partie
          </h3>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => onSetJoinCode(onlineManager.normalizeRoomCode(e.target.value))}
              placeholder="Code de la room..."
              maxLength={ROOM_CODE_LENGTH}
              className="w-full bg-green-900/50 border border-green-600/30 rounded-lg px-4 py-3 text-white text-center text-lg font-mono tracking-widest placeholder-green-600 focus:outline-none focus:border-emerald-400 uppercase"
            />
            <button
              onClick={onJoinRoom}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-lg transition-colors"
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
    ) : onlinePhase === 'creating' || onlinePhase === 'joining' ? (
      <div className="text-center">
        <div className="animate-spin text-4xl mb-4">⏳</div>
        <p className="text-green-300 text-lg">
          {onlinePhase === 'creating' ? 'Création de la room...' : 'Connexion en cours...'}
        </p>
      </div>
    ) : onlinePhase === 'waiting' ? (
      <div className="w-full max-w-sm space-y-4">
        <div className="bg-green-800/60 backdrop-blur rounded-2xl p-6 border border-emerald-500/30 text-center">
          <div className="text-2xl mb-3">⏳</div>
          <p className="text-green-300 mb-4">En attente d'un adversaire...</p>
          
          <div className="mb-4">
            <p className="text-xs text-green-500 mb-2">Partagez ce code avec votre ami :</p>
            <div className="flex items-center justify-center gap-2">
              <div className="bg-green-900/80 border-2 border-emerald-400 rounded-xl px-6 py-4 text-3xl font-mono font-black tracking-[0.3em] text-emerald-300 select-all">
                {roomCode}
              </div>
              <button
                onClick={onCopyCode}
                className={cn(
                  "p-3 rounded-lg transition-all text-lg",
                  copied
                    ? "bg-emerald-600 text-white"
                    : "bg-green-700/50 hover:bg-green-600/50 text-green-300"
                )}
                title="Copier le code"
              >
                {copied ? '✅' : '📋'}
              </button>
            </div>
            {copied && (
              <p className="text-emerald-400 text-xs mt-2 animate-bounce-in">Code copié !</p>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 text-green-500 text-sm">
            <div className="animate-pulse w-2 h-2 bg-emerald-400 rounded-full"></div>
            <span>En attente de connexion...</span>
          </div>
        </div>
      </div>
    ) : onlinePhase === 'disconnected' ? (
      <div className="text-center">
        <div className="text-4xl mb-4">😔</div>
        <p className="text-red-300 text-lg mb-4">L'adversaire s'est déconnecté</p>
      </div>
    ) : onlinePhase === 'connected' ? (
      <div className="text-center">
        <div className="animate-spin text-4xl mb-4">🔄</div>
        <p className="text-green-300 text-lg">Synchronisation de la partie...</p>
      </div>
    ) : null}

    <button
      onClick={onBack}
      className="mt-6 text-green-400 hover:text-white text-sm hover:bg-green-700/50 rounded-lg px-4 py-2 transition-colors"
    >
      ← Quitter
    </button>

    {showCreateScorePicker && (
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
          <p className="text-green-200/90 text-sm mb-4">Créer la partie en ligne jusqu a:</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => chooseCreateScore(11)}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl premium-glow"
            >
              11 points
            </button>
            <button
              onClick={() => chooseCreateScore(21)}
              className="bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 font-bold py-3 rounded-xl premium-glow"
            >
              21 points
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
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
  const scoreCards = isOnline
    ? (mySide === 'player1'
      ? [
          { title: p1Label, score: game.roundScorePlayer1, totalScore: game.player1Score, isPlayer: true },
          { title: p2Label, score: game.roundScorePlayer2, totalScore: game.player2Score, isPlayer: false },
        ]
      : [
          { title: p2Label, score: game.roundScorePlayer2, totalScore: game.player2Score, isPlayer: true },
          { title: p1Label, score: game.roundScorePlayer1, totalScore: game.player1Score, isPlayer: false },
        ])
    : [
        { title: p1Label, score: game.roundScorePlayer1, totalScore: game.player1Score, isPlayer: true },
        { title: p2Label, score: game.roundScorePlayer2, totalScore: game.player2Score, isPlayer: false },
      ];
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
