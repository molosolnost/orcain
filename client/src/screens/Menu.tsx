import { useState } from "react";
import orcainLogo from "../assets/orcain_logo.webp";
import menuBg from "../assets/orc-theme/menu_bg.svg";
import pvpButtonImage from "../assets/orc-theme/btn_pvp.svg";
import pveButtonImage from "../assets/orc-theme/btn_pve.svg";
import tutorialButtonImage from "../assets/orc-theme/btn_tutorial.svg";
import cancelButtonImage from "../assets/orc-theme/btn_cancel.svg";
import ornamentTopImage from "../assets/orc-theme/ornament_top.svg";
import ornamentBottomImage from "../assets/orc-theme/ornament_bottom.svg";

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
  const overlayOpacity = isDebug ? 0.52 : 0.38;
  const bgOpacity = isDebug ? 0.85 : 1;

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
        background: `linear-gradient(180deg, rgba(10, 14, 10, ${overlayOpacity - 0.05}) 0%, rgba(6, 10, 8, ${overlayOpacity + 0.04}) 100%)`,
        pointerEvents: 'none'
      }} />

      <img
        src={ornamentTopImage}
        alt=""
        style={{
          position: 'absolute',
          top: 'max(8px, calc(env(safe-area-inset-top, 0px) + 2px))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(94vw, 620px)',
          opacity: 0.9,
          pointerEvents: 'none',
          zIndex: 1
        }}
      />

      <img
        src={ornamentBottomImage}
        alt=""
        style={{
          position: 'absolute',
          bottom: 'max(8px, calc(env(safe-area-inset-bottom, 0px) + 2px))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(94vw, 620px)',
          opacity: 0.9,
          pointerEvents: 'none',
          zIndex: 1
        }}
      />
      
      {/* Content layer */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isCompact ? '14px' : '18px',
        width: '100%',
        maxWidth: '520px',
        boxSizing: 'border-box',
        padding: `max(44px, calc(env(safe-area-inset-top, 0px) + 38px)) 20px max(44px, calc(env(safe-area-inset-bottom, 0px) + 38px))`
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
                cursor: 'pointer',
                width: 'min(360px, 90vw)',
                minHeight: isCompact ? '84px' : '94px',
                borderRadius: '14px',
                border: 'none',
                backgroundColor: 'transparent',
                padding: 0,
                overflow: 'hidden',
                boxShadow: '0 8px 22px rgba(0,0,0,0.34)'
              }}
            >
              <img
                src={cancelButtonImage}
                alt="Cancel"
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
                width: 'min(390px, 94vw)',
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
                cursor: canStartPvE ? 'pointer' : 'not-allowed',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '14px',
                width: 'min(390px, 94vw)',
                minHeight: isCompact ? '84px' : '94px',
                fontWeight: 700,
                opacity: canStartPvE ? 1 : 0.55,
                padding: 0,
                overflow: 'hidden',
                boxShadow: canStartPvE ? '0 8px 22px rgba(0,0,0,0.34)' : '0 5px 12px rgba(0,0,0,0.22)'
              }}
            >
              <img
                src={pveButtonImage}
                alt={canStartPvE ? 'Start PvE Training' : 'Waiting for connection'}
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
            <button
              onClick={onStartTutorial}
              style={{
                cursor: 'pointer',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '14px',
                width: 'min(390px, 94vw)',
                minHeight: isCompact ? '84px' : '94px',
                fontWeight: 700,
                padding: 0,
                overflow: 'hidden',
                boxShadow: '0 8px 22px rgba(0,0,0,0.34)',
                filter: tutorialCompleted ? 'saturate(0.75) brightness(0.96)' : 'none'
              }}
            >
              <img
                src={tutorialButtonImage}
                alt={tutorialCompleted ? 'Repeat Interactive Tutorial' : 'Interactive Tutorial (Recommended)'}
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
