import { useState, useEffect, useMemo, useRef } from 'react';
import { socketManager } from './net/socket';
import { getAuthToken, getSessionId, clearAuth, getAccountId } from './net/ids';
import type { MatchEndPayload, PrepStartPayload } from './net/types';
import { initAppViewport, lockAppHeightFor } from './lib/appViewport';
import { startViewportStabilizer } from './lib/viewportStabilizer';
import Login from './screens/Login';
import Menu from './screens/Menu';
import Battle from './screens/Battle';
import Onboarding from './screens/Onboarding';
import TransitionShield from './components/TransitionShield';
import { DEFAULT_AVATAR, DEFAULT_LANGUAGE, type AvatarId, type GameLanguage } from './i18n';
import menuBg from './assets/orc-theme/menu_bg.svg';
import orcainLogo from './assets/orcain_logo.webp';
import pvpButtonImage from './assets/orc-theme/btn_pvp.svg';
import pveButtonImage from './assets/orc-theme/btn_pve.svg';
import tutorialButtonImage from './assets/orc-theme/btn_tutorial.svg';
import battleBgImage from './assets/orc-theme/battle_bg.svg';
import cardAttackImage from './assets/orc-theme/card_attack.svg';
import cardBackImage from './assets/orc-theme/card_back.svg';
import './App.css';

type Screen = 'login' | 'menu' | 'battle' | 'onboarding';
type BootState = 'checking' | 'telegram_auth' | 'ready' | 'error';

const BUILD_ID = import.meta.env.VITE_BUILD_ID || `dev-${Date.now()}`;
const DEBUG_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
const TUTORIAL_COMPLETED_KEY = 'orcain_tutorial_completed_v1';
const PRELOAD_ASSETS = [
  menuBg,
  battleBgImage,
  orcainLogo,
  pvpButtonImage,
  pveButtonImage,
  tutorialButtonImage,
  cardAttackImage,
  cardBackImage
];

function preloadImage(src: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const img = new Image();

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timer = window.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    img.onload = () => {
      window.clearTimeout(timer);
      finish(true);
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };

    img.decoding = 'async';
    img.src = src;
  });
}

