const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
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
const CARD_GRASS = 'GRASS';
const MAX_HP = 10;
const START_HP = 10;
const PREP_TIME_MS = 20000; // 20 seconds
const STEP_DELAY_MS = 900; // ~0.9 seconds between steps
const ROUNDS_PER_MATCH = 3;
const START_TOKENS = 10;
const MATCH_COST = 1;
const DISCONNECT_GRACE_MS = 5000; // 5 seconds grace period for reconnect
const PLAY_STEP_TIMEOUT_MS = 15000; // 15 seconds global timeout for PLAY phase
const BOTH_AFK_ROUNDS_TO_BURN = 2; // Number of consecutive rounds where both players are AFK to burn pot
const AFK_FORFEIT_ROUNDS = 2; // Number of consecutive rounds where a single player is AFK to forfeit

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
    stepTimer: null,
    watchdogTimer: null,
    bothAfkStreak: 0,
    afkStreakBySid: new Map() // sessionId -> streak count
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
    const payload1 = payloadForSidFn(socket1);
    // Лог для match_end с полной информацией перед emit
    if (event === 'match_end') {
      const sessionId1 = getSessionIdBySocket(socket1);
      // Используем сохранённые _forfeitLoserId и _forfeitWinnerId если есть (для forfeit)
      let winnerPlayerId, loserPlayerId;
      if (match._forfeitLoserId && match._forfeitWinnerId) {
        // Для forfeit используем сохранённые значения
        loserPlayerId = match._forfeitLoserId;
        winnerPlayerId = match._forfeitWinnerId;
      } else {
        // Для обычного завершения вычисляем через payload.winner
        winnerPlayerId = payload1.winner === 'YOU' ? sessionId1 : (sessionId1 === match.sessions[0] ? match.sessions[1] : match.sessions[0]);
        loserPlayerId = payload1.winner === 'YOU' ? (sessionId1 === match.sessions[0] ? match.sessions[1] : match.sessions[0]) : sessionId1;
      }
      // Гарантируем, что reason всегда есть
      if (!payload1.reason) {
        payload1.reason = 'normal';
      }
      // Валидация: loserId не должен быть undefined
      if (!loserPlayerId || !winnerPlayerId) {
        log(`[MATCH_END_EMIT_BUG] matchId=${match.id} winnerId=${winnerPlayerId} loserId=${loserPlayerId} reason=${payload1.reason}`);
      }
      console.log("[MATCH_END_EMIT]", { matchId: match.id, winnerId: winnerPlayerId, loserId: loserPlayerId, reason: payload1.reason });
      log(`[MATCH_END_EMIT] matchId=${match.id} reason=${payload1.reason} to=${sessionId1} winnerPlayerId=${winnerPlayerId} loserPlayerId=${loserPlayerId} winner=${payload1.winner}`);
    }
    emitToPlayer(match, socket1, event, payload1);
  }
  if (socket2) {
    const payload2 = payloadForSidFn(socket2);
    // Лог для match_end с полной информацией перед emit
    if (event === 'match_end') {
      const sessionId2 = getSessionIdBySocket(socket2);
      // Используем сохранённые _forfeitLoserId и _forfeitWinnerId если есть (для forfeit)
      let winnerPlayerId, loserPlayerId;
      if (match._forfeitLoserId && match._forfeitWinnerId) {
        // Для forfeit используем сохранённые значения
        loserPlayerId = match._forfeitLoserId;
        winnerPlayerId = match._forfeitWinnerId;
      } else {
        // Для обычного завершения вычисляем через payload.winner
        winnerPlayerId = payload2.winner === 'YOU' ? sessionId2 : (sessionId2 === match.sessions[0] ? match.sessions[1] : match.sessions[0]);
        loserPlayerId = payload2.winner === 'YOU' ? (sessionId2 === match.sessions[0] ? match.sessions[1] : match.sessions[0]) : sessionId2;
      }
      // Гарантируем, что reason всегда есть
      if (!payload2.reason) {
        payload2.reason = 'normal';
      }
      // Валидация: loserId не должен быть undefined
      if (!loserPlayerId || !winnerPlayerId) {
        log(`[MATCH_END_EMIT_BUG] matchId=${match.id} winnerId=${winnerPlayerId} loserId=${loserPlayerId} reason=${payload2.reason}`);
      }
      console.log("[MATCH_END_EMIT]", { matchId: match.id, winnerId: winnerPlayerId, loserId: loserPlayerId, reason: payload2.reason });
      log(`[MATCH_END_EMIT] matchId=${match.id} reason=${payload2.reason} to=${sessionId2} winnerPlayerId=${winnerPlayerId} loserPlayerId=${loserPlayerId} winner=${payload2.winner}`);
    }
    emitToPlayer(match, socket2, event, payload2);
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

function fillAfkLayout(playerData, matchId = null) {
  // Проверяем draftLayout: если содержит хотя бы одну карту из CARDS
  const hasDraftCards = playerData.draftLayout && playerData.draftLayout.some(card => card && CARDS.includes(card));
  
  if (hasDraftCards) {
    // Игрок отправил draft - заполняем null позиции в draftLayout на GRASS
    const finalLayout = [];
    for (let i = 0; i < 3; i++) {
      finalLayout[i] = playerData.draftLayout[i] || CARD_GRASS;
    }
    playerData.layout = finalLayout;
    playerData.confirmed = true;
  } else {
    // DraftLayout пустой (все null) - игрок вообще ничего не ставил
    playerData.layout = [CARD_GRASS, CARD_GRASS, CARD_GRASS];
    playerData.confirmed = true;
  }
}

function finalizeLayoutsAndAfk(match) {
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);
  
  if (!p1Data || !p2Data) return { p1IsAfk: false, p2IsAfk: false };
  
  // Финализируем layouts для каждого игрока
  if (!p1Data.layout || !p1Data.confirmed) {
    fillAfkLayout(p1Data, match.id);
  }
  if (!p2Data.layout || !p2Data.confirmed) {
    fillAfkLayout(p2Data, match.id);
  }
  
  // Определяем AFK по финальному layout: все карты должны быть GRASS
  const p1IsAfk = p1Data.layout && p1Data.layout.length === 3 && p1Data.layout.every(c => c === CARD_GRASS);
  const p2IsAfk = p2Data.layout && p2Data.layout.length === 3 && p2Data.layout.every(c => c === CARD_GRASS);
  
  return { p1IsAfk, p2IsAfk };
}

