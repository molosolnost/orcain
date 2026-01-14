import { useState, useEffect } from 'react';
import { socketManager } from './net/socket';
import { getAuthToken, getSessionId, clearAuth } from './net/ids';
import type { MatchEndPayload, PrepStartPayload } from './net/types';
import Login from './screens/Login';
import Menu from './screens/Menu';
import Battle from './screens/Battle';
import './App.css';

type Screen = 'login' | 'menu' | 'battle';

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [connected, setConnected] = useState(false);
  const [tokens, setTokens] = useState<number | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [matchEndPayload, setMatchEndPayload] = useState<MatchEndPayload | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [lastPrepStart, setLastPrepStart] = useState<PrepStartPayload | null>(null);
  const [isTelegramAuthPending, setIsTelegramAuthPending] = useState(false);
  const [telegramAuthError, setTelegramAuthError] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);

  // Инициализация: проверяем Telegram Mini App или читаем authToken из localStorage
  useEffect(() => {
    // Безопасная инициализация Telegram WebApp
    const tg = (window as any).Telegram?.WebApp;
    
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
<<<<<<< HEAD
=======
      const hasInitData = typeof initData === 'string' && initData.trim().length > 0;
>>>>>>> 45af369 (Fix: Vercel build (remove unused vars in App.tsx))
      
      if (initData && typeof initData === 'string' && initData.trim().length > 0) {
        // Автологин через Telegram
        setIsTelegramAuthPending(true);
        const API_BASE = import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';
        
        fetch(`${API_BASE}/auth/telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ initData }),
        })
          .then(async (response) => {
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
              
              throw new Error(errorMessage);
            }
            return response.json();
          })
          .then((data) => {
            const { accountId, authToken, tokens, nickname: tgNickname } = data;
            
            // Сохраняем authToken и accountId в localStorage
            localStorage.setItem('orcain_authToken', authToken);
            localStorage.setItem('orcain_accountId', accountId);
            
            setAuthToken(authToken);
            setTokens(tokens);
            setNickname(tgNickname || null);
            
            // Если nickname отсутствует, показываем onboarding, иначе сразу в меню
            if (!tgNickname) {
              setScreen('login'); // Будет показан onboarding
            } else {
              setScreen('menu');
            }
            setIsTelegramAuthPending(false);
          })
          .catch((error) => {
            console.error('[AUTH_TG_FAIL]', 'network error', error);
            setIsTelegramAuthPending(false);
            // НЕ молча уходим в guest - показываем ошибку
            // Но все равно fallback к guest для возможности продолжить
            alert(error.message || 'Failed to authenticate with Telegram. Using guest mode.');
            const token = getAuthToken();
            setAuthToken(token);
          });
      } else {
        // Нет initData - fallback к guest auth
        const token = getAuthToken();
        setAuthToken(token);
      }
    } else {
      // Telegram WebApp не доступен - fallback к guest auth
      const token = getAuthToken();
      setAuthToken(token);
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
      if (payload.nickname !== undefined) {
        setNickname(payload.nickname || null);
      }
      if (payload.tokens !== undefined) {
        setTokens(prev => (prev === null ? payload.tokens : prev));
      }
      // Если nickname отсутствует, показываем onboarding, иначе меню
      if (!payload.nickname) {
        setScreen('login'); // Будет показан onboarding
      } else {
        setScreen('menu');
      }
    });
    
    // Обработка ошибок авторизации
    socketManager.onErrorMsg((payload) => {
      if (payload.message === 'Unauthorized') {
        clearAuth();
        setAuthToken(null);
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
  }, [authToken, currentMatchId]);

  const handleLoginSuccess = ({ authToken: token, tokens: initialTokens }: { authToken: string; tokens: number }) => {
    setAuthToken(token);
    setTokens(initialTokens);
    // После guest login тоже нужно проверить nickname через hello_ok
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

  // Не показываем Login экран если идет автологин через Telegram
  if ((screen === 'login' || !authToken) && !isTelegramAuthPending) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }
  
  // Показываем загрузку во время автологина
  if (isTelegramAuthPending) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Authenticating...</div>;
  }

<<<<<<< HEAD
=======
  // Показываем ошибку Telegram auth если есть
  if (!authToken && telegramAuthError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '12px' }}>
        <div>Telegram authentication failed.</div>
        <div style={{ fontSize: '12px', color: '#888' }}>
          {telegramAuthError}
        </div>
      </div>
    );
  }

>>>>>>> 45af369 (Fix: Vercel build (remove unused vars in App.tsx))
  if (!connected) {
    return <div>Connecting...</div>;
  }

  return (
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
  );
}

export default App;