function StartupLoader({ progress, assetsReady, bootState }: { progress: number; assetsReady: boolean; bootState: BootState }) {
  const bootResolved = bootState === 'ready' || bootState === 'error';
  const statusText = !assetsReady
    ? `Loading resources... ${progress}%`
    : !bootResolved
    ? 'Authenticating...'
    : 'Preparing game...';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 50% 30%, #323232 0%, #161616 55%, #0e0e0e 100%)',
        color: '#fff',
        zIndex: 20000,
        padding: '24px'
      }}
    >
      <div style={{ width: 'min(420px, 92vw)', textAlign: 'center' }}>
        <div style={{ fontSize: 'clamp(28px, 7vw, 42px)', fontWeight: 800, letterSpacing: '0.05em' }}>
          ORCAIN
        </div>
        <div style={{ marginTop: '10px', fontSize: '14px', color: '#d0d0d0' }}>{statusText}</div>
        <div
          style={{
            marginTop: '18px',
            width: '100%',
            height: '10px',
            borderRadius: '999px',
            backgroundColor: 'rgba(255,255,255,0.15)',
            overflow: 'hidden',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)'
          }}
        >
          <div
            style={{
              width: `${Math.max(8, progress)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #ffb300 0%, #ff8f00 50%, #ff6f00 100%)',
              transition: 'width 220ms ease'
            }}
          />
        </div>
      </div>
    </div>
  );
}

function DebugOverlay({ 
  hasTelegram, 
  initDataLen, 
  authRequest, 
  authStatus, 
  gotAccountId, 
  storedAuthToken, 
  nickname, 
  currentScreen,
  bootState 
}: {
  hasTelegram: boolean;
  initDataLen: number;
  authRequest: string;
  authStatus: number | null;
  gotAccountId: boolean;
  storedAuthToken: boolean;
  nickname: string | null;
  currentScreen: Screen | 'loading' | 'error';
  bootState: BootState;
}) {
  if (!DEBUG_MODE) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '10px',
      left: '10px',
      right: '10px',
      backgroundColor: 'rgba(0,0,0,0.8)',
      color: '#0f0',
      fontSize: '10px',
      padding: '8px',
      fontFamily: 'monospace',
      zIndex: 10000,
      maxHeight: '200px',
      overflow: 'auto',
      border: '1px solid #0f0'
    }}>
      <div><strong>DEBUG MODE</strong></div>
      <div>build: {BUILD_ID}</div>
      <div>hasTelegram: {String(hasTelegram)}</div>
      <div>initDataLen: {initDataLen}</div>
      <div>authRequest: {authRequest}</div>
      {authStatus !== null && <div>authStatus: {authStatus}</div>}
      <div>gotAccountId: {String(gotAccountId)}</div>
      <div>storedAuthToken: {String(storedAuthToken)}</div>
      <div>nickname: {nickname || '<empty>'}</div>
      <div>currentScreen: {currentScreen}</div>
      <div>bootState: {bootState}</div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [connected, setConnected] = useState(false);
  const [tokens, setTokens] = useState<number | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [language, setLanguage] = useState<GameLanguage>(DEFAULT_LANGUAGE);
  const [avatar, setAvatar] = useState<AvatarId>(DEFAULT_AVATAR);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [matchEndPayload, setMatchEndPayload] = useState<MatchEndPayload | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [lastPrepStart, setLastPrepStart] = useState<PrepStartPayload | null>(null);
  const [matchMode, setMatchMode] = useState<'pvp' | 'pve' | null>(null); // Track PvP vs PvE
  const [tutorialMode, setTutorialMode] = useState(false);
  const [tutorialCompleted, setTutorialCompleted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(TUTORIAL_COMPLETED_KEY) === '1';
  });
  const [transitionShieldVisible, setTransitionShieldVisible] = useState(false);
  const transitionUnlockRef = useRef<(() => void) | null>(null);
  
  // Boot state machine
  const [bootState, setBootState] = useState<BootState>('checking');
  const [hasTelegramWebApp, setHasTelegramWebApp] = useState(false);
  const [initDataLen, setInitDataLen] = useState(0);
  const [authRequest, setAuthRequest] = useState<string>('idle');
  const [authStatus, setAuthStatus] = useState<number | null>(null);
  const [telegramAuthError, setTelegramAuthError] = useState<string | null>(null);
  const [assetsReady, setAssetsReady] = useState(false);
  const [assetsProgress, setAssetsProgress] = useState(0);

  useEffect(() => {
    const cleanupViewport = initAppViewport();
    return () => {
      cleanupViewport();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const assets = [...new Set(PRELOAD_ASSETS)];
    const total = assets.length;

    if (total === 0) {
      setAssetsProgress(100);
      setAssetsReady(true);
      return;
    }

    setAssetsProgress(0);
    setAssetsReady(false);

    (async () => {
      let loaded = 0;
      for (const asset of assets) {
        await preloadImage(asset);
        loaded += 1;
        if (!cancelled) {
          setAssetsProgress(Math.round((loaded / total) * 100));
        }
      }
      if (!cancelled) {
        setAssetsProgress(100);
        setAssetsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const startBattleTransition = () => {
    setTransitionShieldVisible(true);
    if (transitionUnlockRef.current) {
      transitionUnlockRef.current();
      transitionUnlockRef.current = null;
    }
    transitionUnlockRef.current = lockAppHeightFor(1500);
  };

  const stopBattleTransition = () => {
    setTransitionShieldVisible(false);
    if (transitionUnlockRef.current) {
      transitionUnlockRef.current();
      transitionUnlockRef.current = null;
    }
  };

  // Инициализация: проверяем Telegram Mini App или читаем authToken из localStorage
  useEffect(() => {
    setBootState('checking');
    
    // Безопасная инициализация Telegram WebApp
    const tg = (window as any).Telegram?.WebApp;
    const hasTg = Boolean(tg);
    setHasTelegramWebApp(hasTg);
    
    if (tg) {
      // Обязательно вызываем ready() перед любыми действиями
      tg.ready();
      
      // Безопасные вызовы только если методы существуют
      if (typeof tg.expand === 'function') {
        tg.expand();
      }
      if (typeof tg.disableVerticalSwipes === 'function') {
        tg.disableVerticalSwipes();
      }
      
      // Проверяем initData для автологина
      const initData = tg.initData;
      const hasInitData = typeof initData === 'string' && initData.trim().length > 0;
      setInitDataLen(hasInitData ? initData.length : 0);
      
      if (hasInitData) {
        // Автологин через Telegram
        setBootState('telegram_auth');
        setAuthRequest('started');
        setTelegramAuthError(null);
        const API_BASE = import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';

        if (!API_BASE || !/^https?:\/\//.test(API_BASE)) {
          console.error('VITE_API_BASE is missing or invalid');
          setBootState('error');
          setAuthRequest('error');
          setTelegramAuthError('VITE_API_BASE is missing or invalid');
          return;
        }

        const authUrl = API_BASE.replace(/\/$/, '') + '/auth/telegram';
        
        fetch(authUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ initData }),
        })
          .then(async (response) => {
            setAuthStatus(response.status);
            
            if (!response.ok) {
              const text = await response.text();
              console.error('[AUTH_TG_FAIL]', response.status, text);
              
              let errorMessage = 'Failed to authenticate with Telegram';
              try {
                const errorJson = JSON.parse(text);
                errorMessage = errorJson.message || errorJson.error || `Server error ${response.status}`;
              } catch (e) {
                errorMessage = text || `Server error ${response.status}`;
              }
              
              setBootState('error');
              setAuthRequest('error');
              setTelegramAuthError(errorMessage);
              throw new Error(errorMessage);
            }
            return response.json();
          })
          .then((data) => {
            const { accountId: accId, authToken: token, tokens: tokensVal, nickname: nick, language: lang, avatar: profileAvatar } = data;
            
            // Обязательно сохраняем все данные
            localStorage.setItem('orcain_authToken', token);
            localStorage.setItem('orcain_accountId', accId);
            
            // Обновляем state
            setAccountId(accId);
            setAuthToken(token);
            setTokens(tokensVal);
            setNickname(nick || null);
            setLanguage((lang === 'en' || lang === 'ru') ? lang : DEFAULT_LANGUAGE);
            setAvatar((typeof profileAvatar === 'string' ? profileAvatar : DEFAULT_AVATAR) as AvatarId);
            
            setBootState('ready');
            setAuthRequest('ok');
            
            // Если nickname пустой, показываем onboarding, иначе menu
            if (!nick || nick.trim().length === 0) {
              setScreen('onboarding');
            } else {
              setScreen('menu');
            }
          })
          .catch((error) => {
            console.error('[AUTH_TG_FAIL]', 'network error', error);
            setBootState('error');
            setAuthRequest('error');
            setTelegramAuthError(error.message || 'Failed to authenticate with Telegram');
          });
      } else {
        // Нет initData - fallback к guest auth
        setBootState('ready');
        const token = getAuthToken();
        const accId = getAccountId();
        setAuthToken(token);
        setAccountId(accId);
        setLanguage(DEFAULT_LANGUAGE);
        setAvatar(DEFAULT_AVATAR);
        if (!token) {
          setScreen('login');
        }
      }
    } else {
      // Telegram WebApp не доступен - fallback к guest auth
      setBootState('ready');
      const token = getAuthToken();
      const accId = getAccountId();
      setAuthToken(token);
      setAccountId(accId);
      setLanguage(DEFAULT_LANGUAGE);
      setAvatar(DEFAULT_AVATAR);
      if (!token) {
        setScreen('login');
      }
    }
  }, []);

  // Подключение к socket и отправка hello при наличии authToken
  useEffect(() => {
    if (!authToken) {
      setScreen('login');
      setConnected(false);
      return;
    }

    const socket = socketManager.connect();
    const sessionId = getSessionId();
    
    // Отправляем hello с sessionId и authToken сразу после подключения
    const sendHello = () => {
      socketManager.hello(sessionId, authToken);
    };
    
    socket.on('connect', sendHello);
    
    // Если уже подключен, отправляем сразу
    if (socket.connected) {
      sendHello();
    }
    
    // Обработка hello_ok - сигнал успешной авторизации
    socketManager.onHelloOk((payload) => {
      setConnected(true);
      
      // Обновляем nickname если пришёл
      if (payload.nickname !== undefined) {
        setNickname(payload.nickname || null);
      }
      
      // Обновляем tokens
      if (payload.tokens !== undefined) {
        setTokens(prev => (prev === null ? payload.tokens : prev));
      }

      if (payload.language === 'ru' || payload.language === 'en') {
        setLanguage(payload.language);
      }

      if (payload.avatar) {
        setAvatar(payload.avatar);
      }
      
      // Если nickname пустой и мы не в onboarding - показываем onboarding
      const currentNick = payload.nickname !== undefined ? payload.nickname : nickname;
      if (!currentNick || currentNick.trim().length === 0) {
        if (screen !== 'onboarding' && screen !== 'battle') {
          setScreen('onboarding');
        }
      } else {
        // Если nickname есть и мы не в battle - показываем menu
        if (screen !== 'battle') {
          setScreen('menu');
        }
      }
    });
    
    // Обработка ошибок авторизации
    socketManager.onErrorMsg((payload) => {
      if (payload.message === 'Unauthorized') {
        clearAuth();
        setAuthToken(null);
        setAccountId(null);
        setNickname(null);
        setLanguage(DEFAULT_LANGUAGE);
        setAvatar(DEFAULT_AVATAR);
        setScreen('login');
        setConnected(false);
        setTokens(null);
        setIsSearching(false);
        stopBattleTransition();
      } else if (isSearching) {
        setIsSearching(false);
        stopBattleTransition();
        alert(payload.message);
      }
    });
    
    // Обработка sync_state для reconnect
    socketManager.onSyncState((payload) => {
      if (payload.inMatch && payload.matchId) {
        // Игрок в матче, переключаемся на экран боя
        setScreen('battle');
      }
    });

    socketManager.onQueueOk((payload) => {
      if (payload?.tokens !== undefined) {
        setTokens(payload.tokens);
      }
    });

    socketManager.onQueueLeft(() => {
      // Если уже в battle (матч нашёлся раньше отмены) - игнорируем
      if (screen === 'battle') {
        return;
      }
      setIsSearching(false);
      stopBattleTransition();
    });

    socketManager.onMatchFound((payload) => {
      startBattleTransition();
      if (payload.matchId) {
        setCurrentMatchId(payload.matchId);
      }
      // Infer matchMode from pot (PvE has pot=0)
      if (payload.pot === 0 && matchMode === null) {
        setMatchMode('pve');
      } else if (payload.pot > 0 && matchMode === null) {
        setMatchMode('pvp');
      }
      setMatchEndPayload(null);
      setLastPrepStart(null);
      setIsSearching(false);
      setScreen('battle');
      if (payload.yourTokens !== undefined) {
        setTokens(payload.yourTokens);
      }
      // Nicknames будут переданы в Battle через prep_start или match_found payload
    });

    socketManager.onPrepStart((payload: PrepStartPayload) => {
      // DEBUG: логируем получение prep_start
      if (DEBUG_MODE) {
        console.log(`[PREP_START_RECEIVED] round=${payload.roundIndex} deadlineTs=${payload.deadlineTs} yourNickname=${payload.yourNickname || '<null>'} oppNickname=${payload.oppNickname || '<null>'} currentScreen=${screen} currentMatchId=${currentMatchId}`);
      }
      
      // Устанавливаем currentMatchId если его еще нет (окно пропустило match_found)
      if (currentMatchId === null && payload.matchId) {
        setCurrentMatchId(payload.matchId);
      }
      
      // Игнорируем prep_start от старых матчей
      if (payload.matchId && currentMatchId !== null && payload.matchId !== currentMatchId) {
        if (DEBUG_MODE) {
          console.log(`[PREP_START_IGNORED] matchId mismatch: payload=${payload.matchId} current=${currentMatchId}`);
        }
        return;
      }
      
      // КРИТИЧНО: ВСЕГДА сохраняем lastPrepStart, не только когда screen === 'battle'
      // Это гарантирует, что данные будут доступны в Battle сразу после монтирования
      // Race condition: prep_start может прийти до того, как screen установлен в 'battle'
      setLastPrepStart(payload);
      
      // Если мы еще не в battle, но получили prep_start - переключаемся на battle
      // (это может быть если match_found был пропущен)
      if (screen !== 'battle' && payload.matchId) {
        setScreen('battle');
      }
    });

    socketManager.onMatchEnd((payload: MatchEndPayload) => {
      // Игнорируем match_end от старых матчей
      if (payload.matchId && currentMatchId !== null && payload.matchId !== currentMatchId) {
        return;
      }
      
      if (payload.yourTokens !== undefined) {
        setTokens(payload.yourTokens);
      }
      setMatchEndPayload(payload);
      if (screen !== 'battle') {
        setScreen('battle');
      }
    });

    // Сокет должен жить всю сессию вкладки, не отключаем при cleanup
  }, [authToken, currentMatchId, nickname, screen]);

  const handleLoginSuccess = ({
    authToken: token,
    tokens: initialTokens,
    nickname: initialNickname,
    language: initialLanguage,
    avatar: initialAvatar
  }: {
    authToken: string;
    tokens: number;
    nickname?: string | null;
    language?: GameLanguage;
    avatar?: AvatarId;
  }) => {
    setAuthToken(token);
    setTokens(initialTokens);
    setNickname(initialNickname || null);
    setLanguage(initialLanguage || DEFAULT_LANGUAGE);
    setAvatar(initialAvatar || DEFAULT_AVATAR);
    const accId = getAccountId();
    setAccountId(accId);
  };

  const handleNicknameSet = (newNickname: string) => {
    setNickname(newNickname);
    setScreen('menu');
  };

  const handleProfileUpdate = (payload: {
    nickname?: string | null;
    tokens?: number;
    language?: GameLanguage;
    avatar?: AvatarId;
  }) => {
    if (payload.nickname !== undefined) {
      setNickname(payload.nickname || null);
    }
    if (payload.tokens !== undefined) {
      setTokens(payload.tokens);
    }
    if (payload.language) {
      setLanguage(payload.language);
    }
    if (payload.avatar) {
      setAvatar(payload.avatar);
    }
  };

  const handleStartBattle = () => {
    if (!connected) return;
    setTutorialMode(false);
    setMatchMode('pvp');
    setIsSearching(true);
    socketManager.queueJoin();
  };

  const handleStartPvE = () => {
    if (!connected) return;
    setTutorialMode(false);
    setMatchMode('pve');
    // PvE is immediate - no queue, no tokens
    socketManager.pveStart();
    // match_found will be sent, which will switch to battle screen
  };

  const handleStartTutorial = () => {
    startBattleTransition();
    setTutorialMode(true);
    setMatchMode(null);
    setIsSearching(false);
    setMatchEndPayload(null);
    setLastPrepStart(null);
    setCurrentMatchId(null);
    setScreen('battle');
  };

  const handleCancelSearch = () => {
    socketManager.queueLeave();
    stopBattleTransition();
  };

  const handleBackToMenu = () => {
    stopBattleTransition();
    setMatchMode(null);
    setTutorialMode(false);
    setMatchEndPayload(null);
    setLastPrepStart(null);
    setCurrentMatchId(null);
    setScreen('menu');
  };

  const handlePlayAgain = () => {
    setMatchEndPayload(null);
    setLastPrepStart(null);
    setCurrentMatchId(null);
    if (matchMode === 'pve') {
      handleStartPvE();
    } else if (matchMode === 'pvp') {
      handleStartBattle();
    }
  };

  const handleTutorialComplete = () => {
    localStorage.setItem(TUTORIAL_COMPLETED_KEY, '1');
    setTutorialCompleted(true);
    setTutorialMode(false);
  };

  // Debug info
  const storedAuthToken = useMemo(() => {
    return !!localStorage.getItem('orcain_authToken');
  }, [authToken]);

  const gotAccountId = useMemo(() => {
    return !!accountId;
  }, [accountId]);

  // Определяем текущий экран для debug
  const currentScreenForDebug = useMemo(() => {
    if (bootState === 'checking' || bootState === 'telegram_auth') return 'loading';
    if (bootState === 'error' && !authToken) return 'error';
    return screen;
  }, [bootState, screen, authToken]);

  useEffect(() => {
    if (screen !== 'battle') return;
    let cancelled = false;
    (async () => {
      await startViewportStabilizer({ timeoutMs: 1500 });
      if (!cancelled) {
        setTransitionShieldVisible(false);
      }
      stopBattleTransition();
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, lastPrepStart]);

  // Failsafe: if transition shield is visible outside battle, auto-hide it.
  useEffect(() => {
    if (!transitionShieldVisible) return;
    if (screen === 'battle' || tutorialMode) return;
    const timer = window.setTimeout(() => {
      stopBattleTransition();
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [transitionShieldVisible, screen, tutorialMode]);

  // Render logic
  const bootResolved = bootState === 'ready' || bootState === 'error';
  if (!assetsReady || !bootResolved) {
    return <StartupLoader progress={assetsProgress} assetsReady={assetsReady} bootState={bootState} />;
  }

  // 1. Показываем ошибку Telegram auth
  if (bootState === 'error' && hasTelegramWebApp && initDataLen > 0 && !authToken) {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '12px' }}>
          <div>Telegram authentication failed.</div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            {telegramAuthError || 'Please retry from Telegram.'}
          </div>
        </div>
        <DebugOverlay
          hasTelegram={hasTelegramWebApp}
          initDataLen={initDataLen}
          authRequest={authRequest}
          authStatus={authStatus}
          gotAccountId={gotAccountId}
          storedAuthToken={storedAuthToken}
          nickname={nickname}
          currentScreen={currentScreenForDebug}
          bootState={bootState}
        />
      </>
    );
  }

  // 2. Guest Login - только если НЕТ Telegram WebApp ИЛИ нет initData
  if (screen === 'login' && !authToken && (!hasTelegramWebApp || initDataLen === 0)) {
    return (
      <>
        <Login onLoginSuccess={handleLoginSuccess} language={language} />
        <DebugOverlay
          hasTelegram={hasTelegramWebApp}
          initDataLen={initDataLen}
          authRequest={authRequest}
          authStatus={authStatus}
          gotAccountId={gotAccountId}
          storedAuthToken={storedAuthToken}
          nickname={nickname}
          currentScreen={currentScreenForDebug}
          bootState={bootState}
        />
      </>
    );
  }

  // 3. Onboarding - если nickname пустой
  if (screen === 'onboarding') {
    // Если authToken отсутствует, не показываем Onboarding
    if (!authToken) {
      return null;
    }
    return (
      <>
        <Onboarding authToken={authToken} onNicknameSet={handleNicknameSet} language={language} />
        <DebugOverlay
          hasTelegram={hasTelegramWebApp}
          initDataLen={initDataLen}
          authRequest={authRequest}
          authStatus={authStatus}
          gotAccountId={gotAccountId}
          storedAuthToken={storedAuthToken}
          nickname={nickname}
          currentScreen={currentScreenForDebug}
          bootState={bootState}
        />
      </>
    );
  }

  // 5. Main screens: один неизменяемый root, смена внутреннего контента без mount при переходе Menu→Battle
  const battleActive = tutorialMode || isSearching || matchMode === 'pve' || screen === 'battle';
  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: screen === 'menu' && !tutorialMode ? 'block' : 'none',
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
          }}
        >
          <Menu
            onStartBattle={handleStartBattle}
            onStartPvE={handleStartPvE}
            onStartTutorial={handleStartTutorial}
            onCancelSearch={handleCancelSearch}
            onProfileUpdate={handleProfileUpdate}
            isSearching={isSearching}
            tokens={tokens}
            nickname={nickname}
            language={language}
            avatar={avatar}
            authToken={authToken}
            connected={connected}
            tutorialCompleted={tutorialCompleted}
          />
        </div>
        {battleActive && (
          <div
            style={{
              display: screen === 'battle' || tutorialMode ? 'block' : 'none',
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
            }}
          >
            <Battle
              onBackToMenu={handleBackToMenu}
              onPlayAgain={handlePlayAgain}
              onTutorialComplete={handleTutorialComplete}
              matchMode={matchMode}
              tutorialMode={tutorialMode}
              tokens={tokens}
              matchEndPayload={matchEndPayload}
              lastPrepStart={lastPrepStart}
              currentMatchId={currentMatchId}
            />
          </div>
        )}
      </div>
      <TransitionShield visible={transitionShieldVisible} />
      <DebugOverlay
        hasTelegram={hasTelegramWebApp}
        initDataLen={initDataLen}
        authRequest={authRequest}
        authStatus={authStatus}
        gotAccountId={gotAccountId}
        storedAuthToken={storedAuthToken}
        nickname={nickname}
        currentScreen={currentScreenForDebug}
        bootState={bootState}
      />
    </>
  );
}

export default App;