function applyStepLogic(player1Card, player2Card, player1Hp, player2Hp) {
  let newP1Hp = player1Hp;
  let newP2Hp = player2Hp;

  // GRASS - NOOP карта, не влияет на HP и не триггерит эффекты
  // Но не блокирует эффекты других карт (ATTACK против GRASS наносит урон)
  if (player1Card === CARD_GRASS && player2Card === CARD_GRASS) {
    return { p1Hp: newP1Hp, p2Hp: newP2Hp };
  }

  // (1) HEAL всегда +1 HP (GRASS не имеет эффекта HEAL)
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
  // ATTACK vs GRASS -> цель (GRASS игрок) получает -2 HP
  // DEFENSE сам по себе ничего не делает
  // COUNTER сам по себе ничего не делает
  // GRASS сам по себе ничего не делает (не блокирует атаки)

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
      // ATTACK vs HEAL, GRASS или другой случай -> цель получает -2
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
      // ATTACK vs HEAL, GRASS или другой случай -> цель получает -2
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
  
  // Если матч paused из-за disconnect - не играем (ждём reconnect или forfeit)
  if (match.paused && match.pauseReason === 'disconnect') {
    log(`[${match.id}] startPlay: paused due to disconnect, waiting for reconnect or forfeit`);
    return;
  }

  // Финализируем layouts и определяем AFK по финальному layout
  const { p1IsAfk, p2IsAfk } = finalizeLayoutsAndAfk(match);
  
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);
  
  if (p1Data && p2Data) {
    // Обновляем индивидуальные AFK streak
    const p1Sid = match.sessions[0];
    const p2Sid = match.sessions[1];
    
    if (p1IsAfk) {
      const currentStreak = match.afkStreakBySid.get(p1Sid) || 0;
      match.afkStreakBySid.set(p1Sid, currentStreak + 1);
    } else {
      match.afkStreakBySid.set(p1Sid, 0);
    }
    
    if (p2IsAfk) {
      const currentStreak = match.afkStreakBySid.get(p2Sid) || 0;
      match.afkStreakBySid.set(p2Sid, currentStreak + 1);
    } else {
      match.afkStreakBySid.set(p2Sid, 0);
    }
    
    const p1Streak = match.afkStreakBySid.get(p1Sid) || 0;
    const p2Streak = match.afkStreakBySid.get(p2Sid) || 0;
    
    // Логируем статус AFK
    log(`[AFK_STATUS] match=${match.id} p1=${p1Sid} afk=${p1IsAfk} streak=${p1Streak} layout=${JSON.stringify(p1Data.layout)} | p2=${p2Sid} afk=${p2IsAfk} streak=${p2Streak} layout=${JSON.stringify(p2Data.layout)}`);
    
    // Проверка на forfeit одного AFK игрока
    if (p1Streak >= AFK_FORFEIT_ROUNDS && p2Streak < AFK_FORFEIT_ROUNDS) {
      // P1 AFK, P2 активен - P2 побеждает
      log(`[AFK_FORFEIT] match=${match.id} loser=${p1Sid} winner=${p2Sid}`);
      endMatchAfkForfeit(match, p1Sid, p2Sid);
      return;
    }
    
    if (p2Streak >= AFK_FORFEIT_ROUNDS && p1Streak < AFK_FORFEIT_ROUNDS) {
      // P2 AFK, P1 активен - P1 побеждает
      log(`[AFK_FORFEIT] match=${match.id} loser=${p2Sid} winner=${p1Sid}`);
      endMatchAfkForfeit(match, p2Sid, p1Sid);
      return;
    }
    
    // Проверка на оба AFK (burn)
    const bothAfk = p1IsAfk && p2IsAfk;
    if (bothAfk) {
      match.bothAfkStreak++;
      
      if (match.bothAfkStreak >= BOTH_AFK_ROUNDS_TO_BURN) {
        // Завершаем матч с сгоранием pot
        log(`[BURN_END] match=${match.id} pot=${match.pot} reason=timeout`);
        endMatchBothAfk(match);
        return;
      }
    } else {
      // Если хотя бы один не AFK - сбрасываем streak
      match.bothAfkStreak = 0;
    }
  }

  match.roundInProgress = true;
  match.state = 'playing';
  match.paused = false;
  match.pauseReason = null;
  match.currentStepIndex = 0;
  
  // Очищаем предыдущий watchdog если есть
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
  }
  
  // Запускаем watchdog таймер для защиты от зависания
  match.watchdogTimer = setTimeout(() => {
    const currentMatch = matchesById.get(match.id);
    if (!currentMatch) return; // Матч уже завершён
    
    // Проверяем, что матч всё ещё в playing/prep и не двигается
    if (currentMatch.state === 'playing' || currentMatch.state === 'prep') {
      log(`[WATCHDOG_TIMEOUT] match=${currentMatch.id} state=${currentMatch.state}`);
      
      let loserSessionId = null;
      
      if (currentMatch.state === 'prep') {
        // В prep: loser = тот, кто НЕ confirmed
        const p1Data = getPlayerData(currentMatch.sessions[0]);
        const p2Data = getPlayerData(currentMatch.sessions[1]);
        
        if (!p1Data.confirmed && !p2Data.confirmed) {
          // Оба не confirmed - выбираем первого как loser (случайно)
          loserSessionId = currentMatch.sessions[0];
          log(`[WATCHDOG] state=prep both unconfirmed, loser=${loserSessionId}`);
        } else if (!p1Data.confirmed) {
          loserSessionId = currentMatch.sessions[0];
          log(`[WATCHDOG] state=prep p1 unconfirmed, loser=${loserSessionId}`);
        } else if (!p2Data.confirmed) {
          loserSessionId = currentMatch.sessions[1];
          log(`[WATCHDOG] state=prep p2 unconfirmed, loser=${loserSessionId}`);
        }
      } else if (currentMatch.state === 'playing') {
        // В playing: loser = тот, кто paused/disconnected
        if (currentMatch.paused && currentMatch.pauseReason === 'disconnect') {
          // Находим кто disconnected (по grace timer или по отсутствию socket)
          const timer1 = disconnectTimerBySessionId.get(currentMatch.sessions[0]);
          const timer2 = disconnectTimerBySessionId.get(currentMatch.sessions[1]);
          
          if (timer1) {
            loserSessionId = currentMatch.sessions[0];
            log(`[WATCHDOG] state=playing p1 disconnected, loser=${loserSessionId}`);
          } else if (timer2) {
            loserSessionId = currentMatch.sessions[1];
            log(`[WATCHDOG] state=playing p2 disconnected, loser=${loserSessionId}`);
          }
        }
      }
      
      if (loserSessionId) {
        // Фиксируем winnerSessionId ДО вызова endMatchForfeit
        const winnerSessionId = loserSessionId === currentMatch.sessions[0] ? currentMatch.sessions[1] : currentMatch.sessions[0];
        endMatchForfeit(currentMatch, loserSessionId, winnerSessionId, 'timeout');
      } else {
        // Не можем определить loser - форсируем продолжение (для prep)
        if (currentMatch.state === 'prep') {
          log(`[WATCHDOG] state=prep force continue`);
          const p1Data = getPlayerData(currentMatch.sessions[0]);
          const p2Data = getPlayerData(currentMatch.sessions[1]);
          
          if (!p1Data.confirmed) {
            fillAfkLayout(p1Data, currentMatch.id);
          }
          if (!p2Data.confirmed) {
            fillAfkLayout(p2Data, currentMatch.id);
          }
          
          startPlay(currentMatch);
        }
      }
    }
  }, PLAY_STEP_TIMEOUT_MS);
  
  log(`[WATCHDOG_START] match=${match.id} timeout=${PLAY_STEP_TIMEOUT_MS}ms`);
  
  // Layouts уже финализированы в finalizeLayoutsAndAfk выше

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
        matchId: match.id,
        roundIndex: match.roundIndex,
        stepIndex: stepIndex,
        yourCard: p1Card,
        oppCard: p2Card,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp
      };
    } else {
      return {
        matchId: match.id,
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
  
  // Очищаем watchdog и перезапускаем его
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
  }
  
  // Перезапускаем watchdog (только для playing, не для prep)
  match.watchdogTimer = setTimeout(() => {
    const currentMatch = matchesById.get(match.id);
    if (!currentMatch) return;
    
    // Watchdog срабатывает ТОЛЬКО для playing
    if (currentMatch.state === 'playing') {
      log(`[WATCHDOG_TIMEOUT] match=${currentMatch.id} state=${currentMatch.state}`);
      
      let loserSessionId = null;
      
      // В playing: loser = тот, кто paused/disconnected
      if (currentMatch.paused && currentMatch.pauseReason === 'disconnect') {
        const timer1 = disconnectTimerBySessionId.get(currentMatch.sessions[0]);
        const timer2 = disconnectTimerBySessionId.get(currentMatch.sessions[1]);
        
        if (timer1) {
          loserSessionId = currentMatch.sessions[0];
          log(`[WATCHDOG] state=playing p1 disconnected, loser=${loserSessionId}`);
        } else if (timer2) {
          loserSessionId = currentMatch.sessions[1];
          log(`[WATCHDOG] state=playing p2 disconnected, loser=${loserSessionId}`);
        }
      }
      
      if (loserSessionId) {
        // Фиксируем winnerSessionId ДО вызова endMatchForfeit
        const winnerSessionId = loserSessionId === currentMatch.sessions[0] ? currentMatch.sessions[1] : currentMatch.sessions[0];
        endMatchForfeit(currentMatch, loserSessionId, winnerSessionId, 'timeout');
      } else {
        log(`[WATCHDOG] state=playing no clear loser, match may be stuck`);
      }
    } else if (currentMatch.state === 'prep') {
      log(`[WATCHDOG] state=prep (prepTimer will handle autoplay)`);
    }
  }, PLAY_STEP_TIMEOUT_MS);
  
  log(`[WATCHDOG_START] match=${match.id} timeout=${PLAY_STEP_TIMEOUT_MS}ms`);
  
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
        matchId: match.id,
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp
      };
    } else {
      return {
        matchId: match.id,
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
    endMatch(match, 'normal');
    return;
  }

  if (after3Rounds && p1Data.hp === p2Data.hp) {
    // Sudden Death - продолжаем раунды
    match.suddenDeath = true;
    match.roundIndex++;
    // Очищаем watchdog перед новым раундом (он будет перезапущен в startPrepPhase)
    if (match.watchdogTimer) {
      clearTimeout(match.watchdogTimer);
      match.watchdogTimer = null;
      log(`[WATCHDOG_CLEAR] match=${match.id}`);
    }
    startPrepPhase(match);
    return;
  }

  // Следующий раунд
  match.roundIndex++;
  // Очищаем watchdog перед новым раундом (он будет перезапущен в startPrepPhase)
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
  }
  startPrepPhase(match);
}

