import { useState, useEffect, useRef } from 'react';
import { socketManager } from '../net/socket';
import type { Card, PrepStartPayload, StepRevealPayload, MatchEndPayload } from '../net/types';

type BattleState = 'prep' | 'playing' | 'ended';

interface BattleProps {
  onBackToMenu: () => void;
  tokens: number | null;
  matchEndPayload: MatchEndPayload | null;
  lastPrepStart: PrepStartPayload | null;
  currentMatchId: string | null;
}

export default function Battle({ onBackToMenu, tokens, matchEndPayload, lastPrepStart, currentMatchId }: BattleProps) {
  const [state, setState] = useState<BattleState>('prep');
  const [yourHp, setYourHp] = useState(10);
  const [oppHp, setOppHp] = useState(10);
  const [pot, setPot] = useState(0);
  const [slots, setSlots] = useState<(Card | null)[]>([null, null, null]);
  const [availableCards, setAvailableCards] = useState<Card[]>(['ATTACK', 'DEFENSE', 'HEAL', 'COUNTER']);
  const [confirmed, setConfirmed] = useState(false);
  const [deadlineTs, setDeadlineTs] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [roundIndex, setRoundIndex] = useState(1);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [revealedCards, setRevealedCards] = useState<{ step: number; yourCard: Card; oppCard: Card }[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<'PREP' | 'REVEAL' | 'END'>('PREP');
  const [yourNickname, setYourNickname] = useState<string | null>(null);
  const [oppNickname, setOppNickname] = useState<string | null>(null);

  const [dragState, setDragState] = useState<{
    card: Card;
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
    } else {
      // Очищаем END состояние если matchEndPayload стал null
      if (phase === 'END') {
        setPhase('PREP');
        setState('prep');
      }
    }
  }, [matchEndPayload, phase]);

  // Применение lastPrepStart из props
  useEffect(() => {
    if (!lastPrepStart) return;
    
    // Игнорируем если matchId не совпадает
    if (lastPrepStart.matchId && currentMatchId !== null && lastPrepStart.matchId !== currentMatchId) {
      return;
    }
    
    const isNewRound = lastAppliedRoundIndexRef.current === null || 
                       lastAppliedRoundIndexRef.current !== lastPrepStart.roundIndex;
    
    setRoundIndex(lastPrepStart.roundIndex);
    setPhase('PREP');
    setNowTs(Date.now());
    setDeadlineTs(lastPrepStart.deadlineTs);
    setYourHp(lastPrepStart.yourHp);
    setOppHp(lastPrepStart.oppHp);
    setPot(lastPrepStart.pot);
    setSuddenDeath(lastPrepStart.suddenDeath);
    setAvailableCards([...lastPrepStart.cards]);
    if (lastPrepStart.yourNickname !== undefined) {
      setYourNickname(lastPrepStart.yourNickname);
    }
    if (lastPrepStart.oppNickname !== undefined) {
      setOppNickname(lastPrepStart.oppNickname);
    }
    
    // Сбросить confirmed/layout/slot/выкладки только если это новый раунд
    if (isNewRound) {
      setState('prep');
      setSlots([null, null, null]);
      setConfirmed(false);
      setRevealedCards([]);
      setCurrentStepIndex(null);
      lastAppliedRoundIndexRef.current = lastPrepStart.roundIndex;
    }
  }, [lastPrepStart, currentMatchId]);

  useEffect(() => {
    const socket = socketManager.getSocket();
    if (!socket) return;

    socketManager.onMatchFound((payload) => {
      // При старте нового матча очищаем все локальные стейты
      setState('prep');
      setPhase('PREP');
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      setPot(payload.pot);
      setSlots([null, null, null]);
      setConfirmed(false);
      setRevealedCards([]);
      setCurrentStepIndex(null);
      setRoundIndex(1);
      if (payload.yourNickname !== undefined) {
        setYourNickname(payload.yourNickname);
      }
      if (payload.oppNickname !== undefined) {
        setOppNickname(payload.oppNickname);
      }
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

  // Вычисляемый countdownSeconds
  const countdownSeconds = deadlineTs === null 
    ? null 
    : Math.max(0, Math.ceil((deadlineTs - nowTs) / 1000));
  
  // Fallback для computedSeconds
  const computedSeconds = (() => {
    if (phase === 'PREP' && deadlineTs !== null) {
      const baseNow = nowTs || Date.now();
      const secs = Math.max(0, Math.ceil((deadlineTs - baseNow) / 1000));
      return isNaN(secs) ? 0 : secs;
    }
    return countdownSeconds !== null && !isNaN(countdownSeconds) ? countdownSeconds : null;
  })();

  // Таймер для обновления countdown
  useEffect(() => {
    if (phase !== 'PREP' || deadlineTs === null) return;

    const interval = setInterval(() => {
      setNowTs(Date.now());
    }, 250);

    return () => clearInterval(interval);
  }, [phase, deadlineTs]);

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

  const toCardCode = (v: Card | null): string | null => (v ? v : null);

  const scheduleDraft = (nextSlots: (Card | null)[]) => {
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

  const applySlotsUpdate = (updater: (prev: (Card | null)[]) => (Card | null)[]) => {
    setSlots(prev => {
      const next = updater(prev);
      scheduleDraft(next);
      return next;
    });
  };

  const applyDropToSlot = (card: Card, slotIndex: number, sourceSlotIndex: number | null) => {
    if (!canInteract) return;
    applySlotsUpdate(prev => {
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
    card: Card,
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
    const layout = slots.filter((card): card is Card => card !== null);
    if (layout.length !== 3) return;
    
    socketManager.layoutConfirm(layout);
  };


  // Функция для получения цвета карты
  const getCardColor = (card: Card) => {
    switch (card) {
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

  // Общий компонент/функция renderCard
  const renderCard = (card: Card | null, mode: 'HAND' | 'SLOT' | 'BACK' | 'REVEAL', slotIndex?: number) => {
    if (mode === 'BACK') {
      return (
        <div
          style={{
            width: '100px',
            height: '140px',
            border: '2px solid #333',
            borderRadius: '12px',
            backgroundColor: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            color: '#fff',
            fontSize: '32px',
            fontWeight: 'bold'
          }}
        >
          ?
        </div>
      );
    }

    if (!card) {
      if (mode === 'SLOT') {
        return (
          <div
            style={{
              width: '100px',
              height: '140px',
              border: '2px dashed #999',
              borderRadius: '12px',
              backgroundColor: '#f9f9f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#999',
              fontSize: '12px',
              textAlign: 'center',
              padding: '8px'
            }}
          >
            Drop here
          </div>
        );
      }
      return null;
    }

    const colors = getCardColor(card);
    const cardName = card === 'COUNTER' ? 'COUNTER' : card;

    return (
      <div
        style={{
          width: '100px',
          height: '140px',
          border: `2px solid ${colors.border}`,
          borderRadius: '12px',
          backgroundColor: colors.bg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          color: colors.text,
          padding: '8px',
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '4px' }}>{colors.icon}</div>
        <div style={{ fontSize: '12px', fontWeight: 'bold' }}>{cardName}</div>
        {mode === 'SLOT' && slotIndex !== undefined && (
          <div style={{ fontSize: '10px', marginTop: '4px', color: '#666' }}>Step {slotIndex + 1}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ 
      height: '100dvh',
      height: '100vh', // fallback
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      paddingTop: 'env(safe-area-inset-top, 0)',
      paddingBottom: 'env(safe-area-inset-bottom, 0)',
      paddingLeft: 'clamp(8px, 2vw, 16px)',
      paddingRight: 'clamp(8px, 2vw, 16px)',
      maxWidth: '800px',
      margin: '0 auto',
      boxSizing: 'border-box',
      position: 'relative'
    }}>
      {/* TopBar: Round/Phase/Tokens/HP + nicknames - 15-20% высоты */}
      <div style={{
        flex: '0 0 auto',
        minHeight: '15vh',
        maxHeight: '20vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingTop: 'clamp(4px, 1vh, 8px)',
        paddingBottom: 'clamp(4px, 1vh, 8px)',
        borderBottom: '1px solid #444'
      }}>
        <div style={{ 
          fontSize: 'clamp(14px, 3.5vw, 20px)', 
          fontWeight: 'bold',
          textAlign: 'center',
          marginBottom: 'clamp(2px, 0.5vh, 4px)'
        }}>
          Round {roundIndex} {suddenDeath && '(SD)'}
        </div>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: 'clamp(11px, 2.5vw, 14px)',
          gap: 'clamp(8px, 2vw, 12px)',
          marginBottom: 'clamp(4px, 1vh, 8px)'
        }}>
          <div>Tokens: {tokens === null ? '—' : tokens}</div>
          <div>Pot: {pot}</div>
          {phase === 'PREP' && deadlineTs !== null && computedSeconds !== null && (
            <div>Time: {computedSeconds}s</div>
          )}
        </div>
        {/* HP Display with Nicknames */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: 'clamp(14px, 3.5vw, 20px)',
          gap: 'clamp(8px, 2vw, 12px)'
        }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 'clamp(10px, 2.5vw, 12px)', color: '#888', marginBottom: '2px' }}>
              {yourNickname || 'You'}
            </div>
            <div>HP: {yourHp}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 'clamp(10px, 2.5vw, 12px)', color: '#888', marginBottom: '2px' }}>
              {oppNickname || 'Opponent'}
            </div>
            <div>HP: {oppHp}</div>
          </div>
        </div>
      </div>

      {/* OpponentRow: 3 карты - 20-22% высоты */}
      <div style={{
        flex: '0 0 auto',
        minHeight: '20vh',
        maxHeight: '22vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingTop: 'clamp(4px, 1vh, 8px)',
        paddingBottom: 'clamp(4px, 1vh, 8px)'
      }}>
        <div style={{ 
          fontSize: 'clamp(12px, 3vw, 16px)', 
          marginBottom: 'clamp(4px, 1vh, 8px)',
          textAlign: 'center'
        }}>
          {oppNickname || 'Opponent'}
        </div>
        <div style={{ 
          display: 'flex', 
          gap: 'clamp(4px, 1.5vw, 8px)', 
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1
        }}>
          {[0, 1, 2].map((index) => {
            const revealed = revealedCards[index];
            const isCurrentStep = currentStepIndex === index;
            // В PREP всегда рубашка, в REVEAL показываем только если это текущий шаг или уже был вскрыт
            const shouldShowRevealed = phase !== 'PREP' && revealed && (isCurrentStep || phase === 'END');
            
            return (
              <div
                key={index}
                style={{
                  border: isCurrentStep ? '3px solid #ff6b6b' : 'none',
                  borderRadius: '12px',
                  padding: isCurrentStep ? '2px' : '0'
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

      {/* YourSlotsRow: 3 слота - 20-22% высоты */}
      <div style={{
        flex: '0 0 auto',
        minHeight: '20vh',
        maxHeight: '22vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingTop: 'clamp(4px, 1vh, 8px)',
        paddingBottom: 'clamp(4px, 1vh, 8px)'
      }}>
        <div style={{ 
          fontSize: 'clamp(12px, 3vw, 16px)', 
          marginBottom: 'clamp(4px, 1vh, 8px)',
          textAlign: 'center'
        }}>
          {(yourNickname || 'Your')} Slots {state === 'prep' && !confirmed && <span style={{ fontSize: 'clamp(10px, 2.5vw, 12px)', color: '#888' }}>(drop here)</span>}
        </div>
        <div style={{ 
          display: 'flex', 
          gap: 'clamp(4px, 1.5vw, 8px)', 
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1
        }}>
          {slots.map((card, index) => {
            const revealed = revealedCards[index];
            const displayCard = revealed ? revealed.yourCard : card;
            const isCurrentStep = currentStepIndex === index;
            const isHovered = dragState !== null && hoveredSlotIndex === index;
            const hoverBorder = isHovered ? '3px solid #4caf50' : null;
            const stepBorder = isCurrentStep ? '3px solid #ff6b6b' : 'none';
            const border = hoverBorder || stepBorder;

            return (
              <div
                key={index}
                data-slot-index={index}
                style={{
                  border,
                  borderRadius: '12px',
                  padding: border !== 'none' ? '2px' : '0',
                  cursor: canInteract ? 'pointer' : 'default',
                  boxShadow: isHovered ? '0 0 0 3px rgba(76, 175, 80, 0.2)' : 'none'
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
      
      {/* HandRow: карты в руке - 22-25% высоты */}
      {state === 'prep' && !confirmed && (
        <div style={{
          flex: '0 0 auto',
          minHeight: '22vh',
          maxHeight: '25vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingTop: 'clamp(4px, 1vh, 8px)',
          paddingBottom: 'clamp(4px, 1vh, 8px)'
        }}>
          <div style={{ 
            fontSize: 'clamp(12px, 3vw, 16px)', 
            marginBottom: 'clamp(4px, 1vh, 8px)',
            textAlign: 'center'
          }}>
            Your Cards
          </div>
          <div style={{ 
            display: 'flex', 
            gap: 'clamp(4px, 1.5vw, 8px)', 
            justifyContent: 'center',
            alignItems: 'center',
            flex: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: '4px'
          }}>
            {availableCards.map((card) => {
              const inSlot = slots.includes(card);
              const isDraggingCard = dragState?.card === card;
              const cardElement = renderCard(card, 'HAND');

              return (
                <div
                  key={card}
                  className="battle-card"
                  onPointerDown={(e) => handlePointerDown(e, card, null)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerCancel}
                  style={{
                    opacity: inSlot ? 0.5 : isDraggingCard ? 0.25 : 1,
                    cursor: canInteract && !inSlot ? 'grab' : 'default',
                    userSelect: 'none'
                  }}
                >
                  {cardElement}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ConfirmRow: кнопка - 8-10% высоты */}
      <div style={{
        flex: '0 0 auto',
        minHeight: '8vh',
        maxHeight: '10vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 'clamp(4px, 1vh, 8px)',
        paddingBottom: 'clamp(4px, 1vh, 8px)',
        borderTop: '1px solid #444'
      }}>
        {state === 'prep' && !confirmed ? (
          <button
            onClick={handleConfirm}
            disabled={slots.filter(c => c !== null).length !== 3}
            style={{
              padding: 'clamp(8px, 2vh, 12px) clamp(16px, 4vw, 24px)',
              fontSize: 'clamp(14px, 3.5vw, 18px)',
              cursor: slots.filter(c => c !== null).length === 3 ? 'pointer' : 'not-allowed',
              width: '100%',
              maxWidth: '400px'
            }}
          >
            Confirm
          </button>
        ) : confirmed && state === 'prep' ? (
          <p style={{ margin: 0, fontSize: 'clamp(12px, 3vw, 16px)' }}>Waiting for opponent...</p>
        ) : null}
      </div>
      
      {/* Step Result Text - показываем только если есть */}
      {currentStepIndex !== null && revealedCards[currentStepIndex] && phase === 'REVEAL' && (
        <div style={{ 
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 'clamp(8px, 2vw, 12px)',
          borderRadius: '8px',
          fontSize: 'clamp(12px, 3vw, 16px)',
          zIndex: 1000,
          textAlign: 'center'
        }}>
          Step {currentStepIndex + 1} resolved. HP: You {yourHp} / Opp {oppHp}
        </div>
      )}

      {/* Match End - overlay */}
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
          zIndex: 2000,
          padding: 'clamp(16px, 4vw, 24px)'
        }}>
          <h2 style={{ fontSize: 'clamp(24px, 6vw, 32px)', marginBottom: 'clamp(8px, 2vh, 16px)' }}>
            {matchEndPayload.winner === 'YOU' ? 'YOU WIN' : 'YOU LOSE'}
          </h2>
          {matchEndPayload.reason === 'disconnect' && (
            <p style={{ fontSize: 'clamp(12px, 3vw, 14px)', color: '#666', marginBottom: 'clamp(16px, 4vh, 24px)' }}>
              Opponent disconnected
            </p>
          )}
          {matchEndPayload.reason === 'timeout' && (
            <p style={{ fontSize: 'clamp(12px, 3vw, 14px)', color: '#666', marginBottom: 'clamp(16px, 4vh, 24px)' }}>
              Match timed out
            </p>
          )}
          <button
            onClick={onBackToMenu}
            style={{
              padding: 'clamp(10px, 2.5vh, 14px) clamp(20px, 5vw, 28px)',
              fontSize: 'clamp(14px, 3.5vw, 18px)',
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
