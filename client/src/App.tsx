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

  // Инициализация: читаем authToken из localStorage при старте
  useEffect(() => {
    const token = getAuthToken();
    setAuthToken(token);
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
      setScreen('menu');
      if (payload.tokens !== undefined) {
        setTokens(prev => (prev === null ? payload.tokens : prev));
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
      console.log('[SOCKET] queue_left');
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
      // Игнорируем prep_start от старых матчей
      if (payload.matchId && currentMatchId !== null && payload.matchId !== currentMatchId) {
        return;
      }
      setLastPrepStart(payload);
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

  if (screen === 'login' || !authToken) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

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