function startPrepPhase(match) {
  // Упорядоченный жизненный цикл
  match.state = 'prep';
  match.roundInProgress = false;
  
  // Очищаем предыдущий watchdog если есть
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
  }
  
  // Запускаем watchdog таймер для защиты от зависания (только для playing, не для prep)
  match.watchdogTimer = setTimeout(() => {
    const currentMatch = matchesById.get(match.id);
    if (!currentMatch) return; // Матч уже завершён
    
    // Watchdog срабатывает ТОЛЬКО для playing (prep имеет свой prepTimer)
    if (currentMatch.state === 'playing') {
      log(`[WATCHDOG_TIMEOUT] match=${currentMatch.id} state=${currentMatch.state}`);
      
      let loserSessionId = null;
      
      // В playing: loser = тот, кто paused/disconnected
      if (currentMatch.paused && currentMatch.pauseReason === 'disconnect') {
        // Находим кто disconnected (по grace timer)
        const timer1 = disconnectTimerBySessionId.get(currentMatch.sessions[0]);
        const timer2 = disconnectTimerBySessionId.get(currentMatch.sessions[1]);
        
        if (timer1) {
          loserSessionId = currentMatch.sessions[0];
          log(`[WATCHDOG] state=playing p1 disconnected, loser=${loserSessionId}`);
        } else if (timer2) {
          loserSessionId = currentMatch.sessions[1];
          log(`[WATCHDOG] state=playing p2 disconnected, loser=${loserSessionId}`);
        }
      }
      
      if (loserSessionId) {
        // Фиксируем winnerSessionId ДО вызова endMatchForfeit
        const winnerSessionId = loserSessionId === currentMatch.sessions[0] ? currentMatch.sessions[1] : currentMatch.sessions[0];
        endMatchForfeit(currentMatch, loserSessionId, winnerSessionId, 'timeout');
      } else {
        // Не можем определить loser в playing - просто логируем
        log(`[WATCHDOG] state=playing no clear loser, match may be stuck`);
      }
    } else if (currentMatch.state === 'prep') {
      // В prep watchdog только логирует, не завершает матч (prepTimer сам запустит playRound)
      log(`[WATCHDOG] state=prep (prepTimer will handle autoplay)`);
    }
  }, PLAY_STEP_TIMEOUT_MS);
  
  log(`[WATCHDOG_START] match=${match.id} timeout=${PLAY_STEP_TIMEOUT_MS}ms`);
  
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);

  // Сбрасываем состояние подготовки
  p1Data.confirmed = false;
  p1Data.layout = null;
  p1Data.draftLayout = [null, null, null];
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.draftLayout = [null, null, null];

  const deadlineTs = Date.now() + PREP_TIME_MS;
  match.prepDeadline = deadlineTs;

  log(`[${match.id}] prep_start: round=${match.roundIndex}, suddenDeath=${match.suddenDeath}, p1Hp=${p1Data.hp}, p2Hp=${p2Data.hp}`);

  // Отправляем prep_start
  emitToBoth(match, 'prep_start', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const accountId = getAccountIdBySessionId(sessionId);
    const playerTokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    if (sessionId === match.sessions[0]) {
      return {
        matchId: match.id,
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        deadlineTs: deadlineTs,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp,
        pot: match.pot,
        yourTokens: playerTokens,
        cards: [...CARDS]
      };
    } else {
      return {
        matchId: match.id,
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        deadlineTs: deadlineTs,
        yourHp: p2Data.hp,
        oppHp: p1Data.hp,
        pot: match.pot,
        yourTokens: playerTokens,
        cards: [...CARDS]
      };
    }
  });

  // Таймер: при истечении для каждого НЕ confirmed генерируем случайную раскладку и ставим confirmed=true
  // ВАЖНО: этот таймер ВСЕГДА срабатывает и запускает playRound, никаких условий не должно блокировать
  match.prepTimer = setTimeout(() => {
    const currentMatch = matchesById.get(match.id);
    if (!currentMatch) return; // Матч уже завершён
    
    // Защита от undefined sessions
    if (!currentMatch.sessions || currentMatch.sessions.length < 2) return;
    const sid1 = currentMatch.sessions[0];
    const sid2 = currentMatch.sessions[1];
    const p1 = getPlayerData(sid1);
    const p2 = getPlayerData(sid2);
    if (!p1 || !p2) return;
    
    // ВСЕГДА заполняем AFK layouts для тех, кто не confirmed
    if (!p1.confirmed) {
      fillAfkLayout(p1, currentMatch.id);
    }
    if (!p2.confirmed) {
      fillAfkLayout(p2, currentMatch.id);
    }
    
    // ВСЕГДА запускаем playRound (если матч ещё существует и в prep)
    // НЕ проверяем paused/roundInProgress - prepTimer должен быть "железным"
    if (currentMatch.state === 'prep') {
      log(`[PREP_TIMEOUT] match=${currentMatch.id} starting play`);
      startPlay(currentMatch);
    }
  }, PREP_TIME_MS);
}

