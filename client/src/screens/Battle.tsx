import { useState, useEffect, useRef } from 'react';
import { socketManager } from '../net/socket';
import type { Card, PrepStartPayload, StepRevealPayload, MatchEndPayload } from '../net/types';

type BattleState = 'prep' | 'playing' | 'ended';

interface BattleProps {
  onBackToMenu: () => void;
  tokens: number | null;
  matchEndPayload: MatchEndPayload | null;
}

export default function Battle({ onBackToMenu, tokens, matchEndPayload }: BattleProps) {
  const [state, setState] = useState<BattleState>('prep');
  const [yourHp, setYourHp] = useState(10);
  const [oppHp, setOppHp] = useState(10);
  const [pot, setPot] = useState(0);
  const [slots, setSlots] = useState<(Card | null)[]>([null, null, null]);
  const [availableCards, setAvailableCards] = useState<Card[]>(['ATTACK', 'DEFENSE', 'HEAL', 'COUNTER']);
  const [confirmed, setConfirmed] = useState(false);
  const [deadlineTs, setDeadlineTs] = useState(0);
  const [timeLeft, setTimeLeft] = useState(20);
  const [roundIndex, setRoundIndex] = useState(1);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [revealedCards, setRevealedCards] = useState<{ step: number; yourCard: Card; oppCard: Card }[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<'PREP' | 'REVEAL' | 'END'>('PREP');

  const draggedCardRef = useRef<Card | null>(null);
  const draggedSlotRef = useRef<number | null>(null);

  useEffect(() => {
    if (matchEndPayload) {
      setState('ended');
      setPhase('END');
      setYourHp(matchEndPayload.yourHp);
      setOppHp(matchEndPayload.oppHp);
      setCurrentStepIndex(null);
    }
  }, [matchEndPayload]);

  useEffect(() => {
    const socket = socketManager.getSocket();
    if (!socket) return;

    socketManager.onMatchFound((payload) => {
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      setPot(payload.pot);
    });

    socketManager.onPrepStart((payload: PrepStartPayload) => {
      setState('prep');
      setPhase('PREP');
      setYourHp(payload.yourHp);
      setOppHp(payload.oppHp);
      setSlots([null, null, null]);
      setAvailableCards([...payload.cards]);
      setConfirmed(false);
      setDeadlineTs(payload.deadlineTs);
      setRoundIndex(payload.roundIndex);
      setSuddenDeath(payload.suddenDeath);
      setRevealedCards([]);
      setCurrentStepIndex(null);
    });

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
      socketManager.off('prep_start');
      socketManager.off('confirm_ok');
      socketManager.off('step_reveal');
      socketManager.off('round_end');
    };
  }, []);

  // Таймер
  useEffect(() => {
    if (state !== 'prep' || deadlineTs === 0) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadlineTs - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [state, deadlineTs]);

  const handleDragStart = (card: Card) => {
    draggedCardRef.current = card;
  };

  const handleDragEnd = () => {
    draggedCardRef.current = null;
    draggedSlotRef.current = null;
  };

  const handleSlotDrop = (slotIndex: number) => {
    const card = draggedCardRef.current;
    if (!card || confirmed) return;

    setSlots(prev => {
      const newSlots = [...prev];
      const oldSlotIndex = prev.indexOf(card);
      
      // Если карта уже в слоте, освобождаем старый слот
      if (oldSlotIndex !== -1) {
        newSlots[oldSlotIndex] = null;
      }
      
      // Если в целевом слоте уже есть карта, она будет заменена
      newSlots[slotIndex] = card;
      return newSlots;
    });
  };

  const handleSlotDragOver = (e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    draggedSlotRef.current = slotIndex;
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
        {state === 'prep' && (
          <div>
            <p>Time left: {timeLeft}s</p>
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
            
            return (
              <div
                key={index}
                onDrop={() => handleSlotDrop(index)}
                onDragOver={(e) => handleSlotDragOver(e, index)}
                style={{
                  border: isCurrentStep ? '3px solid #ff6b6b' : 'none',
                  borderRadius: '12px',
                  padding: isCurrentStep ? '2px' : '0',
                  cursor: confirmed || state !== 'prep' ? 'default' : 'pointer'
                }}
              >
                {displayCard ? (
                  renderCard(displayCard, 'SLOT', index)
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
              const cardElement = renderCard(card, 'HAND');
              
              return (
                <div
                  key={card}
                  draggable={!confirmed && !inSlot}
                  onDragStart={() => handleDragStart(card)}
                  onDragEnd={handleDragEnd}
                  style={{
                    opacity: inSlot ? 0.5 : 1,
                    cursor: confirmed || inSlot ? 'default' : 'grab',
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
    </div>
  );
}
