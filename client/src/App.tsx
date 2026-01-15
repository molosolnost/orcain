import { useState, useEffect, useMemo } from 'react';
import { socketManager } from './net/socket';
import { getAuthToken, getSessionId, clearAuth, getAccountId } from './net/ids';
import type { MatchEndPayload, PrepStartPayload } from './net/types';
import Login from './screens/Login';
import Menu from './screens/Menu';
import Battle from './screens/Battle';
import Onboarding from './screens/Onboarding';
import './App.css';

type Screen = 'login' | 'menu' | 'battle' | 'onboarding';
type BootState = 'checking' | 'telegram_auth' | 'ready' | 'error';

const BUILD_ID = import.meta.env.VITE_BUILD_ID || `dev-${Date.now()}`;
const DEBUG_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

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
  const [accountId, setAccountId] = useState<string | null>(null);
  const [matchEndPayload, setMatchEndPayload] = useState<MatchEndPayload | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [lastPrepStart, setLastPrepStart] = useState<PrepStartPayload | null>(null);
  
  // Boot state machine
  const [bootState, setBootState] = useState<BootState>('checking');
  const [hasTelegramWebApp, setHasTelegramWebApp] = useState(false);
  const [initDataLen, setInitDataLen] = useState(0);
  const [authRequest, setAuthRequest] = useState<string>('idle');
  const [authStatus, setAuthStatus] = useState<number | null>(null);
  const [telegramAuthError, setTelegramAuthError] = useState<string | null>(null);

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
            const { accountId: accId, authToken: token, tokens: tokensVal, nickname: nick } = data;
            
            // Обязательно сохраняем все данные
            localStorage.setItem('orcain_authToken', token);
            localStorage.setItem('orcain_accountId', accId);
            
            // Обновляем state
            setAccountId(accId);
            setAuthToken(token);
            setTokens(tokensVal);
            setNickname(nick || null);
            
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
        setScreen('login');
        setConnected(false);
        setTokens(null);
        setIsSearching(false);
      } else if (isSearching) {
        setIsSearching(false);
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
    });

    socketManager.onMatchFound((payload) => {
      if (payload.matchId) {
        setCurrentMatchId(payload.matchId);
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
      // Устанавливаем currentMatchId если его еще нет (окно пропустило match_found)
      if (currentMatchId === null && payload.matchId) {
        setCurrentMatchId(payload.matchId);
      }
      
      // Игнорируем prep_start от старых матчей
      if (payload.matchId && currentMatchId !== null && payload.matchId !== currentMatchId) {
        return;
      }
      
      // Пробрасываем payload в Battle если мы в battle
      if (screen === 'battle') {
        setLastPrepStart(payload);
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

  const handleLoginSuccess = ({ authToken: token, tokens: initialTokens }: { authToken: string; tokens: number }) => {
    setAuthToken(token);
    setTokens(initialTokens);
    const accId = getAccountId();
    setAccountId(accId);
  };

  const handleNicknameSet = (newNickname: string) => {
    setNickname(newNickname);
    setScreen('menu');
  };

  const handleStartBattle = () => {
    setIsSearching(true);
    socketManager.queueJoin();
  };

  const handleCancelSearch = () => {
    socketManager.queueLeave();
  };

  const handleBackToMenu = () => {
    setScreen('menu');
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

  // Render logic
  // 1. Показываем loading во время проверки или Telegram auth
  if (bootState === 'checking' || bootState === 'telegram_auth') {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          Authenticating...
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

  // 2. Показываем ошибку Telegram auth
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

  // 3. Guest Login - только если НЕТ Telegram WebApp ИЛИ нет initData
  if (screen === 'login' && !authToken && (!hasTelegramWebApp || initDataLen === 0)) {
    return (
      <>
        <Login onLoginSuccess={handleLoginSuccess} />
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

  // 4. Onboarding - если nickname пустой
  if (screen === 'onboarding') {
    // Если authToken отсутствует, не показываем Onboarding
    if (!authToken) {
      return null;
    }
    return (
      <>
        <Onboarding authToken={authToken} onNicknameSet={handleNicknameSet} />
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

  // 5. Connecting...
  if (!connected && authToken) {
    return (
      <>
        <div>Connecting...</div>
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

  // 6. Main screens
  return (
    <>
      <div>
        {screen === 'menu' && (
          <Menu 
            onStartBattle={handleStartBattle} 
            onCancelSearch={handleCancelSearch}
            isSearching={isSearching}
            tokens={tokens}
            nickname={nickname}
          />
        )}
        {screen === 'battle' && (
          <Battle 
            onBackToMenu={handleBackToMenu} 
            tokens={tokens}
            matchEndPayload={matchEndPayload}
            lastPrepStart={lastPrepStart}
            currentMatchId={currentMatchId}
          />
        )}
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

export default App;