function endMatchForfeit(match, loserSessionId, winnerSessionId, reason) {
  // ВАЖНО: loserSessionId и winnerSessionId должны быть переданы как аргументы
  // НЕ вычисляем их через players map, так как данные могут быть уже удалены
  
  // Валидация: проверяем что loserSessionId и winnerSessionId валидны
  if (!loserSessionId || !winnerSessionId) {
    log(`[FORFEIT_BUG] match=${match.id} loserSessionId=${loserSessionId} winnerSessionId=${winnerSessionId} reason=${reason}`);
    // Пытаемся восстановить из match.sessions
    if (!loserSessionId && match.sessions && match.sessions.length >= 2) {
      // Если loserSessionId не передан, пытаемся определить по reason
      if (reason === 'disconnect') {
        // Для disconnect нужно найти кто disconnected (по grace timer)
        const timer1 = disconnectTimerBySessionId.get(match.sessions[0]);
        const timer2 = disconnectTimerBySessionId.get(match.sessions[1]);
        if (timer1) {
          loserSessionId = match.sessions[0];
          winnerSessionId = match.sessions[1];
        } else if (timer2) {
          loserSessionId = match.sessions[1];
          winnerSessionId = match.sessions[0];
        }
      }
    }
    // Если всё ещё не определены, используем match.sessions напрямую
    if (!loserSessionId || !winnerSessionId) {
      if (match.sessions && match.sessions.length >= 2) {
        loserSessionId = match.sessions[0];
        winnerSessionId = match.sessions[1];
        log(`[FORFEIT_FALLBACK] using sessions[0] as loser`);
      } else {
        log(`[FORFEIT_ERROR] cannot determine loser/winner, match may be invalid`);
        return;
      }
    }
  }
  
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
  
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
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

  // Получаем данные игроков (может быть null если уже удалены, но это ок для HP)
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);
  
  // Используем финальные HP из данных или дефолтные
  const p1Hp = p1Data ? p1Data.hp : START_HP;
  const p2Hp = p2Data ? p2Data.hp : START_HP;
  
  log(`[FORFEIT] match=${match.id} loser=${loserSessionId} winner=${winnerSessionId} reason=${reason}`);

  // WinnerAccountId получает +match.pot (по accountId, не sessionId)
  const winnerAccountId = getAccountIdBySessionId(winnerSessionId);
  if (winnerAccountId) {
    db.addTokens(winnerAccountId, match.pot);
  }

  // Лог в endMatch
  log(`[END] match=${match.id} winner=${winnerSessionId} finalHp=${p1Hp}-${p2Hp}`);
  
  // Получаем токены по accountId для отправки
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  log(`[TOKENS] end winner=${winnerSessionId} acc1tokens=${acc1Tokens} acc2tokens=${acc2Tokens}`);

  // Определяем loserSessionId для единого payload (уже есть как аргумент)
  // Отправляем одинаковый payload для обоих игроков с winnerId/loserId
  // Гарантируем, что reason всегда присутствует
  const finalReason = reason || 'normal';
  emitToBoth(match, 'match_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const isWinner = sessionId === winnerSessionId;
    const accountId = getAccountIdBySessionId(sessionId);
    const tokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    // Единый payload для обоих игроков с winnerId/loserId
    return {
      matchId: match.id,
      winner: isWinner ? 'YOU' : 'OPPONENT',
      winnerId: winnerSessionId,
      loserId: loserSessionId,
      yourHp: sessionId === match.sessions[0] ? p1Hp : p2Hp,
      oppHp: sessionId === match.sessions[0] ? p2Hp : p1Hp,
      yourTokens: tokens,
      reason: finalReason
    };
  });
  
  log(`[FORCE_END] match=${match.id} reason=${finalReason}`);

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

