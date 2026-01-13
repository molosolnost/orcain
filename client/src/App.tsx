import { useState, useEffect } from 'react';
import { socketManager } from './net/socket';
import { getAuthToken, getSessionId, clearAuth } from './net/ids';
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
    
    console.log("[APP] hello send", { sessionId, hasToken: !!authToken });
    
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
      console.log("[APP] hello_ok", payload);
      setConnected(true);
      setScreen('menu');
      if (payload.tokens !== undefined) {
        setTokens(prev => (prev === null ? payload.tokens : prev));
      }
    });
    
    // Обработка ошибок авторизации
    socketManager.onErrorMsg((payload) => {
      console.log("[APP] error_msg", payload);
      if (payload.message === 'Unauthorized') {
        clearAuth();
        setAuthToken(null);
        setScreen('login');
        setConnected(false);
        setTokens(null);
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
      // on "queue_ok": setTokens(payload.tokens)
      if (payload?.tokens !== undefined) {
        setTokens(payload.tokens);
      }
    });

    socketManager.onMatchFound((payload) => {
      // on "match_found": setTokens(payload.yourTokens)
      if (payload.yourTokens !== undefined) {
        setTokens(payload.yourTokens);
      }
    });

    socketManager.onMatchEnd((payload) => {
      // on "match_end": setTokens(payload.yourTokens)
      if (payload.yourTokens !== undefined) {
        setTokens(payload.yourTokens);
      }
    });

    // Сокет должен жить всю сессию вкладки, не отключаем при cleanup
  }, [authToken]);

  const handleLoginSuccess = ({ authToken: token, tokens: initialTokens }: { authToken: string; tokens: number }) => {
    // Обновляем state authToken, что вызовет переподключение через useEffect
    // accountId сохраняется в localStorage через Login компонент, здесь не используется
    setAuthToken(token);
    setTokens(initialTokens);
  };

  const handleBattleStart = () => {
    setScreen('battle');
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
      {screen === 'menu' && <Menu onBattleStart={handleBattleStart} tokens={tokens} />}
      {screen === 'battle' && <Battle onBackToMenu={handleBackToMenu} tokens={tokens} />}
    </div>
  );
}

export default App;
