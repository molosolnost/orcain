const BUILD = import.meta.env.VITE_BUILD_ID ?? "dev";
import orcainLogo from "../assets/orcain_logo.png";

interface MenuProps {
  onStartBattle: () => void;
  onStartPvE: () => void;
  onCancelSearch: () => void;
  isSearching: boolean;
  tokens: number | null;
  nickname: string | null;
}

export default function Menu({ onStartBattle, onStartPvE, onCancelSearch, isSearching, tokens, nickname }: MenuProps) {
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
      <img
        src={orcainLogo}
        alt="ORCAIN logo"
        style={{
          width: "min(80vw, 380px)",
          height: "auto",
          margin: "0 auto 24px",
          display: "block",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
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