function endMatchAfkForfeit(match, loserSessionId, winnerSessionId) {
  // Завершение матча когда один игрок AFK N раундов подряд
  // Победитель получает pot, проигравший теряет
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
  
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
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
  
  // Используем финальные HP из данных или дефолтные
  const p1Hp = p1Data ? p1Data.hp : START_HP;
  const p2Hp = p2Data ? p2Data.hp : START_HP;
  
  // WinnerAccountId получает +match.pot (по accountId, не sessionId)
  const winnerAccountId = getAccountIdBySessionId(winnerSessionId);
  if (winnerAccountId) {
    db.addTokens(winnerAccountId, match.pot);
  }
  
  log(`[END] match=${match.id} winner=${winnerSessionId} finalHp=${p1Hp}-${p2Hp}`);
  
  // Получаем токены по accountId для отправки
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  log(`[TOKENS] end winner=${winnerSessionId} acc1tokens=${acc1Tokens} acc2tokens=${acc2Tokens}`);
  
  // Отправляем match_end обоим с reason="afk"
  emitToBoth(match, 'match_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const isWinner = sessionId === winnerSessionId;
    const accountId = getAccountIdBySessionId(sessionId);
    const tokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    return {
      matchId: match.id,
      winner: isWinner ? 'YOU' : 'OPPONENT',
      winnerId: winnerSessionId,
      loserId: loserSessionId,
      yourHp: sessionId === match.sessions[0] ? p1Hp : p2Hp,
      oppHp: sessionId === match.sessions[0] ? p2Hp : p1Hp,
      yourTokens: tokens,
      reason: 'afk',
      message: isWinner ? 'Opponent AFK — you win' : 'You were AFK'
    };
  });
  
  log(`[FORCE_END] match=${match.id} reason=afk`);
  
  // Очистка: не удаляем players, только сбрасываем matchId/layout/confirmed, hp оставляем
  if (p1Data) {
    p1Data.matchId = null;
    p1Data.confirmed = false;
    p1Data.layout = null;
    p1Data.hp = START_HP; // Сбрасываем HP на 10 после матча
  }
  
  if (p2Data) {
    p2Data.matchId = null;
    p2Data.confirmed = false;
    p2Data.layout = null;
    p2Data.hp = START_HP; // Сбрасываем HP на 10 после матча
  }
  
  // Удаляем матч из хранилищ
  matchesById.delete(match.id);
  matchIdBySocket.delete(match.player1);
  matchIdBySocket.delete(match.player2);
}

