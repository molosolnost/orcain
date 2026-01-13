const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Constants
const CARDS = ['ATTACK', 'DEFENSE', 'HEAL', 'COUNTER'];
const MAX_HP = 10;
const START_HP = 10;
const PREP_TIME_MS = 20000; // 20 seconds
const STEP_DELAY_MS = 900; // ~0.9 seconds between steps
const ROUNDS_PER_MATCH = 3;
const START_TOKENS = 10;
const MATCH_COST = 1;

// Debug flag
const DEBUG = false;

// Helper for debug logging
function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Matchmaking queue (по sessionId)
const queue = [];

// Active matches: matchId -> match
const matchesById = new Map();

// SocketId -> matchId mapping
const matchIdBySocket = new Map();

// Reconnect structures
const sessionIdBySocket = new Map(); // socketId -> sessionId
const socketBySessionId = new Map(); // sessionId -> socketId
const accountIdBySessionId = new Map(); // sessionId -> accountId
const disconnectTimerBySessionId = new Map(); // sessionId -> Timeout

// Player data: sessionId -> { hp, confirmed, layout, matchId }
const players = new Map();

// Match structure: { id, sessions: [s1SessionId, s2SessionId], socketIds: [p1SocketId, p2SocketId], player1, player2, roundIndex, suddenDeath, state, roundInProgress, playAbortToken, prepTimer, pot, paused, pauseReason, currentStepIndex, stepTimer }
// state: 'prep' | 'playing' | 'ended'
// player1, player2 - текущие socketId (могут меняться при reconnect)
// sessions - постоянные sessionId игроков
// paused - флаг паузы матча
// pauseReason - причина паузы ("disconnect" и т.д.)
// currentStepIndex - текущий шаг в раунде (0..2)
// stepTimer - таймер для задержки между шагами

function createMatch(player1Socket, player2Socket) {
  const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const s1SessionId = getSessionIdBySocket(player1Socket.id);
  const s2SessionId = getSessionIdBySocket(player2Socket.id);
  
  if (!s1SessionId || !s2SessionId) {
    throw new Error('Cannot create match: missing sessionId');
  }
  
  const acc1AccountId = getAccountIdBySessionId(s1SessionId);
  const acc2AccountId = getAccountIdBySessionId(s2SessionId);
  
  if (!acc1AccountId || !acc2AccountId) {
    throw new Error('Cannot create match: missing accountId');
  }
  
  const p1Data = getPlayerData(s1SessionId);
  const p2Data = getPlayerData(s2SessionId);

  // Перед стартом матча снять MATCH_COST с каждого аккаунта (по accountId)
  if (!db.deductTokens(acc1AccountId, MATCH_COST) || !db.deductTokens(acc2AccountId, MATCH_COST)) {
    throw new Error('Cannot create match: not enough tokens');
  }

  // Создать pot = MATCH_COST * 2
  const pot = MATCH_COST * 2;
  
  const match = {
    id: matchId,
    sessions: [s1SessionId, s2SessionId],
    socketIds: [player1Socket.id, player2Socket.id],
    player1: player1Socket.id,
    player2: player2Socket.id,
    roundIndex: 1,
    suddenDeath: false,
    state: 'prep',
    prepDeadline: null,
    prepTimer: null,
    roundInProgress: false,
    playAbortToken: 0,
    pot: pot,
    paused: false,
    pauseReason: null,
    currentStepIndex: null,
    stepTimer: null
  };

  // Сохраняем матч по ID и по socketId
  matchesById.set(matchId, match);
  matchIdBySocket.set(player1Socket.id, matchId);
  matchIdBySocket.set(player2Socket.id, matchId);

  // Добавляем игроков в Socket.IO room
  io.sockets.sockets.get(player1Socket.id)?.join(matchId);
  io.sockets.sockets.get(player2Socket.id)?.join(matchId);

  // DEBUG лог на матч
  log(`[TOKENS] after_deduct s1=${s1SessionId} acc1=${acc1AccountId} tokens=${db.getTokens(acc1AccountId)} s2=${s2SessionId} acc2=${acc2AccountId} tokens=${db.getTokens(acc2AccountId)} pot=${pot}`);

  // Устанавливаем HP на 10 и обновляем matchId
  p1Data.hp = START_HP;
  p1Data.confirmed = false;
  p1Data.layout = null;
  p1Data.matchId = matchId;

  p2Data.hp = START_HP;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.matchId = matchId;

  return match;
}

