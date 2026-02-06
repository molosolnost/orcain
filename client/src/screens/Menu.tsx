import { useState } from "react";
import orcainLogo from "../assets/orcain_logo.webp";
import menuBg from "../assets/menu_bg.webp";
import pvpButtonImage from "../assets/pvp_button.webp";

// Build version badge: mode + sha
const buildMode: 'dev' | 'prod' = import.meta.env.PROD ? 'prod' : 'dev';
const buildId: string = import.meta.env.VITE_BUILD_SHA || 'local';
const isDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
const showBuildBadge = isDebug || buildMode === 'dev';

interface MenuProps {
  onStartBattle: () => void;
  onStartPvE: () => void;
  onStartTutorial: () => void;
  onCancelSearch: () => void;
  isSearching: boolean;
  tokens: number | null;
  nickname: string | null;
  connected: boolean;
  tutorialCompleted: boolean;
}

export default function Menu({
  onStartBattle,
  onStartPvE,
  onStartTutorial,
  onCancelSearch,
  isSearching,
  tokens,
  nickname,
  connected,
  tutorialCompleted
}: MenuProps) {
  const [pvpPressed, setPvpPressed] = useState(false);
  // Кнопка Start Battle disabled если tokens !== null && tokens < 1
  const hasEnoughTokens = connected && tokens !== null && tokens >= 1;
  const canStartPvE = connected;
  const pvpDisabledReason = connected ? 'Not enough tokens' : 'Waiting for connection';
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
        {!connected && (
          <div style={{ fontSize: '13px', color: '#ffcc80', textAlign: 'center', maxWidth: '330px', lineHeight: 1.35 }}>
            Connecting to server... PvP/PvE buttons will unlock automatically after connection.
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
              aria-label="Start PvP battle"
              onPointerDown={() => {
                if (hasEnoughTokens) setPvpPressed(true);
              }}
              onPointerUp={() => setPvpPressed(false)}
              onPointerLeave={() => setPvpPressed(false)}
              onPointerCancel={() => setPvpPressed(false)}
              style={{
                padding: 0,
                cursor: hasEnoughTokens ? 'pointer' : 'not-allowed',
                width: 'min(330px, 88vw)',
                minHeight: isCompact ? '84px' : '94px',
                borderRadius: '14px',
                border: 'none',
                backgroundColor: 'transparent',
                position: 'relative',
                overflow: 'hidden',
                touchAction: 'manipulation',
                transform: pvpPressed ? 'scale(0.98)' : 'scale(1)',
                transition: 'transform 120ms ease, filter 180ms ease, box-shadow 180ms ease, opacity 180ms ease',
                filter: hasEnoughTokens
                  ? (pvpPressed ? 'brightness(0.9)' : 'none')
                  : 'grayscale(0.35) brightness(0.52)',
                boxShadow: hasEnoughTokens
                  ? (pvpPressed ? '0 4px 14px rgba(0,0,0,0.32)' : '0 8px 22px rgba(0,0,0,0.36)')
                  : '0 4px 10px rgba(0,0,0,0.24)',
                opacity: hasEnoughTokens ? 1 : 0.86
              }}
            >
              <img
                src={pvpButtonImage}
                alt=""
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
              {!hasEnoughTokens && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.42)',
                    pointerEvents: 'none'
                  }}
                />
              )}
            </button>
            {!hasEnoughTokens && (
              <div style={{ fontSize: '12px', color: '#ddd', marginTop: '-6px', textAlign: 'center' }}>
                {pvpDisabledReason}
              </div>
            )}
            <button 
              onClick={onStartPvE}
              disabled={!canStartPvE}
              style={{
                padding: '14px 24px',
                fontSize: 'clamp(16px, 4.4vw, 18px)',
                cursor: canStartPvE ? 'pointer' : 'not-allowed',
                backgroundColor: '#4caf50',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                width: 'min(300px, 84vw)',
                minHeight: '48px',
                fontWeight: 700,
                opacity: canStartPvE ? 1 : 0.55
              }}
            >
              {canStartPvE ? 'Start PvE Training' : 'Waiting for connection'}
            </button>
            <button
              onClick={onStartTutorial}
              style={{
                padding: '14px 24px',
                fontSize: 'clamp(16px, 4.4vw, 18px)',
                cursor: 'pointer',
                backgroundColor: tutorialCompleted ? '#607d8b' : '#ff9800',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                width: 'min(300px, 84vw)',
                minHeight: '48px',
                fontWeight: 700
              }}
            >
              {tutorialCompleted ? 'Repeat Interactive Tutorial' : 'Interactive Tutorial (Recommended)'}
            </button>
            <div style={{ fontSize: '12px', color: '#ddd', textAlign: 'center', maxWidth: '320px', lineHeight: 1.4 }}>
              No timer. You will be guided step by step: which card goes to which slot and why.
            </div>
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