function endMatchBothAfk(match) {
  // Завершение матча когда оба игрока AFK N раундов подряд
  // Pot сгорает, tokens не возвращаются
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
  
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
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
  
  // Используем финальные HP из данных или дефолтные
  const p1Hp = p1Data ? p1Data.hp : START_HP;
  const p2Hp = p2Data ? p2Data.hp : START_HP;
  
  // Получаем токены по accountId для отправки (НЕ возвращаем pot)
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  
  // Отправляем match_end обоим с winner="OPPONENT" (чтобы никто не видел "YOU WIN")
  // Pot НЕ начисляется, tokens НЕ возвращаются
  emitToBoth(match, 'match_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const accountId = getAccountIdBySessionId(sessionId);
    const tokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    return {
      matchId: match.id,
      winner: 'OPPONENT', // Обоим "OPPONENT" чтобы никто не видел "YOU WIN"
      winnerId: match.sessions[1], // Произвольный, не важен
      loserId: match.sessions[0], // Произвольный, не важен
      yourHp: sessionId === match.sessions[0] ? p1Hp : p2Hp,
      oppHp: sessionId === match.sessions[0] ? p2Hp : p1Hp,
      yourTokens: tokens,
      reason: 'timeout',
      message: 'Both AFK — tokens burned'
    };
  });
  
  log(`[BURN_END] match=${match.id} pot=${match.pot} reason=timeout`);
  
  // Очистка: не удаляем players, только сбрасываем matchId/layout/confirmed, hp оставляем
  if (p1Data) {
    p1Data.matchId = null;
    p1Data.confirmed = false;
    p1Data.layout = null;
    p1Data.hp = START_HP; // Сбрасываем HP на 10 после матча
  }
  
  if (p2Data) {
    p2Data.matchId = null;
    p2Data.confirmed = false;
    p2Data.layout = null;
    p2Data.hp = START_HP; // Сбрасываем HP на 10 после матча
  }
  
  // Удаляем матч из хранилищ
  matchesById.delete(match.id);
  matchIdBySocket.delete(match.player1);
  matchIdBySocket.delete(match.player2);
}