function getSessionIdBySocket(socketId) {
  return sessionIdBySocket.get(socketId);
}

function getSocketIdBySessionId(sessionId) {
  return socketBySessionId.get(sessionId);
}

function getAccountIdBySessionId(sessionId) {
  return accountIdBySessionId.get(sessionId);
}

// Функции для работы с токенами через SQLite (обёртки для совместимости)
function getTokensByAccountId(accountId) {
  const tokens = db.getTokens(accountId);
  return tokens !== null ? tokens : START_TOKENS;
}

function getMatch(socketId) {
  const matchId = matchIdBySocket.get(socketId);
  return matchId ? matchesById.get(matchId) : null;
}

function getMatchBySessionId(sessionId) {
  const playerData = players.get(sessionId);
  if (!playerData || !playerData.matchId) return null;
  return matchesById.get(playerData.matchId);
}

function getOpponent(socketId) {
  const match = getMatch(socketId);
  if (!match) return null;
  return socketId === match.player1 ? match.player2 : match.player1;
}

function getOpponentSessionId(match, sessionId) {
  if (!match.sessions) return null;
  return match.sessions[0] === sessionId ? match.sessions[1] : match.sessions[0];
}

function getSocketIdBySessionIdInMatch(match, sessionId) {
  if (!match.sessions || !match.socketIds) return null;
  const index = match.sessions.indexOf(sessionId);
  return index !== -1 ? match.socketIds[index] : null;
}

function getPlayerData(sessionId) {
  return players.get(sessionId);
}

function getPlayerDataBySocket(socketId) {
  const sessionId = getSessionIdBySocket(socketId);
  return sessionId ? players.get(sessionId) : null;
}

function getOpponentData(socketId) {
  const oppId = getOpponent(socketId);
  if (!oppId) return null;
  const oppSessionId = getSessionIdBySocket(oppId);
  return oppSessionId ? players.get(oppSessionId) : null;
}

// Helper функции для отправки сообщений
function emitToPlayer(match, socketId, event, payload) {
  io.to(socketId).emit(event, payload);
}

function emitToBoth(match, event, payloadForSidFn) {
  // payloadForSidFn(socketId) возвращает payload для конкретного игрока
  // Используем актуальные socketIds из match
  const socket1 = match.socketIds[0] || match.player1;
  const socket2 = match.socketIds[1] || match.player2;
  
  if (socket1) {
    emitToPlayer(match, socket1, event, payloadForSidFn(socket1));
  }
  if (socket2) {
    emitToPlayer(match, socket2, event, payloadForSidFn(socket2));
  }
}

function validateLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== 3) return false;
  const unique = new Set(layout);
  if (unique.size !== 3) return false;
  return layout.every(card => CARDS.includes(card));
}

function generateRandomLayout() {
  // Shuffle 4 карты -> взять первые 3 -> shuffle эти 3
  const shuffled4 = [...CARDS].sort(() => Math.random() - 0.5);
  const first3 = shuffled4.slice(0, 3);
  const shuffled3 = first3.sort(() => Math.random() - 0.5);
  return shuffled3;
}

