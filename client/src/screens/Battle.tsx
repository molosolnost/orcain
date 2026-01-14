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
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px', textAlign: 'center' }}>
        <h2>Round {roundIndex} {suddenDeath && '(Sudden Death)'}</h2>
        <div style={{ fontSize: '16px', marginTop: '8px', fontWeight: 'bold' }}>
          Phase: {phase}
        </div>
        {phase === 'PREP' && deadlineTs !== null && computedSeconds !== null && (
          <div>
            <p>Time left: {computedSeconds}s</p>
          </div>
        )}
      </div>

      {/* Tokens and Pot Display */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        marginBottom: '20px',
        fontSize: '18px'
      }}>
        <div>Tokens: {tokens === null ? '—' : tokens}</div>
        <div>Pot: {pot}</div>
      </div>

      {/* HP Display */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        marginBottom: '40px',
        fontSize: '24px'
      }}>
        <div>
          <div>Your HP: {yourHp}</div>
        </div>
        <div>
          <div>Opponent HP: {oppHp}</div>
        </div>
      </div>

      {/* Opponent Slots */}
      <div style={{ marginBottom: '40px' }}>
        <h3>Opponent</h3>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
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

      {/* Your Slots */}
      <div style={{ marginBottom: '40px' }}>
        <h3>Your Slots {state === 'prep' && !confirmed && '(drop cards here)'}</h3>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
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
      
      {/* Step Result Text */}
      {currentStepIndex !== null && revealedCards[currentStepIndex] && (
        <div style={{ textAlign: 'center', marginBottom: '20px', fontSize: '16px' }}>
          <p>
            Step {currentStepIndex + 1} resolved. HP: You {yourHp} / Opp {oppHp}
          </p>
        </div>
      )}

      {/* Available Cards */}
      {state === 'prep' && !confirmed && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Your Cards (drag to slots)</h3>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
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

      {/* Confirm Button */}
      {state === 'prep' && !confirmed && (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            onClick={handleConfirm}
            disabled={slots.filter(c => c !== null).length !== 3}
            style={{
              padding: '12px 24px',
              fontSize: '18px',
              cursor: slots.filter(c => c !== null).length === 3 ? 'pointer' : 'not-allowed'
            }}
          >
            Confirm
          </button>
        </div>
      )}

      {confirmed && state === 'prep' && (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <p>Waiting for opponent...</p>
        </div>
      )}

      {/* Match End */}
      {matchEndPayload && (
        <div style={{ textAlign: 'center', marginTop: '40px' }}>
          <h2>{matchEndPayload.winner === 'YOU' ? 'YOU WIN' : 'YOU LOSE'}</h2>
          {matchEndPayload.reason === 'disconnect' && (
            <p style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>Opponent disconnected</p>
          )}
          {matchEndPayload.reason === 'timeout' && (
            <p style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>Match timed out</p>
          )}
          <button
            onClick={onBackToMenu}
            style={{
              padding: '12px 24px',
              fontSize: '18px',
              cursor: 'pointer',
              marginTop: '20px'
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