function endMatch(match, reason = 'normal') {
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
  
  if (match.watchdogTimer) {
    clearTimeout(match.watchdogTimer);
    match.watchdogTimer = null;
    log(`[WATCHDOG_CLEAR] match=${match.id}`);
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

  // Определяем loserSessionId для единого payload
  const loserSessionId = winnerSessionId === match.sessions[0] ? match.sessions[1] : match.sessions[0];

  // Отправляем одинаковый payload для обоих игроков с winnerId/loserId
  // Гарантируем, что reason всегда присутствует
  const finalReason = reason || 'normal';
  emitToBoth(match, 'match_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const isWinner = sessionId === winnerSessionId;
    const accountId = getAccountIdBySessionId(sessionId);
    const tokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    // Единый payload для обоих игроков с winnerId/loserId
    return {
      matchId: match.id,
      winner: isWinner ? 'YOU' : 'OPPONENT',
      winnerId: winnerSessionId,
      loserId: loserSessionId,
      yourHp: sessionId === match.sessions[0] ? p1Data.hp : p2Data.hp,
      oppHp: sessionId === match.sessions[0] ? p2Data.hp : p1Data.hp,
      yourTokens: tokens,
      reason: finalReason
    };
  });
  
  log(`[FORCE_END] match=${match.id} reason=${finalReason}`);

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
    // Если матч в состоянии playing или prep - ставим grace timer
    if (match.state === 'playing' || match.state === 'prep') {
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
      
      // Игрок в матче - ставим grace timer
      const existingTimer = disconnectTimerBySessionId.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      
      const timer = setTimeout(() => {
        // Grace period истёк, disconnected игрок проигрывает
        const currentMatch = getMatchBySessionId(sessionId);
        if (!currentMatch) return; // Матч уже завершён
        
        // ВАЖНО: фиксируем loserSessionId и winnerSessionId ДО cleanup
        const loserSessionId = sessionId;
        const winnerSessionId = loserSessionId === currentMatch.sessions[0] ? currentMatch.sessions[1] : currentMatch.sessions[0];
        
        // Завершаем матч с forfeit: disconnected игрок = loser
        endMatchForfeit(currentMatch, loserSessionId, winnerSessionId, 'disconnect');
        
        disconnectTimerBySessionId.delete(sessionId);
      }, DISCONNECT_GRACE_MS);
      
      disconnectTimerBySessionId.set(sessionId, timer);
    }
    
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
        draftLayout: [null, null, null],
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
        // Проверка на self-match: один accountId не может играть против себя
        const acc1AccountId = getAccountIdBySessionId(s1SessionId);
        const acc2AccountId = getAccountIdBySessionId(s2SessionId);
        
        if (acc1AccountId && acc2AccountId && acc1AccountId === acc2AccountId) {
          // Блокируем self-match
          log(`[SELF_MATCH_BLOCK] acc=${acc1AccountId} s1=${s1SessionId} s2=${s2SessionId}`);
          
          // Отправляем ошибку обоим игрокам
          player1Socket.emit('error_msg', { message: 'You cannot fight yourself' });
          player2Socket.emit('error_msg', { message: 'You cannot fight yourself' });
          
          // Оба уже удалены из очереди через shift(), ничего дополнительно делать не нужно
          return;
        }
        
        const match = createMatch(player1Socket, player2Socket);

        const p1Data = getPlayerData(s1SessionId);
        const p2Data = getPlayerData(s2SessionId);
        
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

  socket.on('queue_leave', () => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      console.log('[QUEUE_LEAVE] sid=undefined (no sessionId)');
      socket.emit('queue_left');
      return;
    }
    
    const queueIndex = queue.indexOf(sessionId);
    if (queueIndex !== -1) {
      queue.splice(queueIndex, 1);
      console.log(`[QUEUE_LEAVE] sid=${sessionId} (was in queue)`);
    } else {
      console.log(`[QUEUE_LEAVE] sid=${sessionId} (was not in queue)`);
    }
    
    socket.emit('queue_left');
  });

  socket.on('layout_draft', ({ matchId, layout }) => {
    const sessionId = getSessionIdBySocket(socket.id);
    
    if (!sessionId) {
      return;
    }
    
    // Находим матч строго по matchId
    if (!matchId) {
      return;
    }
    
    const match = matchesById.get(matchId);
    if (!match) {
      return;
    }
    
    // Проверяем состояние матча
    if (match.state !== 'prep') {
      return;
    }

    const playerData = getPlayerData(sessionId);
    if (!playerData || playerData.confirmed) {
      return;
    }

    // Валидация draft layout
    if (!layout || !Array.isArray(layout) || layout.length !== 3) {
      return;
    }

    // Каждый элемент должен быть либо картой из CARDS, либо null
    // Также проверяем что GRASS не отправляется
    const validDraft = layout.every(card => 
      card === null || (typeof card === 'string' && CARDS.includes(card) && card !== CARD_GRASS)
    );

    if (!validDraft) {
      return;
    }

    // Сохраняем draftLayout
    playerData.draftLayout = [...layout];
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
    log(`[AUTH_GUEST_FAIL] reason=exception error=${error.message}`);
    res.status(500).json({ 
      error: 'INTERNAL_ERROR',
      message: 'Failed to create guest account'
    });
  }
});

