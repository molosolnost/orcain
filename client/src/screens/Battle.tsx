import { useState, useEffect, useRef } from 'react';
import { socketManager } from '../net/socket';
import type { CardId, PrepStartPayload, StepRevealPayload, MatchEndPayload } from '../net/types';
import { cardIdToType } from '../cards';
import { lockAppHeight, unlockAppHeight } from '../lib/appViewport';

type BattleState = 'prep' | 'playing' | 'ended';

interface BattleProps {
  onBackToMenu: () => void;
  onPlayAgain?: () => void;
  matchMode?: 'pvp' | 'pve' | null;
  tokens: number | null;
  matchEndPayload: MatchEndPayload | null;
  lastPrepStart: PrepStartPayload | null;
  currentMatchId: string | null;
}

export default function Battle({ onBackToMenu, onPlayAgain, matchMode, tokens, matchEndPayload, lastPrepStart, currentMatchId }: BattleProps) {
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
  const draftToastTimeoutRef = useRef<number | null>(null); // Separate ref for draftToast timeout
  const slotOccupiedToastTimeoutRef = useRef<number | null>(null); // Separate ref for slotOccupiedToast timeout
  const lastAppliedRoundIndexRef = useRef<number | null>(null);
  const slotsRef = useRef<(CardId | null)[]>([null, null, null]);
  const phaseRef = useRef<'PREP' | 'REVEAL' | 'END'>('PREP');
  const currentMatchIdRef = useRef<string | null>(null);
  
  // UX Polish: Animation states
  const [slotPopAnimation, setSlotPopAnimation] = useState<number | null>(null); // slotIndex that just got a card
  const [draftToast, setDraftToast] = useState<string | null>(null); // "Card placed" / "Card removed"
  const [slotOccupiedToast, setSlotOccupiedToast] = useState<string | null>(null); // "Slot occupied" toast
  const [hpFlash, setHpFlash] = useState<{ type: 'your' | 'opp'; direction: 'up' | 'down' } | null>(null); // Which HP to flash and direction
  const [roundBanner, setRoundBanner] = useState<string | null>(null); // "Round X - PREP" / "Round X complete"
  const [revealAnimations, setRevealAnimations] = useState<Set<number>>(new Set()); // stepIndexes that should animate
  const [confirmButtonPressed, setConfirmButtonPressed] = useState(false);
  const prevYourHpRef = useRef<number>(10);
  const prevOppHpRef = useRef<number>(10);

  const DEBUG_MATCH = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

  // Sync currentMatchIdRef with prop
  useEffect(() => {
    currentMatchIdRef.current = currentMatchId;
  }, [currentMatchId]);

  useEffect(() => {
    lockAppHeight('battle_mount');
    return () => {
      unlockAppHeight('battle_unmount');
    };
  }, []);

  useEffect(() => {
    if (matchEndPayload) {
      setState('ended');
      setPhase('END');
      phaseRef.current = 'END';
      setYourHp(matchEndPayload.yourHp);
      setOppHp(matchEndPayload.oppHp);
      setCurrentStepIndex(null);
      // Останавливаем таймер при завершении матча
      setDeadlineTs(null);
      
      // CRITICAL: Cancel any pending draft on match end
      if (draftDebounceRef.current) {
        window.clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
        if (DEBUG_MATCH) {
          console.log(`[DRAFT_CANCEL] reason=match_end`);
        }
      }
      
      // CRITICAL: Immediately hide all toasts on match end
      setDraftToast(null);
      setSlotOccupiedToast(null);
      if (draftToastTimeoutRef.current) {
        window.clearTimeout(draftToastTimeoutRef.current);
        draftToastTimeoutRef.current = null;
      }
      if (slotOccupiedToastTimeoutRef.current) {
        window.clearTimeout(slotOccupiedToastTimeoutRef.current);
        slotOccupiedToastTimeoutRef.current = null;
      }
    } else {
      // Очищаем END состояние если matchEndPayload стал null
      if (phase === 'END') {
        setPhase('PREP');
        phaseRef.current = 'PREP';
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
    phaseRef.current = 'PREP';
    setNowTs(Date.now()); // Обновляем nowTs для корректного расчета таймера
    setDeadlineTs(lastPrepStart.deadlineTs); // deadlineTs - источник правды для таймера
    setYourHp(lastPrepStart.yourHp);
    setOppHp(lastPrepStart.oppHp);
    prevYourHpRef.current = lastPrepStart.yourHp;
    prevOppHpRef.current = lastPrepStart.oppHp;
    setPot(lastPrepStart.pot);
    setSuddenDeath(lastPrepStart.suddenDeath);
    // Use yourHand from server (source of truth)
    setYourHand(lastPrepStart.yourHand || []);
    
    // Никнеймы обновляем из prep_start (может быть более актуальная версия)
    // КРИТИЧНО: устанавливаем даже если undefined (null) - это явное значение
    // Это гарантирует что никнеймы будут показаны в R1 сразу после prep_start
    setYourNickname(lastPrepStart.yourNickname ?? null);
    setOppNickname(lastPrepStart.oppNickname ?? null);
    
    // Сбросить confirmed/layout/slot/выкладки только если это новый раунд
    if (isNewRound) {
      setState('prep');
      setSlots([null, null, null]);
      slotsRef.current = [null, null, null];
      setConfirmed(false);
      setRevealedCards([]);
      setCurrentStepIndex(null);
      lastAppliedRoundIndexRef.current = lastPrepStart.roundIndex;
      
      // UX: Round start banner
      const bannerText = lastPrepStart.suddenDeath 
        ? `Round ${lastPrepStart.roundIndex} — PREP (Sudden Death)`
        : `Round ${lastPrepStart.roundIndex} — PREP`;
      setRoundBanner(bannerText);
      setTimeout(() => setRoundBanner(null), 700);
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
      phaseRef.current = 'PREP';
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      prevYourHpRef.current = payload.yourHp;
      prevOppHpRef.current = payload.oppHp;
      setPot(payload.pot);
      setSlots([null, null, null]);
      slotsRef.current = [null, null, null];
      setConfirmed(false);
      setRevealedCards([]);
      setCurrentStepIndex(null);
      setRoundIndex(1);
      setNowTs(Date.now()); // Обновляем nowTs для таймера
      // Никнеймы устанавливаем сразу из match_found (источник правды для R1)
      // КРИТИЧНО: устанавливаем даже если undefined (null) - это явное значение
      setYourNickname(payload.yourNickname ?? null);
      setOppNickname(payload.oppNickname ?? null);
      // Hand устанавливаем из match_found (source of truth)
      setYourHand(payload.yourHand || []);
      // deadlineTs придет в prep_start, но уже сейчас готовы к его получению
      
      // DEBUG: Log match boot
      if (DEBUG_MATCH) {
        console.log(`[BATTLE_BOOT] matchId=${payload.matchId} yourHand=${JSON.stringify(payload.yourHand || [])}`);
      }
    });

    // Убрана прямая подписка на prep_start - теперь получаем через props (lastPrepStart)

    socketManager.onConfirmOk(() => {
      setConfirmed(true);
    });

    socketManager.onStepReveal((payload: StepRevealPayload) => {
      // CRITICAL: Cancel any pending draft on phase change (PREP -> REVEAL)
      // DO NOT flush draft in REVEAL - server will use last draft from PREP
      if (draftDebounceRef.current) {
        window.clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
        if (DEBUG_MATCH) {
          console.log(`[DRAFT_CANCEL] reason=phase_change_to_reveal`);
        }
      }
      
      // CRITICAL: Hide all toasts on phase change (PREP -> REVEAL)
      setDraftToast(null);
      setSlotOccupiedToast(null);
      if (draftToastTimeoutRef.current) {
        window.clearTimeout(draftToastTimeoutRef.current);
        draftToastTimeoutRef.current = null;
      }
      if (slotOccupiedToastTimeoutRef.current) {
        window.clearTimeout(slotOccupiedToastTimeoutRef.current);
        slotOccupiedToastTimeoutRef.current = null;
      }
      
      setState('playing');
      setPhase('REVEAL');
      phaseRef.current = 'REVEAL';
      
      // UX: HP feedback (flash red if decreased, green if increased)
      const prevYourHp = prevYourHpRef.current;
      const prevOppHp = prevOppHpRef.current;
      
      if (payload.yourHp < prevYourHp) {
        setHpFlash({ type: 'your', direction: 'down' });
        setTimeout(() => setHpFlash(null), 400);
      } else if (payload.yourHp > prevYourHp) {
        setHpFlash({ type: 'your', direction: 'up' });
        setTimeout(() => setHpFlash(null), 400);
      }
      if (payload.oppHp < prevOppHp) {
        setHpFlash({ type: 'opp', direction: 'down' });
        setTimeout(() => setHpFlash(null), 400);
      } else if (payload.oppHp > prevOppHp) {
        setHpFlash({ type: 'opp', direction: 'up' });
        setTimeout(() => setHpFlash(null), 400);
      }
      
      prevYourHpRef.current = payload.yourHp;
      prevOppHpRef.current = payload.oppHp;
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      setCurrentStepIndex(payload.stepIndex);
      
      // UX: Reveal animation trigger (for both your and opp cards)
      setRevealAnimations(prev => new Set([...prev, payload.stepIndex]));
      setTimeout(() => {
        setRevealAnimations(prev => {
          const next = new Set(prev);
          next.delete(payload.stepIndex);
          return next;
        });
      }, 600);
      
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
      phaseRef.current = 'PREP';
      
      // UX: Round end banner
      setRoundBanner(`Round ${roundIndex} complete`);
      setTimeout(() => setRoundBanner(null), 700);
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
      // CRITICAL: Flush any pending draft on unmount ONLY if still in PREP
      if (phaseRef.current === 'PREP' && draftDebounceRef.current && slotsRef.current.length === 3) {
        flushDraft(slotsRef.current);
      } else if (draftDebounceRef.current) {
        // Cancel draft if not in PREP
        window.clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
        if (DEBUG_MATCH) {
          console.log(`[DRAFT_CANCEL] reason=unmount_phase_not_prep phase=${phaseRef.current}`);
        }
      }
      
      // CRITICAL: Clear all toast timeouts and states on unmount
      setDraftToast(null);
      setSlotOccupiedToast(null);
      if (draftToastTimeoutRef.current) {
        window.clearTimeout(draftToastTimeoutRef.current);
        draftToastTimeoutRef.current = null;
      }
      if (slotOccupiedToastTimeoutRef.current) {
        window.clearTimeout(slotOccupiedToastTimeoutRef.current);
        slotOccupiedToastTimeoutRef.current = null;
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

  const flushDraft = (slotsToSend: (CardId | null)[]) => {
    const matchId = currentMatchIdRef.current;
    const currentPhase = phaseRef.current;
    
    // GUARD: Only send draft in PREP phase
    if (currentPhase !== 'PREP') {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_BLOCKED] reason=phase_not_prep phase=${currentPhase} matchId=${matchId || 'null'}`);
      }
      return;
    }
    
    if (!matchId) {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_BLOCKED] reason=no_match_id phase=${currentPhase}`);
      }
      return;
    }
    
    if (draftDebounceRef.current) {
      window.clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    const layoutWithNulls: (string | null)[] = slotsToSend.map(toCardCode);
    if (layoutWithNulls.length === 3) {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_SEND] matchId=${matchId} layout=${JSON.stringify(layoutWithNulls)}`);
      }
      socketManager.layoutDraft(matchId, layoutWithNulls);
    }
  };

  const scheduleDraft = (nextSlots: (CardId | null)[]) => {
    const currentPhase = phaseRef.current;
    const matchId = currentMatchIdRef.current;
    
    // GUARD: Only schedule draft in PREP phase
    if (currentPhase !== 'PREP') {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_BLOCKED] reason=phase_not_prep phase=${currentPhase} matchId=${matchId || 'null'}`);
      }
      return;
    }
    
    if (!matchId) {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_BLOCKED] reason=no_match_id phase=${currentPhase}`);
      }
      return;
    }
    
    if (draftDebounceRef.current) {
      window.clearTimeout(draftDebounceRef.current);
    }
    draftDebounceRef.current = window.setTimeout(() => {
      flushDraft(nextSlots);
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
    // GUARD: Only update slots and schedule draft in PREP phase
    const currentPhase = phaseRef.current;
    if (currentPhase !== 'PREP') {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_BLOCKED] reason=phase_not_prep phase=${currentPhase} action=applySlotsUpdate`);
      }
      return;
    }
    
    setSlots(prev => {
      const next = updater(prev);
      slotsRef.current = next; // Keep ref in sync
      scheduleDraft(next);
      return next;
    });
  };

  const applyDropToSlot = (card: CardId, slotIndex: number, sourceSlotIndex: number | null) => {
    if (!canInteract) return;
    
    // UX: Check if slot is occupied (and not swapping from same slot)
    const targetSlotCard = slots[slotIndex];
    if (targetSlotCard !== null && sourceSlotIndex !== slotIndex) {
      // Slot is occupied - show toast and prevent drop (only in PREP phase)
      if (phaseRef.current === 'PREP') {
        if (slotOccupiedToastTimeoutRef.current) {
          clearTimeout(slotOccupiedToastTimeoutRef.current);
        }
        setSlotOccupiedToast('Слот занят. Убери карту или выбери другой слот.');
        slotOccupiedToastTimeoutRef.current = window.setTimeout(() => {
          setSlotOccupiedToast(null);
          slotOccupiedToastTimeoutRef.current = null;
        }, 800);
      }
      return;
    }
    
    applySlotsUpdate(prev => {
      const next = [...prev];
      const oldSlotIndex = prev.indexOf(card);
      const wasEmpty = prev[slotIndex] === null;

      if (oldSlotIndex !== -1) {
        next[oldSlotIndex] = null;
      }

      if (sourceSlotIndex !== null && sourceSlotIndex !== oldSlotIndex) {
        next[sourceSlotIndex] = null;
      }

      next[slotIndex] = card;
      
      // DEBUG: Log local draft state
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_LOCAL] matchId=${currentMatchId} slotsRaw=${JSON.stringify(next)} mappedLayout=${JSON.stringify(next.map(toCardCode))}`);
      }
      
      // UX: Pop animation for slot that received card
      if (wasEmpty) {
        setSlotPopAnimation(slotIndex);
        setTimeout(() => setSlotPopAnimation(null), 300);
        
        // UX: Toast feedback (only in PREP phase)
        if (phaseRef.current === 'PREP') {
          if (draftToastTimeoutRef.current) {
            clearTimeout(draftToastTimeoutRef.current);
          }
          setDraftToast('Card placed');
          draftToastTimeoutRef.current = window.setTimeout(() => {
            setDraftToast(null);
            draftToastTimeoutRef.current = null;
          }, 600);
        }
      }
      
      return next;
    });
  };
  
  // UX: Remove card from slot on tap/click (mobile-friendly)
  const handleSlotClick = (slotIndex: number) => {
    if (!canInteract) return;
    if (phaseRef.current !== 'PREP') return;
    if (slots[slotIndex] === null) return; // Empty slot, nothing to remove
    
    applySlotsUpdate(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      
      // UX: Toast feedback (only in PREP phase)
      if (phaseRef.current === 'PREP') {
        if (draftToastTimeoutRef.current) {
          clearTimeout(draftToastTimeoutRef.current);
        }
        setDraftToast('Card removed');
        draftToastTimeoutRef.current = window.setTimeout(() => {
          setDraftToast(null);
          draftToastTimeoutRef.current = null;
        }, 600);
      }
      
      return next;
    });
  };

  const clearSlotIfNeeded = (sourceSlotIndex: number | null) => {
    if (sourceSlotIndex === null) return;
    applySlotsUpdate(prev => {
      const next = [...prev];
      next[sourceSlotIndex] = null;
      
      // UX: Toast feedback for card removal (only in PREP phase)
      if (phaseRef.current === 'PREP') {
        if (draftToastTimeoutRef.current) {
          clearTimeout(draftToastTimeoutRef.current);
        }
        setDraftToast('Card removed');
        draftToastTimeoutRef.current = window.setTimeout(() => {
          setDraftToast(null);
          draftToastTimeoutRef.current = null;
        }, 600);
      }
      
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
    
    // UX: Block drag-start if all slots are full (X==3)
    const slotsCount = slots.filter(c => c !== null).length;
    if (slotsCount === 3 && sourceSlotIndex === null) {
      // All slots full, prevent dragging new cards from hand
      return;
    }

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
    
    // GUARD: Only confirm in PREP phase
    if (phaseRef.current !== 'PREP') {
      if (DEBUG_MATCH) {
        console.log(`[DRAFT_BLOCKED] reason=phase_not_prep phase=${phaseRef.current} action=handleConfirm`);
      }
      return;
    }
    
    // CRITICAL: Flush any pending draft before confirm (only in PREP)
    if (draftDebounceRef.current) {
      flushDraft(slots);
    }
    
    // After confirm, cancel any future draft sends until next prep_start
    if (draftDebounceRef.current) {
      window.clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    
    // UX: Button press feedback
    setConfirmButtonPressed(true);
    setTimeout(() => setConfirmButtonPressed(false), 200);
    
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

  // BattleShell: статичная оболочка до prep_start. Не меняет размеры DOM, без карт и тяжёлого layout.
  // Рендер игрового поля — только после prep_start, без анимаций при первом появлении.
  if (!lastPrepStart) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          contain: 'layout paint size style',
          isolation: 'isolate',
          transform: 'translateZ(0)',
          backgroundColor: '#242424',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {matchEndPayload ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <p style={{ marginBottom: 16, color: 'rgba(255,255,255,0.9)' }}>
              {matchEndPayload.winner === 'YOU' ? 'Победа' : 'Поражение'}
            </p>
            <button
              onClick={onBackToMenu}
              style={{
                padding: '12px 24px',
                fontSize: 16,
                cursor: 'pointer',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
              }}
            >
              Back to Menu
            </button>
          </div>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Подготовка боя…</span>
        )}
      </div>
    );
  }

  return (
    <div style={{ 
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      contain: 'layout paint size style',
      isolation: 'isolate',
      transform: 'translateZ(0)',
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
          <span 
            style={{ 
              color: '#4caf50',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              maxWidth: '80px',
              transition: hpFlash?.type === 'your' ? 'background-color 0.3s ease' : 'none',
              backgroundColor: hpFlash?.type === 'your' 
                ? (hpFlash.direction === 'down' ? 'rgba(244, 67, 54, 0.3)' : 'rgba(76, 175, 80, 0.3)')
                : 'transparent',
              padding: hpFlash?.type === 'your' ? '2px 4px' : '0',
              borderRadius: hpFlash?.type === 'your' ? '4px' : '0'
            }}
          >
            {(yourNickname || 'You').length > 10 ? (yourNickname || 'You').substring(0, 10) + '...' : (yourNickname || 'You')}: {yourHp}
          </span>
          <span 
            style={{ 
              color: '#f44336',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              maxWidth: '80px',
              transition: hpFlash?.type === 'opp' ? 'background-color 0.3s ease' : 'none',
              backgroundColor: hpFlash?.type === 'opp' 
                ? (hpFlash.direction === 'down' ? 'rgba(244, 67, 54, 0.3)' : 'rgba(76, 175, 80, 0.3)')
                : 'transparent',
              padding: hpFlash?.type === 'opp' ? '2px 4px' : '0',
              borderRadius: hpFlash?.type === 'opp' ? '4px' : '0'
            }}
          >
            {(oppNickname || 'Opp').length > 10 ? (oppNickname || 'Opp').substring(0, 10) + '...' : (oppNickname || 'Opp')}: {oppHp}
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
            const isRevealing = revealAnimations.has(index);
            // В PREP всегда рубашка, в REVEAL показываем только если это текущий шаг или уже был вскрыт
            const shouldShowRevealed = phase !== 'PREP' && revealed && (isCurrentStep || phase === 'END');
            
            return (
              <div
                key={index}
                style={{
                  border: isCurrentStep ? '2px solid #ff6b6b' : 'none',
                  borderRadius: '8px',
                  padding: isCurrentStep ? '1px' : '0',
                  transform: isRevealing ? 'translateY(-4px)' : 'translateY(0)',
                  opacity: isRevealing ? 0 : 1,
                  transition: isRevealing 
                    ? 'opacity 0.2s ease-in, transform 0.3s ease-out' 
                    : 'transform 0.2s ease, opacity 0.2s ease'
                }}
              >
                {shouldShowRevealed ? (
                  <div
                    style={{
                      animation: isRevealing ? 'cardReveal 0.4s ease-out' : 'none',
                      filter: isRevealing ? 'drop-shadow(0 0 8px rgba(255, 107, 107, 0.6))' : 'none',
                      transition: isRevealing ? 'filter 0.3s ease-out' : 'filter 0.2s ease'
                    }}
                  >
                    {renderCard(revealed.oppCard, 'REVEAL', index)}
                  </div>
                ) : (
                  renderCard(null, 'BACK')
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Indicator: X/3 cards selected */}
      {state === 'prep' && !confirmed && (
        <div style={{
          flexShrink: 0,
          textAlign: 'center',
          padding: '4px 12px',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#fff'
        }}>
          Выбрано: {slots.filter(c => c !== null).length}/3
        </div>
      )}

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
            const isPopping = slotPopAnimation === index;
            const isRevealing = revealAnimations.has(index);
            
            // UX: Slot border states
            let border = 'none';
            if (isCurrentStep) {
              border = '2px solid #ff6b6b';
            } else if (isHovered) {
              border = '2px solid #4caf50';
            } else if (displayCard) {
              border = '2px solid rgba(255, 255, 255, 0.3)';
            } else {
              border = '2px dashed rgba(255, 255, 255, 0.2)';
            }

            return (
              <div
                key={index}
                data-slot-index={index}
                style={{
                  border,
                  borderRadius: '8px',
                  padding: border !== 'none' ? '1px' : '0',
                  cursor: canInteract ? 'pointer' : 'default',
                  boxShadow: isHovered ? `0 0 0 2px rgba(76, 175, 80, 0.3)` : 'none',
                  transform: isPopping ? 'scale(1.03)' : isRevealing ? 'translateY(-4px)' : 'scale(1)',
                  opacity: isRevealing ? 0 : 1,
                  transition: isPopping 
                    ? 'transform 0.15s ease-out' 
                    : isRevealing 
                    ? 'opacity 0.2s ease-in, transform 0.3s ease-out'
                    : 'transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease',
                  position: 'relative'
                }}
                onClick={(e) => {
                  // UX: Tap/click on occupied slot removes card (only in PREP)
                  if (canInteract && phaseRef.current === 'PREP' && displayCard && !dragState) {
                    e.stopPropagation();
                    handleSlotClick(index);
                  }
                }}
              >
                {displayCard ? (
                  <>
                    <div
                      className="battle-card"
                      onPointerDown={(e) => handlePointerDown(e, displayCard, index)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerEnd}
                      onPointerCancel={handlePointerCancel}
                      style={{
                        transform: isRevealing ? 'scale(1.05)' : 'scale(1)',
                        filter: isRevealing ? 'drop-shadow(0 0 8px rgba(76, 175, 80, 0.6))' : 'none',
                        transition: isRevealing ? 'transform 0.3s ease-out, filter 0.3s ease-out' : 'transform 0.2s ease'
                      }}
                    >
                      {renderCard(displayCard, 'SLOT', index)}
                    </div>
                    {/* UX: X button to remove card (only in PREP) */}
                    {canInteract && phaseRef.current === 'PREP' && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSlotClick(index);
                        }}
                        style={{
                          position: 'absolute',
                          top: '-6px',
                          right: '-6px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(244, 67, 54, 0.9)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          zIndex: 10,
                          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                          userSelect: 'none',
                          touchAction: 'none'
                        }}
                      >
                        ✕
                      </div>
                    )}
                  </>
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
              const slotsCount = slots.filter(c => c !== null).length;
              const isBlocked = slotsCount === 3 && !inSlot; // Block if all slots full and card not in slot
              const cardElement = renderCard(cardId, 'HAND');

              return (
                <div
                  key={cardId}
                  className="battle-card"
                  onPointerDown={(e) => {
                    if (isBlocked) {
                      e.preventDefault();
                      return;
                    }
                    handlePointerDown(e, cardId, null);
                  }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerCancel}
                  style={{
                    opacity: inSlot ? 0.5 : isDraggingCard ? 0.25 : isBlocked ? 0.35 : 1,
                    cursor: canInteract && !inSlot && !isBlocked ? 'grab' : isBlocked ? 'not-allowed' : 'default',
                    userSelect: 'none',
                    touchAction: 'none',
                    filter: isBlocked ? 'grayscale(0.5) brightness(0.7)' : 'none',
                    transition: 'opacity 0.2s ease, filter 0.2s ease'
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            {(() => {
              const slotsCount = slots.filter(c => c !== null).length;
              if (slotsCount < 3) {
                return (
                  <div style={{ fontSize: '11px', color: '#999', opacity: 0.7 }}>
                    Положи ещё {3 - slotsCount} карт{3 - slotsCount !== 1 ? 'ы' : 'у'}, чтобы подтвердить ход
                  </div>
                );
              } else {
                return (
                  <div style={{ fontSize: '11px', color: '#4caf50', opacity: 0.9 }}>
                    Готово! Нажми Confirm
                  </div>
                );
              }
            })()}
            <button
              onClick={handleConfirm}
              disabled={slots.filter(c => c !== null).length !== 3}
              style={{
                padding: '14px 32px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: slots.filter(c => c !== null).length === 3 ? 'pointer' : 'not-allowed',
                minWidth: '140px',
                minHeight: '48px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: slots.filter(c => c !== null).length === 3 ? '#4caf50' : '#666',
                color: '#fff',
                transition: 'background-color 0.2s, transform 0.1s ease, opacity 0.1s ease, box-shadow 0.2s ease',
                transform: confirmButtonPressed ? 'scale(0.95)' : 'scale(1)',
                opacity: confirmButtonPressed ? 0.8 : 1,
                boxShadow: slots.filter(c => c !== null).length === 3 
                  ? '0 0 12px rgba(76, 175, 80, 0.4)' 
                  : 'none'
              }}
            >
              Confirm
            </button>
          </div>
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

      {/* Match End Screen */}
      {matchEndPayload && (() => {
        const getResultTitle = () => {
          if (matchEndPayload.winner === 'YOU') return 'Победа';
          if (matchEndPayload.reason === 'timeout' && !matchEndPayload.winnerId) return 'Ничья';
          return 'Поражение';
        };
        
        const getReasonText = () => {
          switch (matchEndPayload.reason) {
            case 'normal':
              return 'Матч завершён';
            case 'timeout':
              return matchEndPayload.winnerId ? 'Противник бездействовал' : 'Оба бездействовали (токены сгорели)';
            case 'disconnect':
              return 'Противник отключился';
            default:
              return 'Матч завершён';
          }
        };
        
        return (
          <div style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.92)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '24px',
            textAlign: 'center',
            animation: 'fadeIn 0.3s ease-in'
          }}>
            <div style={{
              backgroundColor: 'rgba(36, 36, 36, 0.95)',
              borderRadius: '12px',
              padding: '28px 24px',
              maxWidth: '90vw',
              width: 'min(400px, 90vw)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              transform: 'translateY(0)',
              animation: 'slideUp 0.4s ease-out'
            }}>
              <h2 style={{ 
                fontSize: 'clamp(24px, 6vw, 32px)', 
                marginBottom: '8px',
                color: matchEndPayload.winner === 'YOU' ? '#4caf50' : (matchEndPayload.reason === 'timeout' && !matchEndPayload.winnerId ? '#ffa726' : '#f44336'),
                fontWeight: 'bold'
              }}>
                {getResultTitle()}
              </h2>
              <p style={{ 
                fontSize: 'clamp(12px, 3vw, 14px)', 
                color: '#999', 
                marginBottom: '20px' 
              }}>
                {getReasonText()}
              </p>
              
              {/* Счёт */}
              <div style={{
                marginBottom: '20px',
                padding: '12px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '8px'
              }}>
                <div style={{ fontSize: 'clamp(13px, 3.5vw, 15px)', marginBottom: '8px', color: '#ccc' }}>
                  Счёт
                </div>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-around', 
                  fontSize: 'clamp(14px, 4vw, 16px)',
                  fontWeight: 'bold'
                }}>
                  <span style={{ color: '#4caf50' }}>
                    Ты: {matchEndPayload.yourHp}
                  </span>
                  <span style={{ color: '#f44336' }}>
                    Противник: {matchEndPayload.oppHp}
                  </span>
                </div>
                {lastPrepStart && (
                  <div style={{ 
                    fontSize: 'clamp(11px, 2.8vw, 13px)', 
                    color: '#999', 
                    marginTop: '8px' 
                  }}>
                    Раунд {lastPrepStart.roundIndex}
                  </div>
                )}
              </div>
              
              {/* Экономика (если токены доступны) */}
              {matchEndPayload.yourTokens !== undefined && (
                <div style={{
                  marginBottom: '20px',
                  fontSize: 'clamp(13px, 3.5vw, 15px)',
                  color: '#ccc'
                }}>
                  Токены: {matchEndPayload.yourTokens}
                </div>
              )}
              
              {/* Кнопки */}
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '12px',
                marginTop: '24px'
              }}>
                {onPlayAgain && matchMode && (
                  <button
                    onClick={onPlayAgain}
                    style={{
                      padding: '14px 24px',
                      fontSize: 'clamp(14px, 4vw, 16px)',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      backgroundColor: '#4caf50',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      transition: 'opacity 0.2s, transform 0.1s',
                      minHeight: '48px'
                    }}
                  >
                    Сыграть ещё
                  </button>
                )}
                <button
                  onClick={onBackToMenu}
                  style={{
                    padding: '14px 24px',
                    fontSize: 'clamp(14px, 4vw, 16px)',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '8px',
                    transition: 'opacity 0.2s, transform 0.1s',
                    minHeight: '48px'
                  }}
                >
                  Back to Menu
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* UX: Slot occupied toast (only in PREP phase) */}
      {slotOccupiedToast && phase === 'PREP' && (
        <div style={{
          position: 'fixed',
          bottom: '120px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(244, 67, 54, 0.95)',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: '500',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap',
          maxWidth: '90vw',
          textAlign: 'center'
        }}>
          {slotOccupiedToast}
        </div>
      )}

      {/* UX: Draft toast feedback (only in PREP phase) */}
      {draftToast && phase === 'PREP' && (
        <div style={{
          position: 'fixed',
          bottom: '120px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: '#fff',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '12px',
          zIndex: 10000,
          pointerEvents: 'none',
          animation: 'fadeInOut 0.6s ease'
        }}>
          {draftToast}
        </div>
      )}

      {/* UX: Round transition banner */}
      {roundBanner && (
        <div style={{
          position: 'fixed',
          top: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 'bold',
          zIndex: 10001,
          pointerEvents: 'none',
          animation: 'fadeInOut 0.7s ease',
          border: '1px solid rgba(255, 255, 255, 0.2)'
        }}>
          {roundBanner}
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
            pointerEvents: 'none',
            transform: 'rotate(5deg)',
            opacity: 0.9
          }}
        >
          {renderCard(dragState.card, 'HAND')}
        </div>
      )}
    </div>
  );
}
