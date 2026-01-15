import { useState, useEffect, useRef } from 'react';
import { socketManager } from '../net/socket';
import type { CardId, PrepStartPayload, StepRevealPayload, MatchEndPayload } from '../net/types';
import { cardIdToType } from '../cards';

type BattleState = 'prep' | 'playing' | 'ended';

interface BattleProps {
  onBackToMenu: () => void;
  tokens: number | null;
  matchEndPayload: MatchEndPayload | null;
  lastPrepStart: PrepStartPayload | null;
  currentMatchId: string | null;
  matchMode?: 'PVP' | 'PVE' | 'TUTORIAL'; // Match mode from server
}

export default function Battle({ onBackToMenu, tokens, matchEndPayload, lastPrepStart, currentMatchId, matchMode }: BattleProps) {
  const [state, setState] = useState<BattleState>('prep');
  const [yourHp, setYourHp] = useState(10);
  const [oppHp, setOppHp] = useState(10);
  const [pot, setPot] = useState(0);
  // Slots store CardId (for sending to server)
  const [slots, setSlots] = useState<(CardId | null)[]>([null, null, null]);
  // Hand stores CardId[4] from server (source of truth)
  const [yourHand, setYourHand] = useState<CardId[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [deadlineTs, setDeadlineTs] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [roundIndex, setRoundIndex] = useState(1);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [revealedCards, setRevealedCards] = useState<{ step: number; yourCard: CardId; oppCard: CardId }[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<'PREP' | 'REVEAL' | 'END'>('PREP');
  const [yourNickname, setYourNickname] = useState<string | null>(null);
  const [oppNickname, setOppNickname] = useState<string | null>(null);
  // Match mode (from server payloads) - source of truth for tutorial detection
  const [currentMatchMode, setCurrentMatchMode] = useState<'PVP' | 'PVE' | 'TUTORIAL' | undefined>(matchMode);
  // Tutorial: Interactive step state machine
  // 0 = intro, 1 = ATTACK, 2 = slots, 3 = DEFENSE, 4 = HEAL, 5 = COUNTER, 6 = multiple cards, 7 = final
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const [tutorialCompletedActions, setTutorialCompletedActions] = useState<Set<number>>(new Set());
  const [tutorialLastSlots, setTutorialLastSlots] = useState<(CardId | null)[]>([null, null, null]);

  const [dragState, setDragState] = useState<{
    card: CardId;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    sourceSlotIndex: number | null;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const draftDebounceRef = useRef<number | null>(null);
  const lastAppliedRoundIndexRef = useRef<number | null>(null);

  // Блокировка scroll на body/html при монтировании Battle
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    
    // Добавляем класс для блокировки scroll
    html.classList.add('battle-mode');
    body.classList.add('battle-mode');
    
    // Применяем стили напрямую для надежности
    const originalHtmlOverflow = html.style.overflow;
    const originalHtmlPosition = html.style.position;
    const originalHtmlWidth = html.style.width;
    const originalHtmlHeight = html.style.height;
    const originalHtmlTouchAction = html.style.touchAction;
    
    const originalBodyOverflow = body.style.overflow;
    const originalBodyPosition = body.style.position;
    const originalBodyWidth = body.style.width;
    const originalBodyHeight = body.style.height;
    const originalBodyTouchAction = body.style.touchAction;
    
    html.style.overflow = 'hidden';
    html.style.position = 'fixed';
    html.style.width = '100%';
    html.style.height = '100%';
    html.style.touchAction = 'none';
    
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.height = '100%';
    body.style.touchAction = 'none';
    
    return () => {
      // Восстанавливаем оригинальные стили
      html.classList.remove('battle-mode');
      body.classList.remove('battle-mode');
      
      html.style.overflow = originalHtmlOverflow;
      html.style.position = originalHtmlPosition;
      html.style.width = originalHtmlWidth;
      html.style.height = originalHtmlHeight;
      html.style.touchAction = originalHtmlTouchAction;
      
      body.style.overflow = originalBodyOverflow;
      body.style.position = originalBodyPosition;
      body.style.width = originalBodyWidth;
      body.style.height = originalBodyHeight;
      body.style.touchAction = originalBodyTouchAction;
    };
  }, []);

  useEffect(() => {
    if (matchEndPayload) {
      setState('ended');
      setPhase('END');
      setYourHp(matchEndPayload.yourHp);
      setOppHp(matchEndPayload.oppHp);
      setCurrentStepIndex(null);
      // Останавливаем таймер при завершении матча
      setDeadlineTs(null);
      
      // Tutorial: Mark as completed in localStorage
      if (matchEndPayload.matchMode === 'TUTORIAL') {
        localStorage.setItem('orcain_tutorial_completed', '1');
      }
    } else {
      // Очищаем END состояние если matchEndPayload стал null
      if (phase === 'END') {
        setPhase('PREP');
        setState('prep');
      }
    }
  }, [matchEndPayload, phase]);

  // Применение lastPrepStart из props - источник правды для таймера и никнеймов
  useEffect(() => {
    if (!lastPrepStart) {
      // DEBUG: логируем отсутствие lastPrepStart
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1') {
        console.log(`[BATTLE_PREP_START] lastPrepStart is null, waiting...`);
      }
      return;
    }
    
    // Игнорируем если matchId не совпадает
    if (lastPrepStart.matchId && currentMatchId !== null && lastPrepStart.matchId !== currentMatchId) {
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1') {
        console.log(`[BATTLE_PREP_START] matchId mismatch: prep=${lastPrepStart.matchId} current=${currentMatchId}`);
      }
      return;
    }
    
    const isNewRound = lastAppliedRoundIndexRef.current === null || 
                       lastAppliedRoundIndexRef.current !== lastPrepStart.roundIndex;
    
    // DEBUG: логируем применение prep_start
    const DEBUG_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
    if (DEBUG_MODE) {
      console.log(`[BATTLE_PREP_START] applying round=${lastPrepStart.roundIndex} deadlineTs=${lastPrepStart.deadlineTs} yourNickname=${lastPrepStart.yourNickname || '<null>'} oppNickname=${lastPrepStart.oppNickname || '<null>'} isNewRound=${isNewRound}`);
    }
    
    // КРИТИЧНО: устанавливаем все данные немедленно, включая R1
    setRoundIndex(lastPrepStart.roundIndex);
    setPhase('PREP');
    setNowTs(Date.now()); // Обновляем nowTs для корректного расчета таймера
    setDeadlineTs(lastPrepStart.deadlineTs); // deadlineTs - источник правды для таймера
    setYourHp(lastPrepStart.yourHp);
    setOppHp(lastPrepStart.oppHp);
    setPot(lastPrepStart.pot);
    setSuddenDeath(lastPrepStart.suddenDeath);
    // Use yourHand from server (source of truth)
    setYourHand(lastPrepStart.yourHand || []);
    
    // Никнеймы обновляем из prep_start (может быть более актуальная версия)
    // КРИТИЧНО: устанавливаем даже если undefined (null) - это явное значение
    // Это гарантирует что никнеймы будут показаны в R1 сразу после prep_start
    setYourNickname(lastPrepStart.yourNickname ?? null);
    setOppNickname(lastPrepStart.oppNickname ?? null);
    
    // Match mode - source of truth for tutorial detection
    if (lastPrepStart.matchMode) {
      setCurrentMatchMode(lastPrepStart.matchMode);
    }
    
    // Сбросить confirmed/layout/slot/выкладки только если это новый раунд
    if (isNewRound) {
      setState('prep');
      setSlots([null, null, null]);
      setTutorialLastSlots([null, null, null]);
      setConfirmed(false);
      setRevealedCards([]);
      setCurrentStepIndex(null);
      lastAppliedRoundIndexRef.current = lastPrepStart.roundIndex;
      
      // Tutorial: Reset tutorial step on new round (only if not already past that step)
      if (lastPrepStart.matchMode === 'TUTORIAL') {
        if (lastPrepStart.roundIndex === 1 && tutorialStep < 1) {
          setTutorialStep(1); // Start with ATTACK step
        } else if (lastPrepStart.roundIndex === 2 && tutorialStep < 3) {
          setTutorialStep(3); // DEFENSE step
        } else if (lastPrepStart.roundIndex === 3 && tutorialStep < 4) {
          setTutorialStep(4); // HEAL step
        }
      }
    }
    
    // DEBUG: логируем после установки состояния
    if (DEBUG_MODE) {
      setTimeout(() => {
        console.log(`[BATTLE_PREP_START_AFTER] roundIndex=${lastPrepStart.roundIndex} deadlineTs=${lastPrepStart.deadlineTs} yourNickname=${lastPrepStart.yourNickname || '<null>'} oppNickname=${lastPrepStart.oppNickname || '<null>'}`);
      }, 0);
    }
  }, [lastPrepStart, currentMatchId]);

  useEffect(() => {
    const socket = socketManager.getSocket();
    if (!socket) return;

    socketManager.onMatchFound((payload) => {
      // При старте нового матча очищаем все локальные стейты и устанавливаем начальные значения
      setState('prep');
      setPhase('PREP');
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      setPot(payload.pot);
      setSlots([null, null, null]);
      setTutorialLastSlots([null, null, null]);
      setConfirmed(false);
      setRevealedCards([]);
      setCurrentStepIndex(null);
      setRoundIndex(1);
      setNowTs(Date.now()); // Обновляем nowTs для таймера
      
      // Tutorial: Initialize tutorial step on match_found
      if (payload.matchMode === 'TUTORIAL') {
        setTutorialStep(0); // Start with intro
        setTutorialCompletedActions(new Set());
      }
      // Никнеймы устанавливаем сразу из match_found (источник правды для R1)
      // КРИТИЧНО: устанавливаем даже если undefined (null) - это явное значение
      setYourNickname(payload.yourNickname ?? null);
      setOppNickname(payload.oppNickname ?? null);
      // Hand устанавливаем из match_found (source of truth)
      setYourHand(payload.yourHand || []);
      // Match mode - source of truth for tutorial detection
      if (payload.matchMode) {
        setCurrentMatchMode(payload.matchMode);
      }
      // deadlineTs придет в prep_start, но уже сейчас готовы к его получению
    });

    // Убрана прямая подписка на prep_start - теперь получаем через props (lastPrepStart)

    socketManager.onConfirmOk(() => {
      setConfirmed(true);
    });

    socketManager.onStepReveal((payload: StepRevealPayload) => {
      setState('playing');
      setPhase('REVEAL');
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      setCurrentStepIndex(payload.stepIndex);
      
      setRevealedCards(prev => {
        const newRevealed = [...prev];
        newRevealed[payload.stepIndex] = {
          step: payload.stepIndex,
          yourCard: payload.yourCard,
          oppCard: payload.oppCard
        };
        
        return newRevealed;
      });
    });

    socketManager.onRoundEnd(() => {
      setRevealedCards([]);
      setCurrentStepIndex(null);
      setPhase('PREP');
    });

    return () => {
      socketManager.off('confirm_ok');
      socketManager.off('step_reveal');
      socketManager.off('round_end');
    };
  }, []);

  // Вычисляемый countdownSeconds - источник правды для таймера
  // Всегда вычисляем от deadlineTs и текущего времени
  const computedSeconds = (() => {
    if (phase === 'PREP' && deadlineTs !== null) {
      const baseNow = nowTs || Date.now();
      const secs = Math.max(0, Math.ceil((deadlineTs - baseNow) / 1000));
      return isNaN(secs) ? 0 : secs;
    }
    return null;
  })();

  // Tutorial: Check interactive step conditions
  useEffect(() => {
    if (currentMatchMode !== 'TUTORIAL') return;
    
    // Step 1: ATTACK - player placed attack card in any slot
    if (tutorialStep === 1) {
      const hasAttack = slots.some(card => card === 'attack');
      if (hasAttack && !tutorialCompletedActions.has(1)) {
        setTutorialCompletedActions(prev => new Set([...prev, 1]));
        setTimeout(() => setTutorialStep(2), 800);
      }
    }
    
    // Step 2: Slots - player moved card to different slot (check if card position changed)
    if (tutorialStep === 2) {
      const hasMoved = slots.some((card, idx) => {
        if (card === null) return false;
        // Check if card is in different position than before
        const prevIdx = tutorialLastSlots.indexOf(card);
        return prevIdx !== -1 && prevIdx !== idx;
      });
      if (hasMoved && !tutorialCompletedActions.has(2)) {
        setTutorialCompletedActions(prev => new Set([...prev, 2]));
        setTimeout(() => setTutorialStep(3), 800);
      }
    }
    
    // Step 6: Multiple cards - player filled 2+ slots
    if (tutorialStep === 6) {
      const filledCount = slots.filter(card => card !== null).length;
      if (filledCount >= 2 && !tutorialCompletedActions.has(6)) {
        setTutorialCompletedActions(prev => new Set([...prev, 6]));
        setTimeout(() => setTutorialStep(7), 800);
      }
    }
  }, [slots, tutorialStep, tutorialLastSlots, tutorialCompletedActions, currentMatchMode]);

  // Tutorial: Track step_reveal for DEFENSE/HEAL/COUNTER steps
  useEffect(() => {
    if (currentMatchMode !== 'TUTORIAL') return;
    
    // Find the most recent revealed card
    const lastRevealed = revealedCards.length > 0 
      ? revealedCards[revealedCards.length - 1] 
      : revealedCards.find(r => r !== undefined);
    
    if (!lastRevealed) return;
    
    // Step 3: DEFENSE - player revealed defense (wait for reveal after placing card)
    if (tutorialStep === 3 && lastRevealed.yourCard === 'defense' && !tutorialCompletedActions.has(3)) {
      setTutorialCompletedActions(prev => new Set([...prev, 3]));
      setTimeout(() => setTutorialStep(4), 2000);
    }
    // Step 4: HEAL - player revealed heal
    else if (tutorialStep === 4 && lastRevealed.yourCard === 'heal' && !tutorialCompletedActions.has(4)) {
      setTutorialCompletedActions(prev => new Set([...prev, 4]));
      setTimeout(() => setTutorialStep(5), 2000);
    }
    // Step 5: COUNTER - player revealed counter
    else if (tutorialStep === 5 && lastRevealed.yourCard === 'counter' && !tutorialCompletedActions.has(5)) {
      setTutorialCompletedActions(prev => new Set([...prev, 5]));
      setTimeout(() => setTutorialStep(6), 2000);
    }
  }, [revealedCards, tutorialStep, tutorialCompletedActions, currentMatchMode]);

  // Таймер для обновления countdown - стартует сразу при получении deadlineTs
  useEffect(() => {
    if (phase !== 'PREP' || deadlineTs === null) {
      // Если не PREP или нет deadlineTs - останавливаем таймер
      return;
    }

    // DEBUG: логируем запуск таймера
    const DEBUG_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
    if (DEBUG_MODE) {
      const remaining = Math.max(0, Math.ceil((deadlineTs - Date.now()) / 1000));
      console.log(`[BATTLE_TIMER_START] phase=${phase} deadlineTs=${deadlineTs} remaining=${remaining}s roundIndex=${roundIndex}`);
    }

    // Сразу обновляем nowTs для мгновенного отображения таймера
    setNowTs(Date.now());

    // Запускаем интервал для обновления таймера
    const interval = setInterval(() => {
      setNowTs(Date.now());
    }, 250);

    return () => {
      clearInterval(interval);
      if (DEBUG_MODE) {
        console.log(`[BATTLE_TIMER_STOP] phase=${phase} deadlineTs=${deadlineTs}`);
      }
    };
  }, [phase, deadlineTs, roundIndex]);

  const canInteract = state === 'prep' && !confirmed;

  useEffect(() => {
    if (dragState) {
      document.body.classList.add('dragging');
    } else {
      document.body.classList.remove('dragging');
    }
    return () => {
      document.body.classList.remove('dragging');
    };
  }, [dragState]);

  useEffect(() => {
    return () => {
      if (draftDebounceRef.current) {
        window.clearTimeout(draftDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!canInteract && dragState) {
      dragPointerIdRef.current = null;
      setDragState(null);
      setHoveredSlotIndex(null);
    }
  }, [canInteract, dragState]);

  const toCardCode = (v: CardId | null): string | null => (v ? v : null);

  const scheduleDraft = (nextSlots: (CardId | null)[]) => {
    if (!currentMatchId) return;
    if (draftDebounceRef.current) {
      window.clearTimeout(draftDebounceRef.current);
    }
    draftDebounceRef.current = window.setTimeout(() => {
      const layoutWithNulls: (string | null)[] = nextSlots.map(toCardCode);
      if (layoutWithNulls.length === 3) {
        socketManager.layoutDraft(currentMatchId, layoutWithNulls);
      }
    }, 150);
  };

  const getSlotIndexAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const slotEl = el?.closest('[data-slot-index]') as HTMLElement | null;
    if (!slotEl) return null;
    const slotIndex = Number(slotEl.dataset.slotIndex);
    return Number.isFinite(slotIndex) ? slotIndex : null;
  };

  const applySlotsUpdate = (updater: (prev: (CardId | null)[]) => (CardId | null)[]) => {
    setSlots(prev => {
      const next = updater(prev);
      scheduleDraft(next);
      
      // Tutorial: Track slot changes for interactive steps
      if (currentMatchMode === 'TUTORIAL') {
        setTutorialLastSlots(next);
      }
      
      return next;
    });
  };

  const applyDropToSlot = (card: CardId, slotIndex: number, sourceSlotIndex: number | null) => {
    if (!canInteract) return;
    setSlots(prev => {
      const next = [...prev];
      const oldSlotIndex = prev.indexOf(card);

      if (oldSlotIndex !== -1) {
        next[oldSlotIndex] = null;
      }

      if (sourceSlotIndex !== null && sourceSlotIndex !== oldSlotIndex) {
        next[sourceSlotIndex] = null;
      }

      next[slotIndex] = card;
      return next;
    });
  };

  const clearSlotIfNeeded = (sourceSlotIndex: number | null) => {
    if (sourceSlotIndex === null) return;
    applySlotsUpdate(prev => {
      const next = [...prev];
      next[sourceSlotIndex] = null;
      return next;
    });
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    card: CardId,
    sourceSlotIndex: number | null
  ) => {
    if (!canInteract) return;
    if (sourceSlotIndex === null && slots.includes(card)) return;

    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragPointerIdRef.current = e.pointerId;

    const rect = target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    setDragState({
      card,
      x: e.clientX - offsetX,
      y: e.clientY - offsetY,
      offsetX,
      offsetY,
      sourceSlotIndex,
      lastClientX: e.clientX,
      lastClientY: e.clientY
    });
    setHoveredSlotIndex(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    if (dragPointerIdRef.current !== e.pointerId) return;

    e.preventDefault();
    const nextX = e.clientX - dragState.offsetX;
    const nextY = e.clientY - dragState.offsetY;
    setDragState(prev =>
      prev
        ? {
            ...prev,
            x: nextX,
            y: nextY,
            lastClientX: e.clientX,
            lastClientY: e.clientY
          }
        : prev
    );

    const slotIndex = getSlotIndexAtPoint(e.clientX, e.clientY);
    setHoveredSlotIndex(slotIndex);
  };

  const finalizePointerEnd = (x: number, y: number) => {
    if (!dragState) return;
    const slotIndex = getSlotIndexAtPoint(x, y);
    if (slotIndex !== null && canInteract) {
      if (dragState.sourceSlotIndex !== null && slotIndex === dragState.sourceSlotIndex) {
        // Drop обратно в тот же слот — ничего не меняем
      } else {
        applyDropToSlot(dragState.card, slotIndex, dragState.sourceSlotIndex);
      }
    } else {
      clearSlotIfNeeded(dragState.sourceSlotIndex);
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    if (dragPointerIdRef.current !== e.pointerId) return;

    e.preventDefault();
    finalizePointerEnd(e.clientX, e.clientY);
    dragPointerIdRef.current = null;
    setDragState(null);
    setHoveredSlotIndex(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    if (dragPointerIdRef.current !== e.pointerId) return;

    e.preventDefault();
    finalizePointerEnd(dragState.lastClientX, dragState.lastClientY);
    dragPointerIdRef.current = null;
    setDragState(null);
    setHoveredSlotIndex(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleConfirm = () => {
    if (confirmed) return;
    const layout = slots.filter((card): card is CardId => card !== null);
    if (layout.length !== 3) return;
    
    // Convert CardId[] to string[] for server (server expects CardId strings)
    socketManager.layoutConfirm(layout);
  };


  // Функция для получения цвета карты (принимает CardId, конвертирует в CardType для UI)
  const getCardColor = (cardId: CardId | null) => {
    if (!cardId) {
      return { bg: '#f5f5f5', border: '#333', text: '#000', icon: '' };
    }
    // Convert CardId to CardType for display
    const cardType = cardIdToType(cardId);
    switch (cardType) {
      case 'ATTACK':
        return { bg: '#ffebee', border: '#f44336', text: '#c62828', icon: '⚔' };
      case 'DEFENSE':
        return { bg: '#e3f2fd', border: '#2196f3', text: '#1565c0', icon: '🛡' };
      case 'HEAL':
        return { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32', icon: '💚' };
      case 'COUNTER':
        return { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a', icon: '🟣' };
      default:
        return { bg: '#f5f5f5', border: '#333', text: '#000', icon: '' };
    }
  };

  // Общий компонент/функция renderCard (принимает CardId, конвертирует для отображения)
  const renderCard = (cardId: CardId | null, mode: 'HAND' | 'SLOT' | 'BACK' | 'REVEAL', slotIndex?: number) => {
    // Calculate card size based on mode - hand cards need to be smaller to fit 4 in a row
    // Hand: 4 cards, padding 24px (12px*2), gaps 12px (4px*3) = (100vw - 24px - 12px) / 4
    // Slots: 3 cards, padding 24px, gaps 12px (6px*2) = (100vw - 24px - 12px) / 3
    const isHand = mode === 'HAND';
    const cardWidth = isHand 
      ? 'clamp(55px, calc((100vw - 36px) / 4), 75px)' // 4 cards: padding 24px + gaps 12px
      : 'clamp(65px, calc((100vw - 36px) / 3), 85px)'; // 3 cards: padding 24px + gaps 12px
    
    if (mode === 'BACK') {
      return (
        <div
          style={{
            width: cardWidth,
            aspectRatio: '3 / 4',
            border: '2px solid #333',
            borderRadius: '8px',
            backgroundColor: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            color: '#fff',
            fontSize: 'clamp(20px, 4vw, 28px)',
            fontWeight: 'bold',
            flexShrink: 0
          }}
        >
          ?
        </div>
      );
    }

    if (!cardId) {
      if (mode === 'SLOT') {
        return (
          <div
            style={{
              width: cardWidth,
              aspectRatio: '3 / 4',
              border: '2px dashed #999',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#999',
              fontSize: 'clamp(8px, 1.5vw, 10px)',
              textAlign: 'center',
              padding: '4px',
              flexShrink: 0
            }}
          >
            Drop
          </div>
        );
      }
      return null;
    }

    const colors = getCardColor(cardId);
    // Convert CardId to CardType for display
    const cardType = cardId ? cardIdToType(cardId) : null;
    const cardName = cardType || '';

    return (
      <div
        style={{
          width: cardWidth,
          aspectRatio: '3 / 4',
          border: `2px solid ${colors.border}`,
          borderRadius: '8px',
          backgroundColor: colors.bg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          color: colors.text,
          padding: 'clamp(4px, 1vw, 6px)',
          textAlign: 'center',
          flexShrink: 0
        }}
      >
        <div style={{ fontSize: 'clamp(16px, 3vw, 20px)', marginBottom: '2px' }}>{colors.icon}</div>
        <div style={{ fontSize: 'clamp(8px, 1.5vw, 10px)', fontWeight: 'bold', lineHeight: '1.1' }}>{cardName}</div>
        {mode === 'SLOT' && slotIndex !== undefined && (
          <div style={{ fontSize: 'clamp(7px, 1.2vw, 9px)', marginTop: '2px', color: '#666' }}>S{slotIndex + 1}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      paddingTop: 'env(safe-area-inset-top, 0)',
      paddingBottom: 'env(safe-area-inset-bottom, 0)',
      backgroundColor: '#242424',
      color: 'rgba(255, 255, 255, 0.87)',
      zIndex: 1
    }}>
      {/* Compact Top Bar - 1 строка максимум */}
      <div style={{ 
        flexShrink: 0,
        padding: '6px 12px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 12px',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '10px',
        lineHeight: '1.3',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold' }}>R{roundIndex}{suddenDeath ? ' SD' : ''}</span>
          <span style={{ opacity: 0.7 }}>{phase}</span>
          {phase === 'PREP' && deadlineTs !== null && computedSeconds !== null && (
            <span style={{ color: computedSeconds <= 5 ? '#ff6b6b' : '#fff', fontWeight: 'bold' }}>{computedSeconds}s</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '10px' }}>
          <span>💰{tokens === null ? '—' : tokens}</span>
          <span>🏆{pot}</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11px', fontWeight: 'bold' }}>
          <span style={{ color: '#4caf50' }}>
            {yourNickname || 'You'}: {yourHp}
          </span>
          <span style={{ color: '#f44336' }}>
            {oppNickname || 'Opp'}: {oppHp}
          </span>
        </div>
      </div>

      {/* Opponent Cards Row - опущена ниже для лучшей компоновки */}
      <div style={{ 
        flexShrink: 0,
        padding: '12px 12px 8px 12px',
        display: 'flex',
        gap: '6px',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          {[0, 1, 2].map((index) => {
            const revealed = revealedCards[index];
            const isCurrentStep = currentStepIndex === index;
            // В PREP всегда рубашка, в REVEAL показываем только если это текущий шаг или уже был вскрыт
            const shouldShowRevealed = phase !== 'PREP' && revealed && (isCurrentStep || phase === 'END');
            
            return (
              <div
                key={index}
                style={{
                  border: isCurrentStep ? '2px solid #ff6b6b' : 'none',
                  borderRadius: '8px',
                  padding: isCurrentStep ? '1px' : '0'
                }}
              >
                {shouldShowRevealed ? (
                  renderCard(revealed.oppCard, 'REVEAL', index)
                ) : (
                  renderCard(null, 'BACK')
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Your Slots Row - строго по центру, ровные gap */}
      <div style={{ 
        flexShrink: 0,
        padding: '10px 12px',
        display: 'flex',
        gap: '8px',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
          {slots.map((card, index) => {
            const revealed = revealedCards[index];
            const displayCard = revealed ? revealed.yourCard : card;
            const isCurrentStep = currentStepIndex === index;
            const isHovered = dragState !== null && hoveredSlotIndex === index;
            const hoverBorder = isHovered ? '2px solid #4caf50' : null;
            const stepBorder = isCurrentStep ? '2px solid #ff6b6b' : 'none';
            const border = hoverBorder || stepBorder;

            return (
              <div
                key={index}
                data-slot-index={index}
                style={{
                  border,
                  borderRadius: '8px',
                  padding: border !== 'none' ? '1px' : '0',
                  cursor: canInteract ? 'pointer' : 'default',
                  boxShadow: isHovered ? '0 0 0 2px rgba(76, 175, 80, 0.2)' : 'none'
                }}
              >
                {displayCard ? (
                  <div
                    className="battle-card"
                    onPointerDown={(e) => handlePointerDown(e, displayCard, index)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerCancel}
                  >
                    {renderCard(displayCard, 'SLOT', index)}
                  </div>
                ) : (
                  renderCard(null, 'SLOT', index)
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Step Result Text - Compact */}
      {currentStepIndex !== null && revealedCards[currentStepIndex] && (
        <div style={{ 
          flexShrink: 0,
          textAlign: 'center', 
          padding: '4px 12px',
          fontSize: '11px',
          opacity: 0.8
        }}>
          Step {currentStepIndex + 1}: You {yourHp} / Opp {oppHp}
        </div>
      )}

      {/* Hand Row - 4 cards in one row, поднята выше */}
      <div style={{ 
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 0,
        overflow: 'hidden',
        paddingTop: '8px'
      }}>
        {state === 'prep' && !confirmed && (
          <div style={{ 
            flexShrink: 0,
            padding: '8px 12px',
            display: 'flex',
            gap: '4px',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%',
            boxSizing: 'border-box'
          }}>
            {yourHand.map((cardId) => {
              const inSlot = slots.includes(cardId);
              const isDraggingCard = dragState?.card === cardId;
              const cardElement = renderCard(cardId, 'HAND');

              return (
                <div
                  key={cardId}
                  className="battle-card"
                  onPointerDown={(e) => handlePointerDown(e, cardId, null)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerCancel}
                  style={{
                    opacity: inSlot ? 0.5 : isDraggingCard ? 0.25 : 1,
                    cursor: canInteract && !inSlot ? 'grab' : 'default',
                    userSelect: 'none',
                    touchAction: 'none'
                  }}
                >
                  {cardElement}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm Button Row - поднят выше safe-area, увеличен hit-area */}
      {state === 'prep' && !confirmed && (
        <div style={{ 
          flexShrink: 0,
          padding: `12px 12px calc(12px + env(safe-area-inset-bottom, 0px)) 12px`,
          textAlign: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <button
            onClick={handleConfirm}
            disabled={slots.filter(c => c !== null).length !== 3}
            style={{
              padding: '14px 32px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: slots.filter(c => c !== null).length === 3 ? 'pointer' : 'not-allowed',
              minWidth: '140px',
              minHeight: '52px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: slots.filter(c => c !== null).length === 3 ? '#4caf50' : '#666',
              color: '#fff',
              transition: 'background-color 0.2s'
            }}
          >
            Confirm
          </button>
        </div>
      )}

      {confirmed && state === 'prep' && (
        <div style={{ 
          flexShrink: 0,
          textAlign: 'center', 
          padding: '8px 12px',
          fontSize: '12px',
          opacity: 0.7,
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          Waiting for opponent...
        </div>
      )}

      {/* Tutorial Overlay - Interactive Steps */}
      {currentMatchMode === 'TUTORIAL' && tutorialStep < 8 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          color: '#fff'
        }}>
          {(() => {
            // Debug logging for tutorial UI
            const DEBUG_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
            if (DEBUG_MODE) {
              console.log(`[TUTORIAL_UI] matchMode=${currentMatchMode} oppNickname=${oppNickname || '<null>'} tutorialStep=${tutorialStep}`);
            }
            return null;
          })()}
          <div style={{
            backgroundColor: '#1a1a1a',
            padding: '24px',
            borderRadius: '12px',
            maxWidth: '420px',
            textAlign: 'center',
            border: '2px solid #4caf50'
          }}>
            {tutorialStep === 0 && (
              <>
                <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#4caf50' }}>Тренировочная арена</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  Ты на тренировочной арене. Тренер покажет базу боя.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#aaa' }}>
                  В руке 4 карты. Выложи до 3 карт в слоты.
                </p>
                <button
                  onClick={() => setTutorialStep(1)}
                  style={{
                    padding: '12px 24px',
                    fontSize: '16px',
                    backgroundColor: '#4caf50',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  Начать
                </button>
              </>
            )}
            {tutorialStep === 1 && (
              <>
                <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>⚔ ATTACK</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  ATTACK наносит 2 урона противнику.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#ff6b6b', fontWeight: 'bold' }}>
                  Положи карту ATTACK в любой слот
                </p>
                <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
                  {slots.some(c => c === 'attack') ? '✓ Готово!' : 'Перетащи ATTACK из руки в слот'}
                </div>
              </>
            )}
            {tutorialStep === 2 && (
              <>
                <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>Слоты 1→2→3</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  Слоты разыгрываются по порядку: сначала 1, потом 2, потом 3.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#ff6b6b', fontWeight: 'bold' }}>
                  Перемести карту в другой слот
                </p>
                <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
                  Можно класть карты в любой слот
                </div>
              </>
            )}
            {tutorialStep === 3 && (
              <>
                <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>🛡 DEFENSE</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  DEFENSE блокирует атаку. Тренер атакует — защитись!
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#ff6b6b', fontWeight: 'bold' }}>
                  Положи DEFENSE в слот и дождись результата
                </p>
                <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
                  {slots.some(c => c === 'defense') ? '✓ Карта выложена, ждём reveal...' : 'Выложи DEFENSE'}
                </div>
              </>
            )}
            {tutorialStep === 4 && (
              <>
                <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>💚 HEAL</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  HEAL восстанавливает +1 HP. Используй для лечения.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#ff6b6b', fontWeight: 'bold' }}>
                  Сыграй HEAL и дождись результата
                </p>
                <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
                  {slots.some(c => c === 'heal') ? '✓ Карта выложена, ждём reveal...' : 'Выложи HEAL'}
                </div>
              </>
            )}
            {tutorialStep === 5 && (
              <>
                <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>🟣 COUNTER</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  COUNTER отражает атаку — атакующий получает урон вместо тебя.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#ff6b6b', fontWeight: 'bold' }}>
                  Сыграй COUNTER и дождись результата
                </p>
                <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
                  {slots.some(c => c === 'counter') ? '✓ Карта выложена, ждём reveal...' : 'Выложи COUNTER'}
                </div>
              </>
            )}
            {tutorialStep === 6 && (
              <>
                <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>Множественные карты</h2>
                <p style={{ fontSize: '16px', marginBottom: '16px', lineHeight: '1.5' }}>
                  Можно выложить до 3 карт за раунд. Больше карт — больше эффектов!
                </p>
                <p style={{ fontSize: '14px', marginBottom: '20px', color: '#ff6b6b', fontWeight: 'bold' }}>
                  Заполни минимум 2 слота картами
                </p>
                <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
                  {slots.filter(c => c !== null).length >= 2 ? '✓ Готово!' : `Заполнено: ${slots.filter(c => c !== null).length}/2`}
                </div>
              </>
            )}
            {tutorialStep === 7 && (
              <>
                <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#4caf50' }}>Обучение завершено!</h2>
                <p style={{ fontSize: '16px', marginBottom: '20px', lineHeight: '1.5' }}>
                  Ты освоил основы боя. Теперь можно сражаться с реальными противниками!
                </p>
                <button
                  onClick={onBackToMenu}
                  style={{
                    padding: '12px 24px',
                    fontSize: '16px',
                    backgroundColor: '#4caf50',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  В меню
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Match End */}
      {matchEndPayload && (
        <div style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '24px', marginBottom: '12px' }}>
            {matchEndPayload.winner === 'YOU' ? 'YOU WIN' : 'YOU LOSE'}
          </h2>
          {matchEndPayload.reason === 'disconnect' && (
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>Opponent disconnected</p>
          )}
          {matchEndPayload.reason === 'timeout' && (
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>Match timed out</p>
          )}
          {matchEndPayload.matchMode === 'TUTORIAL' && (
            <p style={{ fontSize: '14px', color: '#4caf50', marginBottom: '16px' }}>
              Обучение завершено! Вы можете вернуться в меню.
            </p>
          )}
          <button
            onClick={onBackToMenu}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Back to Menu
          </button>
        </div>
      )}

      {dragState && (
        <div
          className="battle-card"
          style={{
            position: 'fixed',
            left: dragState.x,
            top: dragState.y,
            zIndex: 9999,
            pointerEvents: 'none'
          }}
        >
          {renderCard(dragState.card, 'HAND')}
        </div>
      )}
    </div>
  );
}