app.post('/auth/telegram', (req, res) => {
  try {
    const { initData } = req.body;
    
    if (!initData) {
      log(`[AUTH_TG_FAIL] reason=no_initData`);
      return res.status(400).json({ 
        error: 'MISSING_INITDATA',
        message: 'Missing initData'
      });
    }
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_BOT_TOKEN) {
      log(`[AUTH_TG_FAIL] reason=no_bot_token`);
      return res.status(500).json({ 
        error: 'TELEGRAM_NOT_CONFIGURED',
        message: 'Telegram auth not configured'
      });
    }
    
    // Парсим initData как querystring
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      log(`[AUTH_TG_FAIL] reason=no_hash`);
      return res.status(400).json({ 
        error: 'INVALID_INITDATA',
        message: 'Invalid initData: missing hash'
      });
    }
    
    // Собираем data_check_string (key=value по сортировке, hash не включаем)
    const dataCheckPairs = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') {
        dataCheckPairs.push(`${key}=${value}`);
      }
    }
    dataCheckPairs.sort();
    const dataCheckString = dataCheckPairs.join('\n');
    
    // Вычисляем secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
    
    // Вычисляем calculated_hash = HMAC_SHA256(secret_key, data_check_string) hex
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    // Timing-safe сравнение
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculatedHash, 'hex'))) {
      log(`[AUTH_TG_FAIL] reason=invalid_hash`);
      return res.status(401).json({ 
        error: 'INVALID_SIGNATURE',
        message: 'Invalid initData signature'
      });
    }
    
    // Извлекаем user из поля user (JSON строка)
    const userStr = params.get('user');
    if (!userStr) {
      log(`[AUTH_TG_FAIL] reason=no_user`);
      return res.status(400).json({ 
        error: 'MISSING_USER',
        message: 'Invalid initData: missing user'
      });
    }
    
    let user;
    try {
      user = JSON.parse(userStr);
    } catch (e) {
      log(`[AUTH_TG_FAIL] reason=invalid_user_json`);
      return res.status(400).json({ 
        error: 'INVALID_USER_JSON',
        message: 'Invalid initData: invalid user JSON'
      });
    }
    
    if (!user.id) {
      log(`[AUTH_TG_FAIL] reason=no_user_id`);
      return res.status(400).json({ 
        error: 'MISSING_USER_ID',
        message: 'Invalid initData: missing user.id'
      });
    }
    
    // Находим/создаём аккаунт по telegram_user_id
    const account = db.getOrCreateTelegramAccount(user.id);
    
    log(`[AUTH_TG_OK] tgId=${user.id} acc=${account.accountId}`);
    
    res.json({
      accountId: account.accountId,
      authToken: account.authToken,
      tokens: account.tokens
    });
  } catch (error) {
    log(`[AUTH_TG_FAIL] reason=exception error=${error.message}`);
    res.status(500).json({ 
      error: 'INTERNAL_ERROR',
      message: 'Failed to authenticate with Telegram'
    });
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
