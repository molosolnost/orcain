import orcainLogo from "../assets/orcain_logo.png";
import menuBg from "../assets/menu_bg.png";

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
  const isCompact = typeof window !== 'undefined' ? window.innerHeight < 740 : false;

  // Debug mode: adjust overlay opacity
  const overlayOpacity = isDebug ? 0.55 : 0.45;
  const bgOpacity = isDebug ? 0.3 : 0.5;

  return (
    <div style={{ 
      position: 'relative',
      width: '100%',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Background layer */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${menuBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        opacity: bgOpacity,
        pointerEvents: 'none'
      }} />
      
      {/* Dark overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})`,
        pointerEvents: 'none'
      }} />
      
      {/* Content layer */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isCompact ? '14px' : '18px',
        width: '100%',
        maxWidth: '480px',
        boxSizing: 'border-box',
        padding: `max(16px, env(safe-area-inset-top, 0px)) 20px max(16px, env(safe-area-inset-bottom, 0px))`
      }}>
        <img
          src={orcainLogo}
          alt="ORCAIN logo"
          style={{
            width: "min(78vw, 360px)",
            height: "auto",
            margin: isCompact ? "0 auto 10px" : "0 auto 16px",
            display: "block",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        {nickname && (
          <div style={{ fontSize: 'clamp(15px, 4vw, 18px)', color: '#ddd', marginTop: '-6px', textAlign: 'center' }}>
            Welcome, <strong>{nickname}</strong>
          </div>
        )}
        <div style={{ fontSize: 'clamp(18px, 5vw, 22px)', fontWeight: 700 }}>Tokens: {tokens === null ? '—' : tokens}</div>
        
        {isSearching ? (
          <>
            <div style={{ fontSize: 'clamp(15px, 4vw, 18px)', color: '#ddd' }}>Searching opponent…</div>
            <button 
              onClick={onCancelSearch}
              style={{
                padding: '14px 24px',
                fontSize: 'clamp(16px, 4.4vw, 18px)',
                cursor: 'pointer',
                width: 'min(300px, 84vw)',
                minHeight: '48px',
                borderRadius: '10px',
                border: 'none'
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
                padding: '14px 24px',
                fontSize: 'clamp(16px, 4.4vw, 18px)',
                cursor: hasEnoughTokens ? 'pointer' : 'not-allowed',
                opacity: hasEnoughTokens ? 1 : 0.55,
                width: 'min(300px, 84vw)',
                minHeight: '48px',
                borderRadius: '10px',
                border: 'none',
                fontWeight: 700
              }}
            >
              {hasEnoughTokens ? 'Start Battle' : 'Not enough tokens'}
            </button>
            <button 
              onClick={onStartPvE}
              style={{
                padding: '14px 24px',
                fontSize: 'clamp(16px, 4.4vw, 18px)',
                cursor: 'pointer',
                backgroundColor: '#4caf50',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                width: 'min(300px, 84vw)',
                minHeight: '48px',
                fontWeight: 700
              }}
            >
              Start PvE Training
            </button>
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
    </div>
  );
}