function applyStepLogic(player1Card, player2Card, player1Hp, player2Hp) {
  let newP1Hp = player1Hp;
  let newP2Hp = player2Hp;

  // (1) HEAL всегда +1 HP
  if (player1Card === 'HEAL') {
    newP1Hp = Math.min(newP1Hp + 1, MAX_HP);
  }
  if (player2Card === 'HEAL') {
    newP2Hp = Math.min(newP2Hp + 1, MAX_HP);
  }

  // (2) Attack/Defense/Counter логика
  // ATTACK vs DEFENSE -> 0 урона
  // ATTACK vs ATTACK -> оба -2
  // ATTACK vs COUNTER -> атакующий -2 (защищающийся НЕ получает урон от ATTACK)
  // DEFENSE сам по себе ничего не делает
  // COUNTER сам по себе ничего не делает

  // Обработка player1Card === 'ATTACK'
  if (player1Card === 'ATTACK') {
    if (player2Card === 'DEFENSE') {
      // 0 урона
    } else if (player2Card === 'ATTACK') {
      // Оба получают урон
      newP1Hp = Math.max(0, newP1Hp - 2);
      newP2Hp = Math.max(0, newP2Hp - 2);
    } else if (player2Card === 'COUNTER') {
      // Только атакующий получает урон
      newP1Hp = Math.max(0, newP1Hp - 2);
    } else {
      // ATTACK vs HEAL или другой случай
      newP2Hp = Math.max(0, newP2Hp - 2);
    }
  }

  // Обработка player2Card === 'ATTACK' (только если player1Card !== 'ATTACK', чтобы не дублировать)
  if (player2Card === 'ATTACK' && player1Card !== 'ATTACK') {
    if (player1Card === 'DEFENSE') {
      // 0 урона
    } else if (player1Card === 'COUNTER') {
      // Только атакующий получает урон
      newP2Hp = Math.max(0, newP2Hp - 2);
    } else {
      // ATTACK vs HEAL или другой случай
      newP1Hp = Math.max(0, newP1Hp - 2);
    }
  }

  return { p1Hp: newP1Hp, p2Hp: newP2Hp };
}

function startPlay(match) {
  // Защита от double-start
  if (match.roundInProgress) {
    log(`[${match.id}] startPlay: already in progress, ignoring`);
    return;
  }

  match.roundInProgress = true;
  match.state = 'playing';
  match.paused = false;
  match.pauseReason = null;
  match.currentStepIndex = 0;
  
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);
  
  // Если игроки не подтвердили, генерируем случайные расклады
  if (!p1Data.layout) {
    p1Data.layout = generateRandomLayout();
  }
  if (!p2Data.layout) {
    p2Data.layout = generateRandomLayout();
  }

  // Логируем начало раунда и финальные layouts
  log(`[PLAY] match=${match.id} round=${match.roundIndex} sudden=${match.suddenDeath}`);
  log(`[LAYOUTS] p1=${match.player1} ${JSON.stringify(p1Data.layout)} | p2=${match.player2} ${JSON.stringify(p2Data.layout)}`);

  // Начинаем проигрывание с первого шага
  scheduleStep(match);
}

function doOneStep(match, stepIndex) {
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);
  
  const p1Card = p1Data.layout[stepIndex];
  const p2Card = p2Data.layout[stepIndex];

  const result = applyStepLogic(p1Card, p2Card, p1Data.hp, p2Data.hp);
  p1Data.hp = result.p1Hp;
  p2Data.hp = result.p2Hp;

  // Лог перед каждым step_reveal
  log(`[STEP] match=${match.id} round=${match.roundIndex} step=${stepIndex} p1Card=${p1Card} p2Card=${p2Card} hp=${p1Data.hp}-${p2Data.hp}`);

  // Отправляем step_reveal обоим игрокам (stepIndex: 0, 1, 2)
  emitToBoth(match, 'step_reveal', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    if (sessionId === match.sessions[0]) {
      return {
        roundIndex: match.roundIndex,
        stepIndex: stepIndex,
        yourCard: p1Card,
        oppCard: p2Card,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp
      };
    } else {
      return {
        roundIndex: match.roundIndex,
        stepIndex: stepIndex,
        yourCard: p2Card,
        oppCard: p1Card,
        yourHp: p2Data.hp,
        oppHp: p1Data.hp
      };
    }
  });
}

function scheduleStep(match) {
  // Проверка паузы
  if (match.paused) {
    return;
  }
  
  // Сохраняем токен для проверки аборта
  const token = match.playAbortToken;
  const stepIndex = match.currentStepIndex;
  
  // Задержка: первый шаг 250ms, остальные STEP_DELAY_MS
  const delay = stepIndex === 0 ? 250 : STEP_DELAY_MS;
  
  match.stepTimer = setTimeout(() => {
    // Проверка паузы после задержки
    if (match.paused) {
      return;
    }
    
    // Проверка аборта
    if (match.playAbortToken !== token) {
      log(`[${match.id}] scheduleStep: aborted at step ${stepIndex}`);
      return;
    }
    
    // Выполняем шаг
    doOneStep(match, stepIndex);
    
    // Переходим к следующему шагу или завершаем раунд
    match.currentStepIndex++;
    if (match.currentStepIndex < 3) {
      scheduleStep(match);
    } else {
      // Все шаги завершены
      match.currentStepIndex = null;
      match.roundInProgress = false;
      match.stepTimer = null;
      finishRound(match);
    }
  }, delay);
}

