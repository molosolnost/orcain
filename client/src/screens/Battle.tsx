import { useState, useEffect, useRef } from 'react';
import { socketManager } from '../net/socket';
import type { CardId, PrepStartPayload, StepRevealPayload, MatchEndPayload } from '../net/types';
import { lockAppHeight, unlockAppHeight } from '../lib/appViewport';
import battleBgImage from '../assets/orc-theme/battle_bg.svg';
import cardAttackImage from '../assets/orc-theme/card_attack.svg';
import cardDefenseImage from '../assets/orc-theme/card_defense.svg';
import cardHealImage from '../assets/orc-theme/card_heal.svg';
import cardCounterImage from '../assets/orc-theme/card_counter.svg';
import cardBackImage from '../assets/orc-theme/card_back.svg';
import cardSlotImage from '../assets/orc-theme/card_slot.svg';
import confirmButtonImage from '../assets/orc-theme/btn_confirm.svg';
import secondaryButtonImage from '../assets/orc-theme/btn_secondary.svg';
import cancelButtonImage from '../assets/orc-theme/btn_cancel.svg';
import topOrnamentImage from '../assets/orc-theme/ornament_top.svg';
import bottomOrnamentImage from '../assets/orc-theme/ornament_bottom.svg';

type BattleState = 'prep' | 'playing' | 'ended';
type TutorialStepId =
  | 'intro'
  | 'cards'
  | 'place_attack'
  | 'place_defense'
  | 'place_heal'
  | 'confirm'
  | 'reveal_1'
  | 'reveal_2'
  | 'reveal_3'
  | 'pvp_tactics'
  | 'finish';

interface TutorialStepConfig {
  id: TutorialStepId;
  title: string;
  body: string;
  action: string;
  autoAdvance: boolean;
}

const TUTORIAL_STEPS: TutorialStepConfig[] = [
  {
    id: 'intro',
    title: 'Шаг 1/11: Как устроен раунд',
    body: 'Раунд всегда состоит из двух фаз: «Планирование» и «Вскрытие». Сначала ты выкладываешь 3 карты, потом карты открываются по шагам слева направо.',
    action: 'Нажми «Дальше», чтобы изучить карты.',
    autoAdvance: false
  },
  {
    id: 'cards',
    title: 'Шаг 2/11: Карты и их роли',
    body: 'Attack наносит 2 урона. Defense блокирует Attack. Heal даёт +1 HP. Counter отражает Attack обратно в соперника. Эти 4 карты и есть база всей тактики.',
    action: 'Нажми «Дальше», начнем раскладывать карты по слотам.',
    autoAdvance: false
  },
  {
    id: 'place_attack',
    title: 'Шаг 3/11: Поставь Attack в слот 1',
    body: 'Первый слот открывается первым. Начни ход с Attack: так ты проверяешь реакцию соперника на раннюю агрессию.',
    action: 'Перетащи Attack в первый слот S1.',
    autoAdvance: true
  },
  {
    id: 'place_defense',
    title: 'Шаг 4/11: Поставь Defense в слот 2',
    body: 'Второй слот нужен как страховка, если соперник ответит Attack после первого шага.',
    action: 'Перетащи Defense во второй слот S2.',
    autoAdvance: true
  },
  {
    id: 'place_heal',
    title: 'Шаг 5/11: Поставь Heal в слот 3',
    body: 'Третий слот часто используют для добора HP к концу раунда.',
    action: 'Перетащи Heal в третий слот S3.',
    autoAdvance: true
  },
  {
    id: 'confirm',
    title: 'Шаг 6/11: Подтверди расклад',
    body: 'После Confirm порядок карт фиксируется. В реальном матче после этого менять ход нельзя.',
    action: 'Нажми кнопку Confirm.',
    autoAdvance: true
  },
  {
    id: 'reveal_1',
    title: 'Шаг 7/11: Вскрытие шага 1',
    body: 'Сейчас вручную откроем первый обмен, чтобы ты видел, как работают карты без спешки.',
    action: 'Нажми «Показать шаг» и посмотри результат.',
    autoAdvance: true
  },
  {
    id: 'reveal_2',
    title: 'Шаг 8/11: Вскрытие шага 2',
    body: 'Сравни вторые карты и обрати внимание на HP после их взаимодействия.',
    action: 'Нажми «Показать шаг».',
    autoAdvance: true
  },
  {
    id: 'reveal_3',
    title: 'Шаг 9/11: Вскрытие шага 3',
    body: 'Финальный обмен завершит раунд. Именно так читается итоговое преимущество по HP.',
    action: 'Нажми «Показать шаг».',
    autoAdvance: true
  },
  {
    id: 'pvp_tactics',
    title: 'Шаг 10/11: Мини-тактики против реальных игроков',
    body: 'Не повторяй один и тот же порядок. Если соперник часто открывает Attack в начале, ставь Defense/Counter в первом слоте. Если видишь осторожную игру, наказывай Attack. Heal лучше прятать в шаг, где по тебе реже бьют.',
    action: 'Нажми «Дальше», чтобы завершить обучение.',
    autoAdvance: false
  },
  {
    id: 'finish',
    title: 'Шаг 11/11: Готов к PvP',
    body: 'Ты разобрал базовый цикл матча, карты и чтение вскрытий. Теперь можно идти в Start Battle и отрабатывать предсказание реальных соперников.',
    action: 'Нажми «Завершить обучение» и вернись в меню.',
    autoAdvance: false
  }
];

