import orcainLogo from "../assets/orcain_logo.png";
import menuBg from "../assets/menu_bg.png";
import BackgroundLayout from "../components/BackgroundLayout";

// Build version badge: mode + sha
const buildMode: 'dev' | 'prod' = import.meta.env.PROD ? 'prod' : 'dev';
const buildId: string = import.meta.env.VITE_BUILD_SHA || 'local';
const isDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
const showBuildBadge = isDebug || buildMode === 'dev';

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

  // Subtle overlay only for readability; no opacity on bg (keeps original tones)
  const overlay = isDebug ? 0.2 : 0.18;

  return (
    <BackgroundLayout bgImage={menuBg} overlay={overlay}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        width: '100%',
        padding: '20px'
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
              {hasEnoughTokens ? 'Start Battle' : 'Недостаточно токенов'}
            </button>
            <div style={{ fontSize: '13px', color: '#888' }}>Стоимость PvP: 1 токен</div>
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
            <div style={{ fontSize: '13px', color: '#888' }}>PvE бесплатно (без наград)</div>
          </>
        )}
        {showBuildBadge && (
          <div style={{ 
            position: 'absolute', 
            bottom: '20px', 
            fontSize: '11px', 
            color: isDebug ? '#999' : '#666',
            opacity: buildMode === 'prod' && !isDebug ? 0.3 : 0.7,
            textAlign: 'center',
            fontFamily: 'monospace'
          }}>
            {buildMode} • {buildId}
          </div>
        )}
      </div>
    </BackgroundLayout>
  );
}