function resumePlay(match) {
  // Возобновление проигрывания с текущего шага
  if (!match.paused || match.pauseReason !== 'disconnect' || match.state !== 'playing') {
    return;
  }
  
  const stepIndex = match.currentStepIndex !== null ? match.currentStepIndex : 0;
  log(`[RESUME] match=${match.id} step=${stepIndex}`);
  
  match.paused = false;
  match.pauseReason = null;
  
  // Продолжаем проигрывание с текущего шага
  scheduleStep(match);
}

function finishRound(match) {
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);

  emitToBoth(match, 'round_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    if (sessionId === match.sessions[0]) {
      return {
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp
      };
    } else {
      return {
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        yourHp: p2Data.hp,
        oppHp: p1Data.hp
      };
    }
  });

  // Проверяем конец матча
  // Матч заканчивается когда: либо кто-то умер (hp==0), либо (после 3+ раундов) hp стали не равны
  const someoneDied = p1Data.hp === 0 || p2Data.hp === 0;
  const after3Rounds = match.roundIndex >= ROUNDS_PER_MATCH;
  const hpNotEqual = p1Data.hp !== p2Data.hp;

  if (someoneDied || (after3Rounds && hpNotEqual)) {
    // Определяем победителя
    endMatch(match);
    return;
  }

  if (after3Rounds && p1Data.hp === p2Data.hp) {
    // Sudden Death - продолжаем раунды
    match.suddenDeath = true;
    match.roundIndex++;
    startPrepPhase(match);
    return;
  }

  // Следующий раунд
  match.roundIndex++;
  startPrepPhase(match);
}

function startPrepPhase(match) {
  // Упорядоченный жизненный цикл
  match.state = 'prep';
  match.roundInProgress = false;
  
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);

  // Сбрасываем состояние подготовки
  p1Data.confirmed = false;
  p1Data.layout = null;
  p2Data.confirmed = false;
  p2Data.layout = null;

  const deadlineTs = Date.now() + PREP_TIME_MS;
  match.prepDeadline = deadlineTs;

  log(`[${match.id}] prep_start: round=${match.roundIndex}, suddenDeath=${match.suddenDeath}, p1Hp=${p1Data.hp}, p2Hp=${p2Data.hp}`);

  // Отправляем prep_start
  emitToBoth(match, 'prep_start', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    if (sessionId === match.sessions[0]) {
      return {
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        deadlineTs: deadlineTs,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp,
        cards: [...CARDS]
      };
    } else {
      return {
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        deadlineTs: deadlineTs,
        yourHp: p2Data.hp,
        oppHp: p1Data.hp,
        cards: [...CARDS]
      };
    }
  });

  // Таймер: при истечении для каждого НЕ confirmed генерируем случайную раскладку и ставим confirmed=true
  match.prepTimer = setTimeout(() => {
    const currentMatch = matchesById.get(match.id);
    // Защита от таймера после confirm: проверяем state и roundInProgress
    if (currentMatch && currentMatch.state === 'prep' && !currentMatch.roundInProgress) {
      // Защита от undefined sessions
      if (!currentMatch.sessions || currentMatch.sessions.length < 2) return;
      const sid1 = currentMatch.sessions[0];
      const sid2 = currentMatch.sessions[1];
      const p1 = getPlayerData(sid1);
      const p2 = getPlayerData(sid2);
      if (!p1 || !p2) return;
      
      // Для каждого игрока, кто НЕ confirmed: генерируем случайную раскладку и ставим confirmed=true
      if (!p1.confirmed) {
        p1.layout = generateRandomLayout();
        p1.confirmed = true;
        log(`[DEFAULT] match=${currentMatch.id} sessionId=${sid1} layout=${JSON.stringify(p1.layout)}`);
      }
      if (!p2.confirmed) {
        p2.layout = generateRandomLayout();
        p2.confirmed = true;
        log(`[DEFAULT] match=${currentMatch.id} sessionId=${sid2} layout=${JSON.stringify(p2.layout)}`);
      }

      // После истечения таймера ВСЕГДА стартуем playRound()
      startPlay(currentMatch);
    }
  }, PREP_TIME_MS);
}