const PHASE_LABELS: Record<'PREP' | 'REVEAL' | 'END', string> = {
  PREP: 'Планирование',
  REVEAL: 'Вскрытие',
  END: 'Финал'
};

const CARD_LABELS: Record<CardId, string> = {
  attack: 'Attack',
  defense: 'Defense',
  heal: 'Heal',
  counter: 'Counter'
};

const CARD_ART: Record<CardId, string> = {
  attack: cardAttackImage,
  defense: cardDefenseImage,
  heal: cardHealImage,
  counter: cardCounterImage
};

const TUTORIAL_PLAYER_LAYOUT: CardId[] = ['attack', 'defense', 'heal'];
const TUTORIAL_OPP_LAYOUT: CardId[] = ['defense', 'attack', 'heal'];

interface BattleProps {
  onBackToMenu: () => void;
  onPlayAgain?: () => void;
  onTutorialComplete?: () => void;
  matchMode?: 'pvp' | 'pve' | null;
  tutorialMode?: boolean;
  tokens: number | null;
  matchEndPayload: MatchEndPayload | null;
  lastPrepStart: PrepStartPayload | null;
  currentMatchId: string | null;
}

export default function Battle({
  onBackToMenu,
  onPlayAgain,
  onTutorialComplete,
  matchMode,
  tutorialMode,
  tokens,
  matchEndPayload,
  lastPrepStart,
  currentMatchId
}: BattleProps) {
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
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );

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
  const autoConfirmTimeoutRef = useRef<number | null>(null);
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
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const prevYourHpRef = useRef<number>(10);
  const prevOppHpRef = useRef<number>(10);

  const DEBUG_MATCH = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
  const isCompactHeight = viewportHeight < 740;
  const isUltraCompactHeight = viewportHeight < 680;
  const selectedSlotsCount = slots.filter(c => c !== null).length;
  const tutorialEnabled = Boolean(tutorialMode);
  const currentTutorialStep = tutorialEnabled ? TUTORIAL_STEPS[Math.min(tutorialStepIndex, TUTORIAL_STEPS.length - 1)] : null;
  const tutorialHandUnlocked = !tutorialEnabled || tutorialStepIndex >= 2;
  const tutorialConfirmUnlocked = !tutorialEnabled || tutorialStepIndex >= 5;
  const phaseLabel = PHASE_LABELS[phase];

  const tutorialPlacementTarget: { card: CardId; slotIndex: number } | null = (() => {
    if (!tutorialEnabled || !currentTutorialStep) return null;
    if (currentTutorialStep.id === 'place_attack') return { card: 'attack', slotIndex: 0 };
    if (currentTutorialStep.id === 'place_defense') return { card: 'defense', slotIndex: 1 };
    if (currentTutorialStep.id === 'place_heal') return { card: 'heal', slotIndex: 2 };
    return null;
  })();

  // Sync currentMatchIdRef with prop
  useEffect(() => {
    currentMatchIdRef.current = currentMatchId;
  }, [currentMatchId]);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
        ? `Раунд ${lastPrepStart.roundIndex} — ${PHASE_LABELS.PREP} (Sudden Death)`
        : `Раунд ${lastPrepStart.roundIndex} — ${PHASE_LABELS.PREP}`;
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
    if (!socket || tutorialEnabled) return;

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
      setRoundBanner(`Раунд ${roundIndex} завершен`);
      setTimeout(() => setRoundBanner(null), 700);
    });

    return () => {
      socketManager.off('confirm_ok');
      socketManager.off('step_reveal');
      socketManager.off('round_end');
    };
  }, [tutorialEnabled]);

  // Вычисляемый countdownSeconds - источник правды для таймера
  // Всегда вычисляем от deadlineTs и текущего времени
  const computedSeconds = (() => {
    if (tutorialEnabled) {
      return null;
    }
    if (phase === 'PREP' && deadlineTs !== null) {
      const baseNow = nowTs || Date.now();
      const secs = Math.max(0, Math.ceil((deadlineTs - baseNow) / 1000));
      return isNaN(secs) ? 0 : secs;
    }
    return null;
  })();

  // Таймер для обновления countdown - стартует сразу при получении deadlineTs
  useEffect(() => {
    if (tutorialEnabled) {
      return;
    }
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
  }, [tutorialEnabled, phase, deadlineTs, roundIndex]);

  useEffect(() => {
    if (!tutorialEnabled) {
      setTutorialStepIndex(0);
      return;
    }

    setState('prep');
    setPhase('PREP');
    phaseRef.current = 'PREP';
    setRoundIndex(1);
    setDeadlineTs(null);
    setNowTs(Date.now());
    setYourHp(8);
    setOppHp(8);
    prevYourHpRef.current = 8;
    prevOppHpRef.current = 8;
    setPot(0);
    setSuddenDeath(false);
    setYourHand(['attack', 'defense', 'heal', 'counter']);
    setSlots([null, null, null]);
    slotsRef.current = [null, null, null];
    setConfirmed(false);
    setRevealedCards([]);
    setCurrentStepIndex(null);
    setYourNickname('You');
    setOppNickname('Coach Bot');
    setDraftToast(null);
    setSlotOccupiedToast(null);
    setTutorialStepIndex(0);
  }, [tutorialEnabled, currentMatchId]);

  useEffect(() => {
    if (!tutorialEnabled || !currentTutorialStep || !currentTutorialStep.autoAdvance) return;

    if (currentTutorialStep.id === 'place_attack' && slots[0] === 'attack') {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
      return;
    }
    if (currentTutorialStep.id === 'place_defense' && slots[0] === 'attack' && slots[1] === 'defense') {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
      return;
    }
    if (currentTutorialStep.id === 'place_heal' && slots[0] === 'attack' && slots[1] === 'defense' && slots[2] === 'heal') {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
      return;
    }
    if (currentTutorialStep.id === 'confirm' && confirmed) {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
      return;
    }
    if (currentTutorialStep.id === 'reveal_1' && revealedCards[0]) {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
      return;
    }
    if (currentTutorialStep.id === 'reveal_2' && revealedCards[1]) {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
      return;
    }
    if (currentTutorialStep.id === 'reveal_3' && revealedCards[2]) {
      setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
    }
  }, [tutorialEnabled, currentTutorialStep, slots, confirmed, revealedCards]);

  const canInteract = state === 'prep' && !confirmed && tutorialHandUnlocked;

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
      if (autoConfirmTimeoutRef.current) {
        clearTimeout(autoConfirmTimeoutRef.current);
        autoConfirmTimeoutRef.current = null;
      }
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

  const showTutorialHint = (message: string) => {
    if (draftToastTimeoutRef.current) {
      clearTimeout(draftToastTimeoutRef.current);
    }
    setDraftToast(message);
    draftToastTimeoutRef.current = window.setTimeout(() => {
      setDraftToast(null);
      draftToastTimeoutRef.current = null;
    }, 1000);
  };

  const applyDropToSlot = (card: CardId, slotIndex: number, sourceSlotIndex: number | null) => {
    if (!canInteract) return;

    if (tutorialPlacementTarget) {
      if (card !== tutorialPlacementTarget.card) {
        showTutorialHint(`Сейчас нужна карта ${CARD_LABELS[tutorialPlacementTarget.card]}`);
        return;
      }
      if (slotIndex !== tutorialPlacementTarget.slotIndex) {
        showTutorialHint(`Положи карту в слот S${tutorialPlacementTarget.slotIndex + 1}`);
        return;
      }
    }
    
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
    if (sourceSlotIndex === null && tutorialPlacementTarget && card !== tutorialPlacementTarget.card) {
      showTutorialHint(`Сейчас выбери ${CARD_LABELS[tutorialPlacementTarget.card]}`);
      return;
    }
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
    if (!tutorialConfirmUnlocked) return;
    const layout = slots.filter((card): card is CardId => card !== null);
    if (layout.length !== 3) return;

    if (tutorialEnabled) {
      const exactLayout =
        slots[0] === TUTORIAL_PLAYER_LAYOUT[0] &&
        slots[1] === TUTORIAL_PLAYER_LAYOUT[1] &&
        slots[2] === TUTORIAL_PLAYER_LAYOUT[2];
      if (!exactLayout) {
        showTutorialHint('Для обучения используй порядок: Attack -> Defense -> Heal');
        return;
      }

      setConfirmButtonPressed(true);
      setTimeout(() => setConfirmButtonPressed(false), 200);
      setConfirmed(true);
      setState('playing');
      setPhase('REVEAL');
      phaseRef.current = 'REVEAL';
      setCurrentStepIndex(null);
      setRevealedCards([]);
      setRoundBanner('План готов. Переходим к вскрытию');
      setTimeout(() => setRoundBanner(null), 900);
      return;
    }
    
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

  // PvE UX: auto-confirm as soon as all 3 slots are filled.
  useEffect(() => {
    if (autoConfirmTimeoutRef.current) {
      clearTimeout(autoConfirmTimeoutRef.current);
      autoConfirmTimeoutRef.current = null;
    }

    if (matchMode !== 'pve') return;
    if (tutorialEnabled) return;
    if (state !== 'prep' || confirmed || phase !== 'PREP') return;
    if (slots.filter((c) => c !== null).length !== 3) return;

    autoConfirmTimeoutRef.current = window.setTimeout(() => {
      if (phaseRef.current !== 'PREP') return;
      if (confirmed) return;
      if (slotsRef.current.filter((c) => c !== null).length !== 3) return;
      handleConfirm();
      autoConfirmTimeoutRef.current = null;
    }, 120);
  }, [matchMode, tutorialEnabled, state, confirmed, phase, slots]);

  const runTutorialRevealStep = () => {
    if (!tutorialEnabled || !confirmed || !currentTutorialStep) return;
    const expectedRevealStep =
      currentTutorialStep.id === 'reveal_1' ? 0 :
      currentTutorialStep.id === 'reveal_2' ? 1 :
      currentTutorialStep.id === 'reveal_3' ? 2 : null;
    if (expectedRevealStep === null) return;

    const stepIndex = revealedCards.length;
    if (stepIndex !== expectedRevealStep) return;
    if (stepIndex < 0 || stepIndex > 2) return;

    const yourCard = slotsRef.current[stepIndex];
    if (!yourCard) return;
    const oppCard = TUTORIAL_OPP_LAYOUT[stepIndex];

    let nextYourHp = prevYourHpRef.current;
    let nextOppHp = prevOppHpRef.current;

    if (yourCard === 'heal') {
      nextYourHp = Math.min(10, nextYourHp + 1);
    }
    if (oppCard === 'heal') {
      nextOppHp = Math.min(10, nextOppHp + 1);
    }
    if (yourCard === 'attack' && oppCard !== 'defense' && oppCard !== 'counter') {
      nextOppHp = Math.max(0, nextOppHp - 2);
    }
    if (oppCard === 'attack' && yourCard !== 'defense' && yourCard !== 'counter') {
      nextYourHp = Math.max(0, nextYourHp - 2);
    }
    if (yourCard === 'counter' && oppCard === 'attack') {
      nextOppHp = Math.max(0, nextOppHp - 2);
    }
    if (oppCard === 'counter' && yourCard === 'attack') {
      nextYourHp = Math.max(0, nextYourHp - 2);
    }

    if (nextYourHp < prevYourHpRef.current) {
      setHpFlash({ type: 'your', direction: 'down' });
      setTimeout(() => setHpFlash(null), 400);
    } else if (nextYourHp > prevYourHpRef.current) {
      setHpFlash({ type: 'your', direction: 'up' });
      setTimeout(() => setHpFlash(null), 400);
    }
    if (nextOppHp < prevOppHpRef.current) {
      setHpFlash({ type: 'opp', direction: 'down' });
      setTimeout(() => setHpFlash(null), 400);
    } else if (nextOppHp > prevOppHpRef.current) {
      setHpFlash({ type: 'opp', direction: 'up' });
      setTimeout(() => setHpFlash(null), 400);
    }

    prevYourHpRef.current = nextYourHp;
    prevOppHpRef.current = nextOppHp;
    setYourHp(nextYourHp);
    setOppHp(nextOppHp);
    setState('playing');
    setPhase('REVEAL');
    phaseRef.current = 'REVEAL';
    setCurrentStepIndex(stepIndex);

    setRevealAnimations(prev => new Set([...prev, stepIndex]));
    setTimeout(() => {
      setRevealAnimations(prev => {
        const next = new Set(prev);
        next.delete(stepIndex);
        return next;
      });
    }, 600);

    setRevealedCards(prev => {
      const next = [...prev];
      next[stepIndex] = {
        step: stepIndex,
        yourCard,
        oppCard
      };
      return next;
    });

    if (stepIndex === 2) {
      setState('ended');
      setPhase('END');
      phaseRef.current = 'END';
      setRoundBanner('Учебный раунд завершен');
      setTimeout(() => setRoundBanner(null), 900);
    }
  };

  const advanceTutorialManually = () => {
    if (!tutorialEnabled || !currentTutorialStep || currentTutorialStep.autoAdvance) return;
    if (currentTutorialStep.id === 'finish') return;
    setTutorialStepIndex(prev => Math.min(prev + 1, TUTORIAL_STEPS.length - 1));
  };

  const handleSkipTutorial = () => {
    onBackToMenu();
  };

  const handleFinishTutorial = () => {
    onTutorialComplete?.();
    onBackToMenu();
  };

  // Shared card renderer: uses generated orc-themed images
  const renderCard = (cardId: CardId | null, mode: 'HAND' | 'SLOT' | 'BACK' | 'REVEAL', slotIndex?: number) => {
    const isHand = mode === 'HAND';
    const cardWidth = isHand
      ? (isCompactHeight
          ? 'clamp(50px, calc((100vw - 34px) / 4), 68px)'
          : 'clamp(55px, calc((100vw - 36px) / 4), 75px)')
      : (isCompactHeight
          ? 'clamp(60px, calc((100vw - 34px) / 3), 76px)'
          : 'clamp(65px, calc((100vw - 36px) / 3), 85px)');
    
    if (mode === 'BACK') {
      return (
        <img
          src={cardBackImage}
          alt="Card back"
          draggable={false}
          style={{
            width: cardWidth,
            aspectRatio: '3 / 4',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            flexShrink: 0,
            objectFit: 'cover',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
        />
      );
    }

    if (!cardId) {
      if (mode === 'SLOT') {
        return (
          <img
            src={cardSlotImage}
            alt="Drop slot"
            draggable={false}
            style={{
              width: cardWidth,
              aspectRatio: '3 / 4',
              borderRadius: '8px',
              flexShrink: 0,
              objectFit: 'cover',
              userSelect: 'none',
              pointerEvents: 'none'
            }}
          />
        );
      }
      return null;
    }

    const cardImage = CARD_ART[cardId];

    return (
      <div
        style={{
          width: cardWidth,
          aspectRatio: '3 / 4',
          borderRadius: '8px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <img
          src={cardImage}
          alt={CARD_LABELS[cardId]}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
        />
        {mode === 'SLOT' && slotIndex !== undefined && (
          <div
            style={{
              position: 'absolute',
              right: '4px',
              bottom: '4px',
              minWidth: '18px',
              padding: '2px 4px',
              borderRadius: '8px',
              backgroundColor: 'rgba(15, 20, 12, 0.72)',
              color: '#e5f4d7',
              fontSize: 'clamp(7px, 1.2vw, 9px)',
              fontWeight: 700,
              textAlign: 'center'
            }}
          >
            S{slotIndex + 1}
          </div>
        )}
      </div>
    );
  };

  const tutorialHighlight = (active: boolean) =>
    active
      ? {
          boxShadow: '0 0 0 2px rgba(255, 193, 7, 0.9), 0 0 14px rgba(255, 193, 7, 0.35)',
          borderRadius: '10px'
        }
      : {};

  const tutorialHighlights = {
    topBar: tutorialEnabled && (currentTutorialStep?.id === 'intro' || currentTutorialStep?.id === 'cards'),
    slots:
      tutorialEnabled &&
      (currentTutorialStep?.id === 'place_attack' ||
        currentTutorialStep?.id === 'place_defense' ||
        currentTutorialStep?.id === 'place_heal'),
    confirm: tutorialEnabled && currentTutorialStep?.id === 'confirm',
    reveal:
      tutorialEnabled &&
      (currentTutorialStep?.id === 'reveal_1' ||
        currentTutorialStep?.id === 'reveal_2' ||
        currentTutorialStep?.id === 'reveal_3'),
    hand:
      tutorialEnabled &&
      (currentTutorialStep?.id === 'place_attack' ||
        currentTutorialStep?.id === 'place_defense' ||
        currentTutorialStep?.id === 'place_heal')
  };
  const tutorialPanelAtTop = currentTutorialStep?.id === 'confirm';

  // BattleShell: статичная оболочка до prep_start. Не меняет размеры DOM, без карт и тяжёлого layout.
  // Рендер игрового поля — только после prep_start, без анимаций при первом появлении.
  if (!lastPrepStart && !tutorialEnabled) {
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
                backgroundImage: `url(${secondaryButtonImage})`,
                backgroundSize: '100% 100%',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                color: '#1f271b',
                border: 'none',
                borderRadius: 8,
                minHeight: '56px',
                minWidth: '180px',
                fontWeight: 700,
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
      paddingLeft: 'env(safe-area-inset-left, 0)',
      paddingRight: 'env(safe-area-inset-right, 0)',
      backgroundColor: '#182417',
      color: 'rgba(255, 255, 255, 0.87)',
      zIndex: 1
    }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${battleBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 1,
          pointerEvents: 'none',
          zIndex: 0
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(8, 12, 8, 0.28) 0%, rgba(6, 10, 6, 0.44) 100%)',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />
      <img
        src={topOrnamentImage}
        alt=""
        style={{
          position: 'absolute',
          top: 'max(4px, calc(env(safe-area-inset-top, 0px) + 2px))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(96vw, 980px)',
          opacity: 0.9,
          pointerEvents: 'none',
          zIndex: 0
        }}
      />
      <img
        src={bottomOrnamentImage}
        alt=""
        style={{
          position: 'absolute',
          bottom: 'max(4px, calc(env(safe-area-inset-bottom, 0px) + 2px))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(96vw, 980px)',
          opacity: 0.8,
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Compact Top Bar - 1 строка максимум */}
      <div style={{ 
        flexShrink: 0,
        padding: isCompactHeight ? '4px 10px' : '6px 12px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 12px',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: isCompactHeight ? '9px' : '10px',
        lineHeight: '1.3',
        borderBottom: '1px solid rgba(0, 0, 0, 0.25)',
        backgroundColor: 'rgba(22, 31, 19, 0.58)',
        backdropFilter: 'blur(1px)',
        zIndex: 1,
        ...tutorialHighlight(tutorialHighlights.topBar)
      }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold' }}>R{roundIndex}{suddenDeath ? ' SD' : ''}</span>
          <span style={{ opacity: 0.7 }}>{phaseLabel}</span>
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
        padding: isCompactHeight ? '8px 10px 6px 10px' : '12px 12px 8px 12px',
        display: 'flex',
        gap: isCompactHeight ? '4px' : '6px',
        justifyContent: 'center',
        alignItems: 'center',
        ...tutorialHighlight(tutorialHighlights.reveal)
      }}>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          {[0, 1, 2].map((index) => {
            const revealed = revealedCards[index];
            const isCurrentStep = currentStepIndex === index;
            const isRevealing = revealAnimations.has(index);
            // В PREP всегда рубашка, в REVEAL показываем только если это текущий шаг или уже был вскрыт
            const shouldShowRevealed = phase !== 'PREP' && revealed && (isCurrentStep || phase === 'END' || tutorialEnabled);
            
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
          padding: isCompactHeight ? '2px 10px' : '4px 12px',
          fontSize: isCompactHeight ? '12px' : '14px',
          fontWeight: 'bold',
          color: '#fff'
        }}>
          Выбрано: {selectedSlotsCount}/3
        </div>
      )}

      {/* Your Slots Row - строго по центру, ровные gap */}
      <div style={{ 
        flexShrink: 0,
        padding: isCompactHeight ? '6px 10px' : '10px 12px',
        display: 'flex',
        gap: isCompactHeight ? '6px' : '8px',
        justifyContent: 'center',
        alignItems: 'center',
        ...tutorialHighlight(tutorialHighlights.slots)
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
        paddingTop: isCompactHeight ? '4px' : '8px',
        ...tutorialHighlight(tutorialHighlights.hand)
      }}>
        {state === 'prep' && !confirmed && (
          <div style={{ 
            flexShrink: 0,
            padding: isCompactHeight ? '4px 10px' : '8px 12px',
            display: 'flex',
            gap: isCompactHeight ? '3px' : '4px',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%',
            boxSizing: 'border-box'
          }}>
            {yourHand.map((cardId) => {
              const inSlot = slots.includes(cardId);
              const isDraggingCard = dragState?.card === cardId;
              const slotsCount = selectedSlotsCount;
              const tutorialLocked = tutorialEnabled && !tutorialHandUnlocked;
              const isBlocked = tutorialLocked || (slotsCount === 3 && !inSlot); // Block if tutorial still gated or slots full
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
          padding: isUltraCompactHeight
            ? `8px 10px calc(8px + env(safe-area-inset-bottom, 0px)) 10px`
            : `12px 12px calc(12px + env(safe-area-inset-bottom, 0px)) 12px`,
          textAlign: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          ...tutorialHighlight(tutorialHighlights.confirm)
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            {(() => {
              const slotsCount = selectedSlotsCount;
              if (slotsCount < 3) {
                return (
                  <div style={{ fontSize: '11px', color: '#999', opacity: 0.7 }}>
                    Положи ещё {3 - slotsCount} карт{3 - slotsCount !== 1 ? 'ы' : 'у'}, чтобы подтвердить ход
                  </div>
                );
              } else if (tutorialEnabled && !tutorialConfirmUnlocked) {
                return (
                  <div style={{ fontSize: '11px', color: '#ffcc80', opacity: 0.95 }}>
                    Сначала прочитай подсказку обучения, потом Confirm
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
              disabled={selectedSlotsCount !== 3 || !tutorialConfirmUnlocked}
              style={{
                padding: 0,
                cursor: selectedSlotsCount === 3 && tutorialConfirmUnlocked ? 'pointer' : 'not-allowed',
                width: 'min(340px, 90vw)',
                minHeight: '82px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: 'transparent',
                color: '#fff',
                transition: 'transform 0.1s ease, opacity 0.1s ease, box-shadow 0.2s ease, filter 0.2s ease',
                transform: confirmButtonPressed ? 'scale(0.95)' : 'scale(1)',
                opacity: confirmButtonPressed ? 0.8 : 1,
                boxShadow: selectedSlotsCount === 3 && tutorialConfirmUnlocked
                  ? '0 0 14px rgba(126, 207, 108, 0.45)' 
                  : '0 3px 8px rgba(0,0,0,0.2)',
                filter: selectedSlotsCount === 3 && tutorialConfirmUnlocked ? 'none' : 'grayscale(0.5) brightness(0.7)',
                overflow: 'hidden'
              }}
            >
              <img
                src={confirmButtonImage}
                alt="Confirm"
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  display: 'block'
                }}
              />
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
                      backgroundImage: `url(${confirmButtonImage})`,
                      backgroundSize: '100% 100%',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                      color: '#10210f',
                      border: 'none',
                      borderRadius: '10px',
                      transition: 'opacity 0.2s, transform 0.1s',
                      minHeight: '58px',
                      textShadow: '0 1px 0 rgba(255,255,255,0.5)'
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
                    backgroundImage: `url(${secondaryButtonImage})`,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    color: '#1f271b',
                    border: 'none',
                    borderRadius: '10px',
                    transition: 'opacity 0.2s, transform 0.1s',
                    minHeight: '58px',
                    textShadow: '0 1px 0 rgba(255,255,255,0.4)'
                  }}
                >
                  Back to Menu
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {currentTutorialStep && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: tutorialPanelAtTop ? 'max(8px, env(safe-area-inset-top, 0px))' : 'auto',
            bottom: tutorialPanelAtTop ? 'auto' : 0,
            display: 'flex',
            justifyContent: 'center',
            padding: tutorialPanelAtTop
              ? (isCompactHeight
                  ? '0 10px 8px 10px'
                  : '0 14px 10px 14px')
              : (isCompactHeight
                  ? '8px 10px calc(14px + env(safe-area-inset-bottom, 0px)) 10px'
                  : '12px 14px calc(18px + env(safe-area-inset-bottom, 0px)) 14px'),
            zIndex: 10020,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              width: 'min(680px, 100%)',
              backgroundColor: 'rgba(10, 10, 10, 0.94)',
              border: '1px solid rgba(255, 193, 7, 0.7)',
              borderRadius: '12px',
              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.45)',
              padding: isCompactHeight ? '10px 12px' : '12px 14px',
              maxHeight: tutorialPanelAtTop ? '44vh' : '48vh',
              overflowY: 'auto',
              pointerEvents: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
              <strong style={{ fontSize: isCompactHeight ? '13px' : '14px', color: '#ffe082' }}>
                {currentTutorialStep.title}
              </strong>
              <span style={{ fontSize: '11px', color: '#bbb' }}>
                {tutorialStepIndex + 1}/{TUTORIAL_STEPS.length}
              </span>
            </div>
            <div style={{ marginTop: '8px', fontSize: isCompactHeight ? '12px' : '13px', lineHeight: 1.45, color: '#f1f1f1' }}>
              {currentTutorialStep.body}
            </div>
            {currentTutorialStep.id === 'cards' && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#d7d7d7', lineHeight: 1.45 }}>
                <div>Attack &gt; Heal/empty.</div>
                <div>Defense блокирует Attack без ответного урона.</div>
                <div>Counter наказывает предсказуемый Attack.</div>
              </div>
            )}
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffecb3' }}>
              {currentTutorialStep.action}
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                onClick={handleSkipTutorial}
                style={{
                  border: 'none',
                  backgroundImage: `url(${cancelButtonImage})`,
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  color: '#2b1511',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  minWidth: '106px',
                  minHeight: '42px',
                  fontWeight: 700
                }}
              >
                Пропустить
              </button>
              {currentTutorialStep.id === 'finish' ? (
                <button
                  onClick={handleFinishTutorial}
                  style={{
                    border: 'none',
                    backgroundImage: `url(${confirmButtonImage})`,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    color: '#10210f',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    minHeight: '42px'
                  }}
                >
                  Завершить обучение
                </button>
              ) : currentTutorialStep.id === 'reveal_1' || currentTutorialStep.id === 'reveal_2' || currentTutorialStep.id === 'reveal_3' ? (
                <button
                  onClick={runTutorialRevealStep}
                  style={{
                    border: 'none',
                    backgroundImage: `url(${confirmButtonImage})`,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    color: '#10210f',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    minHeight: '42px'
                  }}
                >
                  Показать шаг
                </button>
              ) : currentTutorialStep.autoAdvance ? (
                <button
                  disabled
                  style={{
                    border: 'none',
                    backgroundImage: `url(${secondaryButtonImage})`,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    color: '#444',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'not-allowed',
                    minHeight: '42px',
                    filter: 'grayscale(0.6) brightness(0.8)'
                  }}
                >
                  Выполни шаг
                </button>
              ) : (
                <button
                  onClick={advanceTutorialManually}
                  style={{
                    border: 'none',
                    backgroundImage: `url(${confirmButtonImage})`,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    color: '#10210f',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    minHeight: '42px'
                  }}
                >
                  Дальше
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
