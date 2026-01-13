import { socketManager } from '../net/socket';

const BUILD = import.meta.env.VITE_BUILD_ID ?? "dev";

interface MenuProps {
  onBattleStart: () => void;
  tokens: number | null;
}

export default function Menu({ onBattleStart, tokens }: MenuProps) {
  const handleStartBattle = () => {
    socketManager.queueJoin();
    onBattleStart();
  };

  // Кнопка Start Battle disabled если tokens !== null && tokens < 1
  const hasEnoughTokens = tokens !== null && tokens >= 1;

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      height: '100vh',
      gap: '20px',
      position: 'relative'
    }}>
      <h1 style={{ fontSize: '48px', margin: 0 }}>ORCAIN</h1>
      <div style={{ fontSize: '20px' }}>Tokens: {tokens === null ? '—' : tokens}</div>
      <button 
        onClick={handleStartBattle}
        disabled={!hasEnoughTokens}
        style={{
          padding: '12px 24px',
          fontSize: '18px',
          cursor: hasEnoughTokens ? 'pointer' : 'not-allowed',
          opacity: hasEnoughTokens ? 1 : 0.5
        }}
      >
        {hasEnoughTokens ? 'Start Battle' : 'Not enough tokens'}
      </button>
      <div style={{ 
        position: 'absolute', 
        bottom: '20px', 
        fontSize: '12px', 
        color: '#666',
        textAlign: 'center'
      }}>
        build: {BUILD}
      </div>
    </div>
  );
}