function endMatch(match) {
  match.state = 'ended';
  match.roundInProgress = false;
  match.paused = false;
  match.pauseReason = null;
  
  // Очистка таймеров
  if (match.prepTimer) {
    clearTimeout(match.prepTimer);
    match.prepTimer = null;
  }
  
  if (match.stepTimer) {
    clearTimeout(match.stepTimer);
    match.stepTimer = null;
  }
  
  // Очистка grace timers для обоих игроков
  if (match.sessions && match.sessions.length >= 2) {
    const timer1 = disconnectTimerBySessionId.get(match.sessions[0]);
    if (timer1) {
      clearTimeout(timer1);
      disconnectTimerBySessionId.delete(match.sessions[0]);
    }
    const timer2 = disconnectTimerBySessionId.get(match.sessions[1]);
    if (timer2) {
      clearTimeout(timer2);
      disconnectTimerBySessionId.delete(match.sessions[1]);
    }
  }
  
  // Аборт playRound если он идёт
  match.playAbortToken++;

  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);

  // Вычисляем winnerSessionId (у кого hp больше, либо у кого hp >0 если второй умер)
  let winnerSessionId;
  if (p1Data.hp > p2Data.hp || (p1Data.hp > 0 && p2Data.hp === 0)) {
    winnerSessionId = match.sessions[0];
  } else {
    winnerSessionId = match.sessions[1];
  }

  // WinnerAccountId получает +match.pot (по accountId, не sessionId)
  const winnerAccountId = getAccountIdBySessionId(winnerSessionId);
  if (winnerAccountId) {
    db.addTokens(winnerAccountId, match.pot);
  }

  // Лог в endMatch
  log(`[END] match=${match.id} winner=${winnerSessionId} finalHp=${p1Data.hp}-${p2Data.hp}`);
  
  // Получаем токены по accountId для отправки
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  log(`[TOKENS] end winner=${winnerSessionId} acc1tokens=${acc1Tokens} acc2tokens=${acc2Tokens}`);

  // Отправляем каждому winner: sessionId===winnerSessionId ? "YOU" : "OPPONENT"
  emitToBoth(match, 'match_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const isWinner = sessionId === winnerSessionId;
    const accountId = getAccountIdBySessionId(sessionId);
    const tokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    if (sessionId === match.sessions[0]) {
      return {
        winner: isWinner ? 'YOU' : 'OPPONENT',
        yourHp: p1Data.hp,
        oppHp: p2Data.hp,
        yourTokens: tokens
      };
    } else {
      return {
        winner: isWinner ? 'YOU' : 'OPPONENT',
        yourHp: p2Data.hp,
        oppHp: p1Data.hp,
        yourTokens: tokens
      };
    }
  });

  // Очистка: не удаляем players, только сбрасываем matchId/layout/confirmed, hp оставляем
  p1Data.matchId = null;
  p1Data.confirmed = false;
  p1Data.layout = null;
  p1Data.hp = START_HP; // Сбрасываем HP на 10 после матча

  p2Data.matchId = null;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.hp = START_HP; // Сбрасываем HP на 10 после матча

  // Удаляем матч из хранилищ
  matchesById.delete(match.id);
  matchIdBySocket.delete(match.player1);
  matchIdBySocket.delete(match.player2);
  
  // Socket.IO автоматически очистит room при disconnect всех участников
  // Но можно явно покинуть room если нужно
  // io.socketsLeave(match.id);
}

