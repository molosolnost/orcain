const BUILD = import.meta.env.VITE_BUILD_ID ?? "dev";

interface MenuProps {
  onStartBattle: () => void;
  onStartPvE: () => void;
  onStartTutorial: () => void;
  onCancelSearch: () => void;
  isSearching: boolean;
  tokens: number | null;
  nickname: string | null;
  tutorialCompleted: boolean;
}

export default function Menu({ onStartBattle, onStartPvE, onStartTutorial, onCancelSearch, isSearching, tokens, nickname, tutorialCompleted }: MenuProps) {
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
      {nickname && (
        <div style={{ fontSize: '18px', color: '#666', marginTop: '-10px' }}>
          Welcome, <strong>{nickname}</strong>
        </div>
      )}
      <div style={{ fontSize: '20px' }}>Tokens: {tokens === null ? '—' : tokens}</div>
      
      {isSearching ? (
        <>
          <div style={{ fontSize: '18px', color: '#666' }}>Searching opponent…</div>
          <button 
            onClick={onCancelSearch}
            style={{
              padding: '12px 24px',
              fontSize: '18px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button 
            onClick={onStartBattle}
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
          <button 
            onClick={onStartPvE}
            style={{
              padding: '12px 24px',
              fontSize: '18px',
              cursor: 'pointer',
              backgroundColor: '#4caf50',
              color: '#fff',
              border: 'none',
              borderRadius: '4px'
            }}
          >
            Start PvE Training
          </button>
          <button 
            onClick={onStartTutorial}
            style={{
              padding: '12px 24px',
              fontSize: '18px',
              cursor: 'pointer',
              backgroundColor: '#ff9800',
              color: '#fff',
              border: 'none',
              borderRadius: '4px'
            }}
          >
            {tutorialCompleted ? 'Пройти обучение' : 'Начать обучение'}
          </button>
        </>
      )}
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