function handleDisconnect(socketId) {
  const sessionId = getSessionIdBySocket(socketId);
  
  // Удаляем маппинг socketId -> sessionId
  sessionIdBySocket.delete(socketId);
  
  // Удаляем из очереди (по sessionId)
  if (sessionId) {
    const queueIndex = queue.indexOf(sessionId);
    if (queueIndex !== -1) {
      queue.splice(queueIndex, 1);
    }
  }
  
  if (!sessionId) {
    // Нет sessionId, просто удаляем из маппингов
    matchIdBySocket.delete(socketId);
    return;
  }
  
  const match = getMatchBySessionId(sessionId);
  if (match) {
    // Если матч в состоянии PLAY - паузим его
    if (match.state === 'playing' && match.roundInProgress) {
      log(`[PAUSE] match=${match.id} sessionId=${sessionId} step=${match.currentStepIndex}`);
      match.paused = true;
      match.pauseReason = 'disconnect';
      
      // Очищаем stepTimer если есть
      if (match.stepTimer) {
        clearTimeout(match.stepTimer);
        match.stepTimer = null;
      }
      
      // Увеличиваем playAbortToken для остановки текущего scheduleStep
      match.playAbortToken++;
    }
    
    // Игрок в матче - ставим таймер 5 секунд
    const existingTimer = disconnectTimerBySessionId.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const timer = setTimeout(() => {
      // 5 секунд прошло, оппонент побеждает
      const currentMatch = getMatchBySessionId(sessionId);
      if (!currentMatch) return; // Матч уже завершён
      
      const oppSessionId = getOpponentSessionId(currentMatch, sessionId);
      if (!oppSessionId) return;
      
      const oppData = getPlayerData(oppSessionId);
      const myData = getPlayerData(sessionId);
      const oppSocketId = getSocketIdBySessionIdInMatch(currentMatch, oppSessionId);
      
      if (oppSocketId) {
        // Получаем токены оппонента по accountId
        const oppAccountId = getAccountIdBySessionId(oppSessionId);
        const oppTokens = oppAccountId ? (db.getTokens(oppAccountId) !== null ? db.getTokens(oppAccountId) : START_TOKENS) : START_TOKENS;
        
        // Оппонент побеждает
        emitToPlayer(currentMatch, oppSocketId, 'match_end', {
          winner: 'OPPONENT',
          yourHp: oppData.hp,
          oppHp: myData ? myData.hp : 0,
          yourTokens: oppTokens
        });
      }

      // Очистка таймеров
      if (currentMatch.prepTimer) {
        clearTimeout(currentMatch.prepTimer);
        currentMatch.prepTimer = null;
      }
      
      if (currentMatch.stepTimer) {
        clearTimeout(currentMatch.stepTimer);
        currentMatch.stepTimer = null;
      }
      
      currentMatch.paused = false;
      currentMatch.pauseReason = null;
      currentMatch.roundInProgress = false;
      
      // Аборт playRound если он идёт
      currentMatch.playAbortToken++;

      // Сбрасываем состояние оппонента
      oppData.matchId = null;
      oppData.confirmed = false;
      oppData.layout = null;
      oppData.hp = START_HP;
      
      // Сбрасываем состояние отключившегося игрока
      myData.matchId = null;
      myData.confirmed = false;
      myData.layout = null;
      myData.hp = START_HP;

      // Удаляем матч из хранилищ
      matchesById.delete(currentMatch.id);
      matchIdBySocket.delete(currentMatch.player1);
      matchIdBySocket.delete(currentMatch.player2);
      
      disconnectTimerBySessionId.delete(sessionId);
    }, 5000);
    
    disconnectTimerBySessionId.set(sessionId, timer);
    
    // Обновляем socketIds в матче (удаляем отключившийся)
    const socketIndex = match.socketIds.indexOf(socketId);
    if (socketIndex !== -1) {
      match.socketIds[socketIndex] = null;
    }
    matchIdBySocket.delete(socketId);
  } else {
    // Не в матче, просто удаляем маппинг
    matchIdBySocket.delete(socketId);
  }
  
  // НЕ удаляем socketBySessionId сразу - оставляем для reconnect
  // НЕ удаляем players по sessionId - данные сохраняются
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Ждём hello от клиента перед инициализацией
  socket.on('hello', (data) => {
    const { sessionId, authToken } = data;
    if (!sessionId || !authToken) {
      log(`[HELLO] Invalid hello from ${socket.id}: missing sessionId or authToken`);
      socket.emit('error_msg', { message: 'Unauthorized' });
      return;
    }
    
    // Валидируем authToken и получаем accountId из SQLite
    const account = db.getAccountByAuthToken(authToken);
    if (!account) {
      log(`[HELLO] Invalid authToken from ${socket.id}`);
      socket.emit('error_msg', { message: 'Unauthorized' });
      return;
    }
    
    const accountId = account.accountId;
    
    // Сохраняем маппинги
    const oldSocketId = socketBySessionId.get(sessionId);
    if (oldSocketId && oldSocketId !== socket.id) {
      // Старый сокет существует, удаляем его маппинг
      sessionIdBySocket.delete(oldSocketId);
    }
    
    sessionIdBySocket.set(socket.id, sessionId);
    socketBySessionId.set(sessionId, socket.id);
    accountIdBySessionId.set(sessionId, accountId);
    
    // Если был активен disconnect timer для sessionId -> clearTimeout
    const existingTimer = disconnectTimerBySessionId.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      disconnectTimerBySessionId.delete(sessionId);
    }
    
    // Инициализируем или получаем player data (по sessionId)
    let playerData = players.get(sessionId);
    if (!playerData) {
      playerData = {
        hp: START_HP,
        confirmed: false,
        layout: null,
        matchId: null
      };
      players.set(sessionId, playerData);
    }
    
    // Получаем токены по accountId из SQLite
    const tokens = db.getTokens(accountId);
    
    // Отправляем hello_ok с токенами
    socket.emit('hello_ok', {
      tokens: tokens !== null ? tokens : START_TOKENS
    });
    
    // Если sessionId участвует в активном матче
    const match = getMatchBySessionId(sessionId);
    if (match) {
      // Обновляем socketIds в матче
      const sessionIndex = match.sessions.indexOf(sessionId);
      if (sessionIndex !== -1) {
        match.socketIds[sessionIndex] = socket.id;
        if (sessionIndex === 0) {
          match.player1 = socket.id;
        } else {
          match.player2 = socket.id;
        }
      }
      
      // Присоединяем socket к room matchId
      socket.join(match.id);
      matchIdBySocket.set(socket.id, match.id);
      
      // Отправляем sync_state
      const phase = match.state === 'prep' ? 'PREP' : match.state === 'playing' ? 'REVEAL' : 'END';
      const oppSessionId = getOpponentSessionId(match, sessionId);
      const oppHp = oppSessionId ? (getPlayerData(oppSessionId)?.hp || 0) : 0;
      
      socket.emit('sync_state', {
        inMatch: true,
        matchId: match.id,
        phase: phase,
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        yourHp: playerData.hp,
        oppHp: oppHp,
        deadlineTs: match.state === 'prep' ? match.prepDeadline : undefined
      });
      
      // Если матч был на паузе из-за disconnect - возобновляем
      if (match.paused === true && match.pauseReason === 'disconnect' && match.state === 'playing') {
        // Возобновляем проигрывание
        resumePlay(match);
      }
    }
  });

  socket.on('queue_join', () => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      // Нет sessionId, игнорируем или просим отправить hello
      socket.emit('error_msg', { message: 'Please send hello first' });
      return;
    }
    
    if (matchIdBySocket.has(socket.id)) {
      return; // Уже в матче
    }

    const accountId = getAccountIdBySessionId(sessionId);
    if (!accountId) {
      socket.emit('error_msg', { message: 'Missing accountId' });
      return;
    }
    
    // Проверка токенов: если tokens < MATCH_COST, не добавлять в очередь (по accountId)
    const tokens = db.getTokens(accountId);
    if (tokens === null || tokens < MATCH_COST) {
      socket.emit('error_msg', { message: 'Not enough tokens' });
      return;
    }

    // Queue должна избегать дубликатов sessionId
    if (queue.includes(sessionId)) {
      return; // Уже в очереди
    }

    queue.push(sessionId);

    socket.emit('queue_ok', {
      tokens: tokens
    });

    // Проверяем матчмейкинг
    if (queue.length >= 2) {
      const s1SessionId = queue.shift();
      const s2SessionId = queue.shift();

      const s1SocketId = getSocketIdBySessionId(s1SessionId);
      const s2SocketId = getSocketIdBySessionId(s2SessionId);
      
      const player1Socket = s1SocketId ? io.sockets.sockets.get(s1SocketId) : null;
      const player2Socket = s2SocketId ? io.sockets.sockets.get(s2SocketId) : null;

      if (player1Socket && player2Socket) {
        const match = createMatch(player1Socket, player2Socket);

        const p1Data = getPlayerData(s1SessionId);
        const p2Data = getPlayerData(s2SessionId);
        
        const acc1AccountId = getAccountIdBySessionId(s1SessionId);
        const acc2AccountId = getAccountIdBySessionId(s2SessionId);
        const acc1Tokens = acc1AccountId ? (db.getTokens(acc1AccountId) !== null ? db.getTokens(acc1AccountId) : START_TOKENS) : START_TOKENS;
        const acc2Tokens = acc2AccountId ? (db.getTokens(acc2AccountId) !== null ? db.getTokens(acc2AccountId) : START_TOKENS) : START_TOKENS;

        log(`[MATCH_FOUND] matchId=${match.id} s1=${s1SessionId} s2=${s2SessionId}`);

        // Отправляем match_found с токенами и pot
        player1Socket.emit('match_found', {
          matchId: match.id,
          yourHp: p1Data.hp,
          oppHp: p2Data.hp,
          yourTokens: acc1Tokens,
          pot: match.pot
        });

        player2Socket.emit('match_found', {
          matchId: match.id,
          yourHp: p2Data.hp,
          oppHp: p1Data.hp,
          yourTokens: acc2Tokens,
          pot: match.pot
        });

        // Начинаем первый раунд
        startPrepPhase(match);
      }
    }
  });

  socket.on('layout_confirm', (data) => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      return;
    }
    
    const match = getMatch(socket.id);
    // Жёсткая валидация состояния: только если match.state === 'prep'
    if (!match || match.state !== 'prep') {
      log(`[IGNORED_CONFIRM] sid=${socket.id} sessionId=${sessionId} reason=state_or_already_confirmed`);
      return;
    }

    const playerData = getPlayerData(sessionId);
    // Игнорировать confirm если already confirmed=true
    if (!playerData || playerData.confirmed) {
      log(`[IGNORED_CONFIRM] sid=${socket.id} sessionId=${sessionId} reason=state_or_already_confirmed`);
      return;
    }

    // Если confirm пришёл после дедлайна и раунд уже стартовал -> игнорировать молча
    if (match.prepDeadline && Date.now() >= match.prepDeadline) {
      // Проверяем, не начался ли уже раунд
      if (match.roundInProgress || match.state !== 'prep') {
        log(`[IGNORED_CONFIRM] sid=${socket.id} reason=state_or_already_confirmed`);
        return;
      }
    }

    // Валидация расклада
    if (!validateLayout(data.layout)) {
      return; // Игнорируем молча
    }

    playerData.confirmed = true;
    playerData.layout = data.layout;

    // Лог после успешной validateLayout и перед socket.emit("confirm_ok")
    log(`[CONFIRM] match=${match.id} sid=${socket.id} sessionId=${sessionId} layout=${JSON.stringify(playerData.layout)}`);

    // confirm_ok ТОЛЬКО игроку, который подтвердил
    socket.emit('confirm_ok');

    // Проверяем, можно ли начать раунд
    const oppSessionId = getOpponentSessionId(match, sessionId);
    const oppData = oppSessionId ? getPlayerData(oppSessionId) : null;
    if (oppData && oppData.confirmed) {
      // Оба подтвердили раньше таймера, начинаем раунд сразу
      // Защита от таймера после confirm: обязательно clearTimeout + set prepTimer=null
      if (match.prepTimer) {
        clearTimeout(match.prepTimer);
        match.prepTimer = null;
      }
      startPlay(match);
    }
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket.id);
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Health check for Render
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// Auth endpoints
app.post('/auth/guest', (req, res) => {
  try {
    const account = db.createGuestAccount();
    res.json({
      accountId: account.accountId,
      authToken: account.authToken,
      tokens: account.tokens
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create guest account' });
  }
});

app.get('/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const authToken = authHeader.substring(7);
  const account = db.getAccountByAuthToken(authToken);
  
  if (!account) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({
    accountId: account.accountId,
    tokens: account.tokens
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
