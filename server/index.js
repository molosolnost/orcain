const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');
const {
  CARD_IDS,
  CARD_METADATA,
  CARD_ID_TO_TYPE,
  DEFAULT_DECK,
  getHandForAccount,
  isValidCardId,
  cardIdToType
} = require('./cards');

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
// CARDS is now deprecated - use CARD_IDS and cardIdToType for battle engine
// Legacy CARDS array kept for backward compatibility in applyStepLogic
const CARDS = ['ATTACK', 'DEFENSE', 'HEAL', 'COUNTER'];
const GRASS = 'GRASS';
const MAX_HP = 10;
const START_HP = 10;
const PREP_TIME_MS = 20000; // 20 seconds
const STEP_DELAY_MS = 900; // ~0.9 seconds between steps
const ROUNDS_PER_MATCH = 3;
const START_TOKENS = 10;
const MATCH_COST = 1;
const DISCONNECT_GRACE_MS = 5000; // 5 seconds grace period for reconnect
const PLAY_STEP_TIMEOUT_MS = 15000; // 15 seconds global timeout for PLAY phase

// Debug flag (can be set via env DEBUG_MATCH=1)
const DEBUG = process.env.DEBUG_MATCH === '1' || process.env.DEBUG_MATCH === 'true';

// Helper for debug logging
function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Runtime invariant assertion
// If condition is false, logs error and returns false (does not crash in prod)
function assertInvariant(match, condition, code, details) {
  if (!condition) {
    const matchId = match?.id || 'unknown';
    const roundIndex = match?.roundIndex || 'unknown';
    const state = match?.state || 'unknown';
    console.error(`[INVARIANT_FAIL] code=${code} matchId=${matchId} roundIndex=${roundIndex} state=${state} details=${JSON.stringify(details)}`);
    return false;
  }
  return true;
}

// Structured logging helpers
function logFinalizeRound(match, data) {
  const { p1_hadDraft, p1_afk, p1_streak, p2_hadDraft, p2_afk, p2_streak, bothAfkStreak, decision } = data;
  console.log(`[FINALIZE_ROUND] matchId=${match.id} roundIndex=${match.roundIndex} p1_hadDraft=${p1_hadDraft} p1_afk=${p1_afk} p1_streak=${p1_streak} p2_hadDraft=${p2_hadDraft} p2_afk=${p2_afk} p2_streak=${p2_streak} bothAfkStreak=${bothAfkStreak} decision=${decision}`);
}

function logFinalizeRoundDecision(match, decision, reason) {
  console.log(`[FINALIZE_ROUND_DECISION] matchId=${match.id} roundIndex=${match.roundIndex} decision=${decision} reason=${reason || 'N/A'}`);
}

function logMatchEnd(match, reason, winner, loser) {
  // Safe logging: handle null/undefined gracefully
  const winnerStr = winner || 'N/A';
  const loserStr = loser || 'N/A';
  console.log(`[MATCH_END] matchId=${match.id} roundIndex=${match.roundIndex} reason=${reason || 'N/A'} winner=${winnerStr} loser=${loserStr}`);
}

function logStateTransition(match, fromState, toState, reason) {
  console.log(`[STATE_TRANSITION] matchId=${match.id} roundIndex=${match.roundIndex} from=${fromState} to=${toState} reason=${reason || 'N/A'}`);
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
  
  // Get hands for both players (source of truth - server decides hand)
  const p1Hand = getHandForAccount(acc1AccountId);
  const p2Hand = getHandForAccount(acc2AccountId);
  
  // INVARIANT: hand must be exactly 4 cards
  if (p1Hand.length !== 4) {
    console.error(`[INVARIANT_FAIL] code=HAND_SIZE_P1 handSize=${p1Hand.length} expected=4`);
    throw new Error(`Invalid hand size for player 1: ${p1Hand.length}, expected 4`);
  }
  if (p2Hand.length !== 4) {
    console.error(`[INVARIANT_FAIL] code=HAND_SIZE_P2 handSize=${p2Hand.length} expected=4`);
    throw new Error(`Invalid hand size for player 2: ${p2Hand.length}, expected 4`);
  }
  
  const match = {
    id: matchId,
    mode: 'PVP', // 'PVP' | 'PVE'
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
    // Card system
    hands: new Map(), // sessionId -> CardId[4] (stable for entire match)
    // AFK tracking
    hadDraftThisRound: new Map(), // sessionId -> boolean (сбрасывается каждый раунд)
    afkStreakByPlayer: new Map(), // sessionId -> number (streak count)
    bothAfkStreak: 0, // счетчик подряд идущих раундов где оба AFK
    // Invariant tracking
    finalizedRoundIndex: null, // Последний финализированный roundIndex (для single-run guard)
    // Bot tracking (PVE only)
    botLastOpponentCard: null // Last card revealed by opponent (for bot decision)
  };
  
  // Store hands in match
  match.hands.set(s1SessionId, p1Hand);
  match.hands.set(s2SessionId, p2Hand);

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
  p1Data.draftLayout = null;
  p1Data.matchId = matchId;

  p2Data.hp = START_HP;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.draftLayout = null;
  p2Data.matchId = matchId;

  return match;
}

// BOT constants
const BOT_SESSION_ID = 'BOT';
const BOT_ACCOUNT_ID = 'BOT';
const BOT_NICKNAME = 'Orc Bot';
const BOT_HAND = ['attack', 'defense', 'heal', 'counter']; // Fixed hand for bot

// Create PvE match (player vs bot)
function createPvEMatch(playerSocket) {
  const matchId = `pve_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const playerSessionId = getSessionIdBySocket(playerSocket.id);
  if (!playerSessionId) {
    throw new Error('Cannot create PvE match: missing sessionId');
  }
  
  const playerAccountId = getAccountIdBySessionId(playerSessionId);
  if (!playerAccountId) {
    throw new Error('Cannot create PvE match: missing accountId');
  }
  
  // PvE is FREE - no token deduction
  const pot = 0; // No pot in PvE
  
  // Get player hand
  const playerHand = getHandForAccount(playerAccountId);
  if (playerHand.length !== 4) {
    console.error(`[INVARIANT_FAIL] code=HAND_SIZE_PLAYER handSize=${playerHand.length} expected=4`);
    throw new Error(`Invalid hand size for player: ${playerHand.length}, expected 4`);
  }
  
  // Create bot player data
  const botData = getPlayerData(BOT_SESSION_ID);
  botData.hp = START_HP;
  botData.confirmed = false;
  botData.layout = null;
  botData.draftLayout = null;
  botData.matchId = matchId;
  
  // Create player data
  const playerData = getPlayerData(playerSessionId);
  playerData.hp = START_HP;
  playerData.confirmed = false;
  playerData.layout = null;
  playerData.draftLayout = null;
  playerData.matchId = matchId;
  
  // Create match structure
  const match = {
    id: matchId,
    mode: 'PVE', // PvE mode
    sessions: [playerSessionId, BOT_SESSION_ID],
    socketIds: [playerSocket.id, null], // Bot has no socket
    player1: playerSocket.id,
    player2: null, // Bot has no socket
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
    // Card system
    hands: new Map(),
    // AFK tracking
    hadDraftThisRound: new Map(),
    afkStreakByPlayer: new Map(),
    bothAfkStreak: 0,
    // Invariant tracking
    finalizedRoundIndex: null,
    // Bot tracking
    botLastOpponentCard: null
  };
  
  // Store hands
  match.hands.set(playerSessionId, playerHand);
  match.hands.set(BOT_SESSION_ID, BOT_HAND);
  
  // Store match
  matchesById.set(matchId, match);
  matchIdBySocket.set(playerSocket.id, matchId);
  
  // Add player to Socket.IO room
  io.sockets.sockets.get(playerSocket.id)?.join(matchId);
  
  // Register bot session/account mappings (for compatibility)
  sessionIdBySocket.set('BOT_SOCKET', BOT_SESSION_ID);
  socketBySessionId.set(BOT_SESSION_ID, 'BOT_SOCKET');
  accountIdBySessionId.set(BOT_SESSION_ID, BOT_ACCOUNT_ID);
  
  console.log(`[PVE_MATCH_CREATED] matchId=${matchId} player=${playerSessionId}`);

  return match;
}

// Tutorial bot constants
const TUTORIAL_BOT_NICKNAME = 'Тренер';

// Tutorial script: bot actions per round
// Round 1: Bot plays ATTACK (to show player how to defend)
// Round 2: Bot plays DEFENSE (to show player how to attack)
// Round 3: Bot plays HEAL (to show player how to counter)
const TUTORIAL_SCRIPT = {
  1: ['attack', null, null], // Round 1: Bot attacks
  2: ['defense', null, null], // Round 2: Bot defends
  3: ['heal', null, null] // Round 3: Bot heals
};

// Create Tutorial match (player vs scripted bot)
function createTutorialMatch(playerSocket) {
  const matchId = `tutorial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const playerSessionId = getSessionIdBySocket(playerSocket.id);
  if (!playerSessionId) {
    throw new Error('Cannot create Tutorial match: missing sessionId');
  }

  const playerAccountId = getAccountIdBySessionId(playerSessionId);
  if (!playerAccountId) {
    throw new Error('Cannot create Tutorial match: missing accountId');
  }

  // Tutorial is FREE - no token deduction
  const pot = 0; // No pot in Tutorial

  // Get player hand
  const playerHand = getHandForAccount(playerAccountId);
  if (playerHand.length !== 4) {
    console.error(`[INVARIANT_FAIL] code=HAND_SIZE_PLAYER handSize=${playerHand.length} expected=4`);
    throw new Error(`Invalid hand size for player: ${playerHand.length}, expected 4`);
  }

  // Create bot player data
  const botData = getPlayerData(BOT_SESSION_ID);
  botData.hp = START_HP;
  botData.confirmed = false;
  botData.layout = null;
  botData.draftLayout = null;
  botData.matchId = matchId;

  // Create player data
  const playerData = getPlayerData(playerSessionId);
  playerData.hp = START_HP;
  playerData.confirmed = false;
  playerData.layout = null;
  playerData.draftLayout = null;
  playerData.matchId = matchId;

  // Create match structure
  const match = {
    id: matchId,
    mode: 'TUTORIAL', // Tutorial mode
    sessions: [playerSessionId, BOT_SESSION_ID],
    socketIds: [playerSocket.id, null], // Bot has no socket
    player1: playerSocket.id,
    player2: null, // Bot has no socket
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
    // Card system
    hands: new Map(),
    // AFK tracking (disabled for tutorial)
    hadDraftThisRound: new Map(),
    afkStreakByPlayer: new Map(),
    bothAfkStreak: 0,
    // Invariant tracking
    finalizedRoundIndex: null,
    // Tutorial tracking
    tutorialScript: TUTORIAL_SCRIPT // Script for bot actions
  };

  // Store hands
  match.hands.set(playerSessionId, playerHand);
  match.hands.set(BOT_SESSION_ID, BOT_HAND);

  // Store match
  matchesById.set(matchId, match);
  matchIdBySocket.set(playerSocket.id, matchId);

  // Add player to Socket.IO room
  io.sockets.sockets.get(playerSocket.id)?.join(matchId);

  // Register bot session/account mappings (for compatibility)
  sessionIdBySocket.set('BOT_SOCKET', BOT_SESSION_ID);
  socketBySessionId.set(BOT_SESSION_ID, 'BOT_SOCKET');
  accountIdBySessionId.set(BOT_SESSION_ID, BOT_ACCOUNT_ID);

  console.log(`[TUTORIAL_MATCH_CREATED] matchId=${matchId} player=${playerSessionId}`);

  return match;
}

// Submit tutorial bot layout_draft (scripted, no randomness)
function submitTutorialBotDraft(match) {
  const botSessionId = BOT_SESSION_ID;
  const botData = getPlayerData(botSessionId);

  if (!botData) {
    console.error(`[TUTORIAL_BOT_ERROR] match=${match.id} botData not found`);
    return;
  }

  // Get scripted action for current round
  const scriptedLayout = match.tutorialScript[match.roundIndex];
  if (!scriptedLayout) {
    // Fallback: use first card from hand
    const botHand = match.hands.get(botSessionId) || [];
    scriptedLayout = [botHand[0] || 'attack', null, null];
    console.log(`[TUTORIAL_BOT_FALLBACK] match=${match.id} round=${match.roundIndex} using fallback layout`);
  }

  // Bot layout: [chosenCard, null, null] -> will be filled with GRASS in finalizeLayout
  const botLayout = [...scriptedLayout];

  // Validate bot layout against bot's hand
  const botHand = match.hands.get(botSessionId) || [];
  if (!validateCardsFromHand(botLayout, botHand)) {
    console.error(`[TUTORIAL_BOT_ERROR] match=${match.id} invalid layout=${JSON.stringify(botLayout)} hand=${JSON.stringify(botHand)}`);
    // Fallback: use first card from hand
    botLayout[0] = botHand[0] || 'attack';
  }

  // Save bot draft
  botData.draftLayout = [...botLayout];
  match.hadDraftThisRound.set(botSessionId, true);

  console.log(`[TUTORIAL_BOT_LAYOUT_SUBMITTED] match=${match.id} round=${match.roundIndex} scriptedLayout=${JSON.stringify(botLayout)}`);

  // Bot never confirms early - waits for deadline
}

// Bot decision logic (MVP)
function getBotCardChoice(match, botHp, opponentLastCard) {
  // Priority 1: If bot HP <= 4, use HEAL
  if (botHp <= 4) {
    return 'heal';
  }
  
  // Priority 2: If opponent last revealed ATTACK, use DEFENSE or COUNTER
  // opponentLastCard can be CardId ('attack') or CardType ('ATTACK') or null
  const opponentCardType = opponentLastCard ? (cardIdToType(opponentLastCard) || opponentLastCard) : null;
  if (opponentCardType === 'ATTACK') {
    // Randomly choose between defense and counter (50/50)
    return Math.random() < 0.5 ? 'defense' : 'counter';
  }
  
  // Priority 3: Default to ATTACK
  return 'attack';
}

// Submit bot layout_draft
function submitBotDraft(match) {
  const botSessionId = BOT_SESSION_ID;
  const botData = getPlayerData(botSessionId);
  
  if (!botData) {
    console.error(`[BOT_ERROR] match=${match.id} botData not found`);
    return;
  }
  
  // Determine player session (bot can be either session[0] or session[1])
  const isBotP1 = match.sessions[0] === BOT_SESSION_ID;
  const playerSessionId = isBotP1 ? match.sessions[1] : match.sessions[0];
  const playerData = getPlayerData(playerSessionId);
  
  // Get bot HP and opponent's last revealed card
  const botHp = botData.hp;
  const opponentLastCard = match.botLastOpponentCard;
  
  // Choose card using bot logic
  const chosenCard = getBotCardChoice(match, botHp, opponentLastCard);
  
  // Bot layout: [chosenCard, null, null] -> will be filled with GRASS in finalizeLayout
  const botLayout = [chosenCard, null, null];
  
  // Validate bot layout against bot's hand
  const botHand = match.hands.get(botSessionId) || [];
  if (!validateCardsFromHand(botLayout, botHand)) {
    console.error(`[BOT_ERROR] match=${match.id} invalid layout=${JSON.stringify(botLayout)} hand=${JSON.stringify(botHand)}`);
    // Fallback: use first card from hand
    botLayout[0] = botHand[0] || 'attack';
  }
  
  // Save bot draft
  botData.draftLayout = [...botLayout];
  match.hadDraftThisRound.set(botSessionId, true);
  
  console.log(`[BOT_LAYOUT_SUBMITTED] match=${match.id} round=${match.roundIndex} botHp=${botHp} opponentLastCard=${opponentLastCard || 'null'} chosenCard=${chosenCard} layout=${JSON.stringify(botLayout)}`);
  
  // Bot never confirms early - waits for deadline
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
  let data = players.get(sessionId);
  if (!data) {
    // Initialize player data if it doesn't exist (for bot or new players)
    data = {
      hp: START_HP,
      confirmed: false,
      layout: null,
      draftLayout: null,
      matchId: null
    };
    players.set(sessionId, data);
  }
  return data;
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
  // PvE: bot has no socket, only send to player
  const socket1 = match.socketIds[0] || match.player1;
  const socket2 = match.socketIds[1] || match.player2;
  
  // PvE/Tutorial mode: only send to player (bot has no socket)
  if (match.mode === 'PVE' || match.mode === 'TUTORIAL') {
    if (socket1) {
      const payload = payloadForSidFn(socket1);
      if (payload) {
        io.to(socket1).emit(event, payload);
      }
    }
    return;
  }
  
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

// Validate confirmed layout (must be 3 unique cards, no nulls)
// Note: CardId validation is done separately against player's hand
function validateLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== 3) return false;
  const unique = new Set(layout);
  if (unique.size !== 3) return false;
  // All must be non-null strings (will be validated against hand)
  return layout.every(card => card !== null && typeof card === 'string');
}

// Валидация draft layout (может содержать null)
// Note: CardId validation is done separately against player's hand
function validateDraftLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== 3) return false;
  // Allow null or any string (will be validated against hand)
  return layout.every(card => card === null || typeof card === 'string');
}

// Validate that all cards in layout are from player's hand
function validateCardsFromHand(layout, hand) {
  if (!Array.isArray(layout) || !Array.isArray(hand)) return false;
  
  // Count card usage (each card in hand can be used once per round)
  const handCount = new Map();
  hand.forEach(cardId => {
    handCount.set(cardId, (handCount.get(cardId) || 0) + 1);
  });
  
  const usedCount = new Map();
  for (const cardId of layout) {
    if (cardId === null) continue; // null is allowed
    
    // Check if cardId is valid
    if (!isValidCardId(cardId)) {
      return false; // Invalid card ID
    }
    
    // Check if card is in hand
    const available = handCount.get(cardId) || 0;
    const used = usedCount.get(cardId) || 0;
    if (used >= available) {
      return false; // Card used more times than available in hand
    }
    
    usedCount.set(cardId, used + 1);
  }
  
  return true;
}

// Финализация layout по правилам MVP:
// 1. Если есть confirmedLayout → используем его
// 2. Если есть draftLayout с реальными картами → заполняем null => GRASS
// 3. Иначе (нет draft или draft полностью пустой) → [GRASS, GRASS, GRASS] (AFK)
function finalizeLayout(confirmedLayout, draftLayout) {
  // Если есть confirmed layout - используем его
  if (confirmedLayout && Array.isArray(confirmedLayout) && confirmedLayout.length === 3) {
    return confirmedLayout;
  }
  
  // Если есть draft с реальными картами - заполняем null => GRASS
  if (draftLayout && Array.isArray(draftLayout) && draftLayout.length === 3) {
    // Check if any card is a valid CardId (not null, not GRASS)
    const hasRealCard = draftLayout.some(card => card !== null && isValidCardId(card));
    if (hasRealCard) {
      // Partial Play: заполняем null => GRASS
      return draftLayout.map(card => card === null ? GRASS : card);
    }
  }
  
  // AFK: нет draft или draft полностью пустой → все GRASS
  return [GRASS, GRASS, GRASS];
}

// ЕДИНАЯ ФУНКЦИЯ ФИНАЛИЗАЦИИ РАУНДА - вызывается РОВНО 1 раз на раунд по дедлайну PREP
// Делает весь порядок: финализация layout, определение AFK, обновление streaks, проверка end conditions
function finalizeRound(match) {
  // INVARIANT: finalizeRound single-run - не может выполниться 2 раза для одного roundIndex
  if (match.finalizedRoundIndex === match.roundIndex) {
    assertInvariant(match, false, 'FINALIZE_ROUND_DOUBLE', { finalizedRoundIndex: match.finalizedRoundIndex, currentRoundIndex: match.roundIndex });
    return false; // Уже финализирован этот раунд
  }
  
  // INVARIANT: match state must be 'prep'
  if (!assertInvariant(match, match.state === 'prep', 'FINALIZE_ROUND_WRONG_STATE', { state: match.state })) {
    return false;
  }
  
  const sid1 = match.sessions[0];
  const sid2 = match.sessions[1];
  const p1Data = getPlayerData(sid1);
  const p2Data = getPlayerData(sid2);
  
  if (!p1Data || !p2Data) {
    console.error(`[FINALIZE_ROUND_ERROR] match=${match.id} missing player data`);
    return false; // Данные не готовы
  }
  
  // INVARIANT: pot sanity
  if (!assertInvariant(match, match.pot >= 0, 'POT_NEGATIVE', { pot: match.pot })) {
    return false;
  }
  
  // (1) Финализируем layouts для обоих игроков
  if (!p1Data.layout) {
    const finalized = finalizeLayout(p1Data.layout, p1Data.draftLayout);
    p1Data.layout = finalized;
    p1Data.confirmed = true;
  }
  if (!p2Data.layout) {
    const finalized = finalizeLayout(p2Data.layout, p2Data.draftLayout);
    p2Data.layout = finalized;
    p2Data.confirmed = true;
  }
  
  // (2) Определяем hadDraftThisRound и isAfkThisRound
  const hadDraft1 = match.hadDraftThisRound.get(sid1) === true;
  const hadDraft2 = match.hadDraftThisRound.get(sid2) === true;
  // BOT is NEVER considered AFK
  // TUTORIAL mode: AFK logic disabled (player can take as long as needed)
  const isAfk1 = (match.mode === 'TUTORIAL' || sid1 === BOT_SESSION_ID) ? false : !hadDraft1; // Источник правды: hadDraft === false
  const isAfk2 = (match.mode === 'TUTORIAL' || sid2 === BOT_SESSION_ID) ? false : !hadDraft2;
  
  // (3) Обновляем AFK streaks
  const currentStreak1 = match.afkStreakByPlayer.get(sid1) || 0;
  const currentStreak2 = match.afkStreakByPlayer.get(sid2) || 0;
  
  if (isAfk1) {
    match.afkStreakByPlayer.set(sid1, currentStreak1 + 1);
  } else {
    match.afkStreakByPlayer.set(sid1, 0);
  }
  
  if (isAfk2) {
    match.afkStreakByPlayer.set(sid2, currentStreak2 + 1);
  } else {
    match.afkStreakByPlayer.set(sid2, 0);
  }
  
  const newStreak1 = match.afkStreakByPlayer.get(sid1);
  const newStreak2 = match.afkStreakByPlayer.get(sid2);
  
  // Обновляем bothAfkStreak (BOT never counts as AFK, so bothAfkStreak only grows if both are real players and both AFK)
  if (isAfk1 && isAfk2 && sid1 !== BOT_SESSION_ID && sid2 !== BOT_SESSION_ID) {
    match.bothAfkStreak = (match.bothAfkStreak || 0) + 1;
  } else {
    match.bothAfkStreak = 0;
  }
  
  // (4) Структурное логирование
  const decision = (() => {
    if (match.bothAfkStreak >= 2) return 'endMatch_timeout_both';
    if (newStreak1 >= 2) return 'endMatch_afk_p1';
    if (newStreak2 >= 2) return 'endMatch_afk_p2';
    return 'continue';
  })();
  
  logFinalizeRound(match, {
    p1_hadDraft: hadDraft1,
    p1_afk: isAfk1,
    p1_streak: newStreak1,
    p2_hadDraft: hadDraft2,
    p2_afk: isAfk2,
    p2_streak: newStreak2,
    bothAfkStreak: match.bothAfkStreak,
    decision: decision
  });
  
  // (5) Проверка условий завершения матча СТРОГО в этом порядке
  // GUARD: проверяем инварианты перед завершением
  if (match.bothAfkStreak >= 2) {
    // INVARIANT: AFK canon - reason="timeout" only if bothAfkStreak >= 2 and isAfkA && isAfkB
    if (!assertInvariant(match, isAfk1 && isAfk2, 'AFK_CANON_BOTH', { bothAfkStreak: match.bothAfkStreak, isAfk1, isAfk2 })) {
      return false;
    }
    // Оба AFK 2 раунда подряд -> pot burn, оба поражение
    logFinalizeRoundDecision(match, 'endMatch', 'timeout_both');
    endMatchBothAfk(match);
    match.finalizedRoundIndex = match.roundIndex; // Отмечаем что раунд финализирован
    return true; // Матч завершён
  } else if (newStreak1 >= 2) {
    // INVARIANT: AFK canon - reason="afk" only if loser.afkStreak >= 2
    if (!assertInvariant(match, isAfk1, 'AFK_CANON_P1', { streak1: newStreak1, isAfk1 })) {
      return false;
    }
    // Игрок 1 AFK 2 раунда -> игрок 2 выиграл
    logFinalizeRoundDecision(match, 'endMatch', 'afk_p1');
    endMatchForfeit(match, sid1, sid2, 'timeout'); // Используем 'timeout' для совместимости с клиентом
    match.finalizedRoundIndex = match.roundIndex; // Отмечаем что раунд финализирован
    return true; // Матч завершён
  } else if (newStreak2 >= 2) {
    // INVARIANT: AFK canon - reason="afk" only if loser.afkStreak >= 2
    if (!assertInvariant(match, isAfk2, 'AFK_CANON_P2', { streak2: newStreak2, isAfk2 })) {
      return false;
    }
    // Игрок 2 AFK 2 раунда -> игрок 1 выиграл
    logFinalizeRoundDecision(match, 'endMatch', 'afk_p2');
    endMatchForfeit(match, sid2, sid1, 'timeout'); // Используем 'timeout' для совместимости с клиентом
    match.finalizedRoundIndex = match.roundIndex; // Отмечаем что раунд финализирован
    return true; // Матч завершён
  }
  
  // Матч продолжается
  match.finalizedRoundIndex = match.roundIndex; // Отмечаем что раунд финализирован
  return false;
}

// Завершение матча когда оба игрока AFK 2 раунда подряд
function endMatchBothAfk(match) {
  // INVARIANT: endMatch idempotent
  if (!assertInvariant(match, match.state !== 'ended', 'ENDMATCH_IDEMPOTENT', { currentState: match.state, reason: 'both_afk' })) {
    return; // Матч уже завершён, игнорируем
  }
  
  // INVARIANT: AFK canon - bothAfkStreak >= 2
  if (!assertInvariant(match, match.bothAfkStreak >= 2, 'AFK_CANON_BOTH_STREAK', { bothAfkStreak: match.bothAfkStreak })) {
    return; // Не завершаем если guard не прошёл
  }
  
  logStateTransition(match, match.state, 'ended', 'both_afk');
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
  
  // Очистка grace timers
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
  
  const p1Hp = p1Data ? p1Data.hp : START_HP;
  const p2Hp = p2Data ? p2Data.hp : START_HP;
  
  // Pot сгорает - никто не получает токены
  log(`[END_BOTH_AFK] match=${match.id} pot=${match.pot} burned`);
  
  // Получаем токены по accountId для отправки
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  
  // Получаем nickname для обоих игроков
  const acc1Nickname = acc1AccountId ? (db.getNickname(acc1AccountId) || null) : null;
  const acc2Nickname = acc2AccountId ? (db.getNickname(acc2AccountId) || null) : null;
  
  // Отправляем match_end обоим игрокам (оба проиграли)
  emitToBoth(match, 'match_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    const accountId = getAccountIdBySessionId(sessionId);
    const tokens = accountId ? (db.getTokens(accountId) !== null ? db.getTokens(accountId) : START_TOKENS) : START_TOKENS;
    
    return {
      matchId: match.id,
      winner: 'OPPONENT', // Оба проиграли, но нужно указать OPPONENT для UI
      winnerId: null, // Нет победителя
      loserId: null, // Оба проиграли
      yourHp: sessionId === match.sessions[0] ? p1Hp : p2Hp,
      oppHp: sessionId === match.sessions[0] ? p2Hp : p1Hp,
      yourTokens: tokens,
      reason: 'timeout',
      yourNickname: sessionId === match.sessions[0] ? acc1Nickname : acc2Nickname,
      oppNickname: sessionId === match.sessions[0] ? acc2Nickname : acc1Nickname
    };
  });
  
  logMatchEnd(match, 'timeout', null, null); // Both lose, no winner
  
  // Очистка player data
  p1Data.matchId = null;
  p1Data.confirmed = false;
  p1Data.layout = null;
  p1Data.draftLayout = null;
  p1Data.hp = START_HP;
  
  p2Data.matchId = null;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.draftLayout = null;
  p2Data.hp = START_HP;
  
  // Удаляем матч из хранилищ
  matchesById.delete(match.id);
  matchIdBySocket.delete(match.player1);
  matchIdBySocket.delete(match.player2);
}

// Battle engine: applies step logic
// Input: CardId or GRASS (converts CardId to CardType internally)
// Output: updated HP
function applyStepLogic(player1Card, player2Card, player1Hp, player2Hp) {
  let newP1Hp = player1Hp;
  let newP2Hp = player2Hp;

  // Convert CardId to CardType for battle engine (backward compatibility)
  // If already CardType (legacy), keep as is
  const p1Type = player1Card === GRASS ? GRASS : (cardIdToType(player1Card) || player1Card);
  const p2Type = player2Card === GRASS ? GRASS : (cardIdToType(player2Card) || player2Card);

  // GRASS не делает ничего сам по себе - но не блокирует атаки
  // Если оба GRASS - ничего не происходит
  if (p1Type === GRASS && p2Type === GRASS) {
    return { p1Hp: newP1Hp, p2Hp: newP2Hp };
  }

  // (1) HEAL всегда +1 HP (только если не GRASS)
  if (p1Type === 'HEAL') {
    newP1Hp = Math.min(newP1Hp + 1, MAX_HP);
  }
  if (p2Type === 'HEAL') {
    newP2Hp = Math.min(newP2Hp + 1, MAX_HP);
  }

  // (2) Attack/Defense/Counter логика
  // ATTACK vs DEFENSE -> 0 урона (defense блокирует)
  // ATTACK vs ATTACK -> оба -2
  // ATTACK vs COUNTER -> атакующий -2 (защищающийся НЕ получает урон от ATTACK)
  // ATTACK vs HEAL -> защищающийся -2 (heal не блокирует)
  // ATTACK vs GRASS -> защищающийся -2 (GRASS не блокирует, это пустой слот)
  // DEFENSE сам по себе ничего не делает
  // COUNTER сам по себе ничего не делает

  // Обработка player1Card === 'ATTACK'
  if (p1Type === 'ATTACK') {
    if (p2Type === 'DEFENSE') {
      // DEFENSE блокирует атаку - 0 урона
    } else if (p2Type === 'ATTACK') {
      // ATTACK vs ATTACK -> оба получают урон
      newP1Hp = Math.max(0, newP1Hp - 2);
      newP2Hp = Math.max(0, newP2Hp - 2);
    } else if (p2Type === 'COUNTER') {
      // COUNTER отражает атаку - только атакующий получает урон
      newP1Hp = Math.max(0, newP1Hp - 2);
    } else {
      // ATTACK vs HEAL или GRASS -> защищающийся получает урон
      // GRASS не блокирует, это эквивалент "нет защиты"
      newP2Hp = Math.max(0, newP2Hp - 2);
    }
  }

  // Обработка player2Card === 'ATTACK' (только если player1Card !== 'ATTACK', чтобы не дублировать)
  if (p2Type === 'ATTACK' && p1Type !== 'ATTACK') {
    if (p1Type === 'DEFENSE') {
      // DEFENSE блокирует атаку - 0 урона
    } else if (p1Type === 'COUNTER') {
      // COUNTER отражает атаку - только атакующий получает урон
      newP2Hp = Math.max(0, newP2Hp - 2);
    } else {
      // ATTACK vs HEAL или GRASS -> защищающийся получает урон
      // GRASS не блокирует, это эквивалент "нет защиты"
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
        // В prep: watchdog НЕ должен завершать матч по AFK
        // prepTimer сам вызовет finalizeRound который проверит AFK правила
        // Watchdog только для disconnect/timeout в playing
        log(`[WATCHDOG] state=prep - prepTimer will handle finalizeRound, not ending match here`);
        return; // Не завершаем матч из watchdog в prep
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
        // Не можем определить loser в playing - просто логируем
        log(`[WATCHDOG] state=playing no clear loser, match may be stuck`);
      }
    }
  }, PLAY_STEP_TIMEOUT_MS);
  
  log(`[WATCHDOG_START] match=${match.id} timeout=${PLAY_STEP_TIMEOUT_MS}ms`);
  
  const p1Data = getPlayerData(match.sessions[0]);
  const p2Data = getPlayerData(match.sessions[1]);
  
  // Финализируем раунд (если layouts ещё не финализированы)
  // Это может быть если startPlay вызван до prepTimer (оба confirmed раньше дедлайна)
  if (!p1Data.layout || !p2Data.layout) {
    const matchEnded = finalizeRound(match);
    if (matchEnded) {
      log(`[START_PLAY] match=${match.id} ended due to AFK rules in finalizeRound`);
      return; // Матч завершён, не запускаем playRound
    }
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
  
  // INVARIANT: HP sanity - HP в разумных границах (0..MAX_HP)
  if (!assertInvariant(match, result.p1Hp >= 0 && result.p1Hp <= MAX_HP, 'HP_SANITY_P1', { hp: result.p1Hp, maxHp: MAX_HP })) {
    result.p1Hp = Math.max(0, Math.min(MAX_HP, result.p1Hp)); // Clamp to valid range
  }
  if (!assertInvariant(match, result.p2Hp >= 0 && result.p2Hp <= MAX_HP, 'HP_SANITY_P2', { hp: result.p2Hp, maxHp: MAX_HP })) {
    result.p2Hp = Math.max(0, Math.min(MAX_HP, result.p2Hp)); // Clamp to valid range
  }
  
  p1Data.hp = result.p1Hp;
  p2Data.hp = result.p2Hp;

  // PvE: Save opponent's last revealed card for bot decision (use first card of step 0, or last non-GRASS card)
  if (match.mode === 'PVE') {
    // Determine which is bot and which is player
    const isBotP1 = match.sessions[0] === BOT_SESSION_ID;
    const opponentCard = isBotP1 ? p1Card : p2Card;
    // Save opponent's card (for bot's next round decision)
    if (stepIndex === 0 || (opponentCard !== null && opponentCard !== GRASS)) {
      match.botLastOpponentCard = opponentCard;
      console.log(`[BOT_MOVE] match=${match.id} round=${match.roundIndex} step=${stepIndex} opponentCard=${opponentCard} saved for next round`);
    }
  }

  // Получаем nickname для обоих игроков
  const p1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const p2AccountId = getAccountIdBySessionId(match.sessions[1]);
  // PvE/Tutorial: bot has fixed nickname
  const p1Nickname = p1AccountId === BOT_ACCOUNT_ID 
    ? (match.mode === 'TUTORIAL' ? TUTORIAL_BOT_NICKNAME : BOT_NICKNAME)
    : (p1AccountId ? (db.getNickname(p1AccountId) || null) : null);
  const p2Nickname = p2AccountId === BOT_ACCOUNT_ID 
    ? (match.mode === 'TUTORIAL' ? TUTORIAL_BOT_NICKNAME : BOT_NICKNAME)
    : (p2AccountId ? (db.getNickname(p2AccountId) || null) : null);

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
        oppHp: p2Data.hp,
        yourNickname: p1Nickname,
        oppNickname: p2Nickname
      };
    } else {
      return {
        matchId: match.id,
        roundIndex: match.roundIndex,
        stepIndex: stepIndex,
        yourCard: p2Card,
        oppCard: p1Card,
        yourHp: p2Data.hp,
        oppHp: p1Data.hp,
        yourNickname: p2Nickname,
        oppNickname: p1Nickname
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
  
  // Получаем nickname для обоих игроков
  const p1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const p2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const p1Nickname = p1AccountId ? (db.getNickname(p1AccountId) || null) : null;
  const p2Nickname = p2AccountId ? (db.getNickname(p2AccountId) || null) : null;

  emitToBoth(match, 'round_end', (socketId) => {
    const sessionId = getSessionIdBySocket(socketId);
    if (sessionId === match.sessions[0]) {
      return {
        matchId: match.id,
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        yourHp: p1Data.hp,
        oppHp: p2Data.hp,
        yourNickname: p1Nickname,
        oppNickname: p2Nickname
      };
    } else {
      return {
        matchId: match.id,
        roundIndex: match.roundIndex,
        suddenDeath: match.suddenDeath,
        yourHp: p2Data.hp,
        oppHp: p1Data.hp,
        yourNickname: p2Nickname,
        oppNickname: p1Nickname
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
  
  // Сбрасываем finalizedRoundIndex для нового раунда
  match.finalizedRoundIndex = null;
  
  // Логируем переход состояния
  logStateTransition(match, 'playing', 'prep', 'round_start');
  
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
  p1Data.draftLayout = null;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.draftLayout = null;
  
  // Сбрасываем hadDraftThisRound для нового раунда
  match.hadDraftThisRound.set(match.sessions[0], false);
  match.hadDraftThisRound.set(match.sessions[1], false);
  
  // PvE/Tutorial: Submit bot draft immediately after prep starts
  if (match.mode === 'PVE') {
    // Bot always submits draft (never AFK)
    submitBotDraft(match);
  } else if (match.mode === 'TUTORIAL') {
    // Tutorial bot submits scripted draft (never AFK)
    submitTutorialBotDraft(match);
  }

  const deadlineTs = Date.now() + PREP_TIME_MS;
  match.prepDeadline = deadlineTs;

  log(`[${match.id}] prep_start: round=${match.roundIndex}, suddenDeath=${match.suddenDeath}, p1Hp=${p1Data.hp}, p2Hp=${p2Data.hp}`);

  // Получаем nickname для обоих игроков
  const p1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const p2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const p1Nickname = p1AccountId ? (db.getNickname(p1AccountId) || null) : null;
  const p2Nickname = p2AccountId ? (db.getNickname(p2AccountId) || null) : null;

  // Get hands from match
  const p1Hand = match.hands.get(match.sessions[0]) || [];
  const p2Hand = match.hands.get(match.sessions[1]) || [];
  
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
        yourHand: p1Hand, // CardId[4] - source of truth (replaces legacy 'cards')
        yourNickname: p1Nickname,
        oppNickname: p2Nickname
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
        yourHand: p2Hand, // CardId[4] - source of truth (replaces legacy 'cards')
        yourNickname: p2Nickname,
        oppNickname: p1Nickname
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
    
    // ЕДИНАЯ ФИНАЛИЗАЦИЯ РАУНДА - вызывается РОВНО 1 раз по дедлайну PREP
    // finalizeRound делает всё: финализацию layout, определение AFK, обновление streaks, проверку end conditions
    const matchEnded = finalizeRound(currentMatch);
    if (matchEnded) {
      log(`[PREP_TIMEOUT] match=${currentMatch.id} ended due to AFK rules in finalizeRound`);
      return; // Матч завершён, не запускаем playRound
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
  
  // INVARIANT: endMatch idempotent
  if (!assertInvariant(match, match.state !== 'ended', 'ENDMATCH_IDEMPOTENT', { currentState: match.state, reason })) {
    return; // Матч уже завершён, игнорируем
  }
  
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

  // PvE: No rewards (pot = 0, no tokens added)
  // PvP: WinnerAccountId получает +match.pot (по accountId, не sessionId)
  if (match.mode === 'PVP' && match.pot > 0) {
    const winnerAccountId = getAccountIdBySessionId(winnerSessionId);
    if (winnerAccountId && winnerAccountId !== BOT_ACCOUNT_ID) {
      db.addTokens(winnerAccountId, match.pot);
    }
  }

  // Лог в endMatch
  logMatchEnd(match, reason, winnerSessionId, loserSessionId);
  
  // Получаем токены по accountId для отправки
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  log(`[TOKENS] end winner=${winnerSessionId} acc1tokens=${acc1Tokens} acc2tokens=${acc2Tokens}`);

  // Получаем nickname для обоих игроков
  const acc1Nickname = acc1AccountId ? (db.getNickname(acc1AccountId) || null) : null;
  const acc2Nickname = acc2AccountId ? (db.getNickname(acc2AccountId) || null) : null;

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
      reason: finalReason,
      yourNickname: sessionId === match.sessions[0] ? acc1Nickname : acc2Nickname,
      oppNickname: sessionId === match.sessions[0] ? acc2Nickname : acc1Nickname
    };
  });
  
  // Already logged by logMatchEnd above

  // Очистка: не удаляем players, только сбрасываем matchId/layout/confirmed, hp оставляем
  p1Data.matchId = null;
  p1Data.confirmed = false;
  p1Data.layout = null;
  p1Data.draftLayout = null;
  p1Data.hp = START_HP; // Сбрасываем HP на 10 после матча

  p2Data.matchId = null;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.draftLayout = null;
  p2Data.hp = START_HP; // Сбрасываем HP на 10 после матча

  // Удаляем матч из хранилищ
  matchesById.delete(match.id);
  matchIdBySocket.delete(match.player1);
  matchIdBySocket.delete(match.player2);
  
  // Socket.IO автоматически очистит room при disconnect всех участников
  // Но можно явно покинуть room если нужно
  // io.socketsLeave(match.id);
}

function endMatch(match, reason = 'normal') {
  // INVARIANT: endMatch idempotent
  if (!assertInvariant(match, match.state !== 'ended', 'ENDMATCH_IDEMPOTENT', { currentState: match.state, reason })) {
    return; // Матч уже завершён, игнорируем
  }
  
  logStateTransition(match, match.state, 'ended', reason);
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

  // Вычисляем winnerSessionId и loserSessionId ДО использования
  // (у кого hp больше, либо у кого hp >0 если второй умер)
  let winnerSessionId = null;
  let loserSessionId = null;
  
  if (p1Data.hp > p2Data.hp || (p1Data.hp > 0 && p2Data.hp === 0)) {
    winnerSessionId = match.sessions[0];
    loserSessionId = match.sessions[1];
  } else if (p2Data.hp > p1Data.hp || (p2Data.hp > 0 && p1Data.hp === 0)) {
    winnerSessionId = match.sessions[1];
    loserSessionId = match.sessions[0];
  } else {
    // Tie (shouldn't happen in normal flow, but handle gracefully)
    // In case of tie, use first session as winner (arbitrary)
    winnerSessionId = match.sessions[0];
    loserSessionId = match.sessions[1];
    log(`[ENDMATCH_TIE] match=${match.id} p1Hp=${p1Data.hp} p2Hp=${p2Data.hp} using sessions[0] as winner`);
  }

  // PvE: No rewards (pot = 0, no tokens added)
  // PvP: WinnerAccountId получает +match.pot (по accountId, не sessionId)
  if (match.mode === 'PVP' && match.pot > 0) {
    const winnerAccountId = getAccountIdBySessionId(winnerSessionId);
    if (winnerAccountId && winnerAccountId !== BOT_ACCOUNT_ID) {
      db.addTokens(winnerAccountId, match.pot);
    }
  }

  // Структурированный лог (теперь winnerSessionId и loserSessionId уже определены)
  logMatchEnd(match, reason, winnerSessionId, loserSessionId);
  
  // Получаем токены по accountId для отправки
  const acc1AccountId = getAccountIdBySessionId(match.sessions[0]);
  const acc2AccountId = getAccountIdBySessionId(match.sessions[1]);
  const acc1Tokens = acc1AccountId ? db.getTokens(acc1AccountId) : START_TOKENS;
  const acc2Tokens = acc2AccountId ? db.getTokens(acc2AccountId) : START_TOKENS;
  log(`[TOKENS] end winner=${winnerSessionId} acc1tokens=${acc1Tokens} acc2tokens=${acc2Tokens}`);

  // Получаем nickname для обоих игроков
  const acc1Nickname = acc1AccountId ? (db.getNickname(acc1AccountId) || null) : null;
  const acc2Nickname = acc2AccountId ? (db.getNickname(acc2AccountId) || null) : null;

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
      winner: isWinner ? 'YOU' : 'OPPONENT',
      winnerId: winnerSessionId,
      loserId: loserSessionId,
      yourHp: sessionId === match.sessions[0] ? p1Data.hp : p2Data.hp,
      oppHp: sessionId === match.sessions[0] ? p2Data.hp : p1Data.hp,
      yourTokens: tokens,
      reason: finalReason,
      yourNickname: sessionId === match.sessions[0] ? acc1Nickname : acc2Nickname,
      oppNickname: sessionId === match.sessions[0] ? acc2Nickname : acc1Nickname
    };
  });
  
  // Already logged by logMatchEnd above

  // Очистка: не удаляем players, только сбрасываем matchId/layout/confirmed, hp оставляем
  p1Data.matchId = null;
  p1Data.confirmed = false;
  p1Data.layout = null;
  p1Data.draftLayout = null;
  p1Data.hp = START_HP; // Сбрасываем HP на 10 после матча

  p2Data.matchId = null;
  p2Data.confirmed = false;
  p2Data.layout = null;
  p2Data.draftLayout = null;
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
        draftLayout: null,
        matchId: null
      };
      players.set(sessionId, playerData);
    }
    
    // Получаем токены по accountId из SQLite
    const tokens = db.getTokens(accountId);
    
    // Получаем nickname
    const nickname = db.getNickname(accountId);
    
    // Получаем tutorialCompleted (безопасно, с fallback)
    let tutorialCompleted = false;
    try {
      tutorialCompleted = db.getTutorialCompleted(accountId);
    } catch (e) {
      // Fallback: если ошибка - используем false (не блокируем логин)
      console.error(`[HELLO_ERROR] getTutorialCompleted accountId=${accountId} error=${e.message}`);
      tutorialCompleted = false;
    }

    // Отправляем hello_ok с токенами, nickname и tutorialCompleted
    socket.emit('hello_ok', {
      tokens: tokens !== null ? tokens : START_TOKENS,
      nickname: nickname || null,
      tutorialCompleted: tutorialCompleted
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

        // Получаем nickname для обоих игроков
        const acc1Nickname = acc1AccountId ? (db.getNickname(acc1AccountId) || null) : null;
        const acc2Nickname = acc2AccountId ? (db.getNickname(acc2AccountId) || null) : null;

        // Get hands from match
        const p1Hand = match.hands.get(s1SessionId) || [];
        const p2Hand = match.hands.get(s2SessionId) || [];
        
        // Отправляем match_found с токенами, pot, nickname и hand
        player1Socket.emit('match_found', {
          matchId: match.id,
          yourHp: p1Data.hp,
          oppHp: p2Data.hp,
          yourTokens: acc1Tokens,
          pot: match.pot,
          yourNickname: acc1Nickname,
          oppNickname: acc2Nickname,
          yourHand: p1Hand // CardId[4] - source of truth
        });

        player2Socket.emit('match_found', {
          matchId: match.id,
          yourHp: p2Data.hp,
          oppHp: p1Data.hp,
          yourTokens: acc2Tokens,
          pot: match.pot,
          yourNickname: acc2Nickname,
          oppNickname: acc1Nickname,
          yourHand: p2Hand // CardId[4] - source of truth
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

  // PvE Training Match - Create match vs bot (FREE, no tokens)
  socket.on('pve_start', () => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      socket.emit('error_msg', { message: 'Please send hello first' });
      return;
    }
    
    if (matchIdBySocket.has(socket.id)) {
      socket.emit('error_msg', { message: 'Already in a match' });
      return;
    }
    
    const accountId = getAccountIdBySessionId(sessionId);
    if (!accountId) {
      socket.emit('error_msg', { message: 'Missing accountId' });
      return;
    }
    
    try {
      // Create PvE match (FREE - no token deduction)
      const match = createPvEMatch(socket);
      
      const playerData = getPlayerData(sessionId);
      const botData = getPlayerData(BOT_SESSION_ID);
      
      const playerAccountId = getAccountIdBySessionId(sessionId);
      const playerTokens = playerAccountId ? (db.getTokens(playerAccountId) !== null ? db.getTokens(playerAccountId) : START_TOKENS) : START_TOKENS;
      
      // Get hands
      const playerHand = match.hands.get(sessionId) || [];
      const botHand = match.hands.get(BOT_SESSION_ID) || [];
      
      // Get nicknames
      const playerNickname = playerAccountId ? (db.getNickname(playerAccountId) || null) : null;
      
      console.log(`[PVE_MATCH_CREATED] matchId=${match.id} player=${sessionId}`);
      
      // Send match_found to player (bot doesn't receive events)
      socket.emit('match_found', {
        matchId: match.id,
        yourHp: playerData.hp,
        oppHp: botData.hp,
        yourTokens: playerTokens,
        pot: match.pot, // 0 for PvE
        yourNickname: playerNickname,
        oppNickname: BOT_NICKNAME,
        yourHand: playerHand
      });
      
      // Start first round
      startPrepPhase(match);
    } catch (error) {
      console.error(`[PVE_START_ERROR] sessionId=${sessionId} error=${error.message}`);
      socket.emit('error_msg', { message: `Failed to start PvE match: ${error.message}` });
    }
  });

  // Tutorial Match - Create scripted tutorial match (FREE, no tokens)
  socket.on('tutorial_start', () => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      socket.emit('error_msg', { message: 'Please send hello first' });
      return;
    }

    if (matchIdBySocket.has(socket.id)) {
      socket.emit('error_msg', { message: 'Already in a match' });
      return;
    }

    const accountId = getAccountIdBySessionId(sessionId);
    if (!accountId) {
      socket.emit('error_msg', { message: 'Missing accountId' });
      return;
    }

    try {
      // Create Tutorial match (FREE - no token deduction)
      const match = createTutorialMatch(socket);

      const playerData = getPlayerData(sessionId);
      const botData = getPlayerData(BOT_SESSION_ID);

      const playerAccountId = getAccountIdBySessionId(sessionId);
      const playerTokens = playerAccountId ? (db.getTokens(playerAccountId) !== null ? db.getTokens(playerAccountId) : START_TOKENS) : START_TOKENS;

      // Get hands
      const playerHand = match.hands.get(sessionId) || [];
      const botHand = match.hands.get(BOT_SESSION_ID) || [];

      // Get nicknames
      const playerNickname = playerAccountId ? (db.getNickname(playerAccountId) || null) : null;

      console.log(`[TUTORIAL_MATCH_CREATED] matchId=${match.id} player=${sessionId}`);

      // Send match_found to player (bot doesn't receive events)
      socket.emit('match_found', {
        matchId: match.id,
        yourHp: playerData.hp,
        oppHp: botData.hp,
        yourTokens: playerTokens,
        pot: match.pot, // 0 for Tutorial
        yourNickname: playerNickname,
        oppNickname: TUTORIAL_BOT_NICKNAME,
        yourHand: playerHand
      });

      // Start first round
      startPrepPhase(match);
    } catch (error) {
      console.error(`[TUTORIAL_START_ERROR] sessionId=${sessionId} error=${error.message}`);
      socket.emit('error_msg', { message: `Failed to start Tutorial: ${error.message}` });
    }
  });

  socket.on('layout_draft', (data) => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      return;
    }
    
    const match = getMatch(socket.id);
    // INVARIANT: phase correctness - layout_draft only in PREP
    if (!match) {
      return;
    }
    if (!assertInvariant(match, match.state === 'prep', 'PHASE_DRAFT', { state: match.state, event: 'layout_draft' })) {
      log(`[IGNORED_DRAFT] sid=${socket.id} sessionId=${sessionId} reason=wrong_state`);
      return;
    }

    // Игнорируем draft если уже confirmed
    const playerData = getPlayerData(sessionId);
    if (!playerData || playerData.confirmed) {
      log(`[IGNORED_DRAFT] sid=${socket.id} sessionId=${sessionId} reason=already_confirmed`);
      return;
    }

    // Валидация matchId
    if (data.matchId && data.matchId !== match.id) {
      log(`[IGNORED_DRAFT] sid=${socket.id} sessionId=${sessionId} reason=matchId_mismatch`);
      return;
    }

    // Валидация draft layout (может содержать null)
    if (!validateDraftLayout(data.layout)) {
      log(`[IGNORED_DRAFT] sid=${match.id} sessionId=${sessionId} reason=invalid_layout`);
      return;
    }

    // Валидация: все карты должны быть из hand игрока
    const playerHand = match.hands.get(sessionId) || [];
    if (!validateCardsFromHand(data.layout, playerHand)) {
      console.error(`[INVALID_CARD_FROM_CLIENT] match=${match.id} sessionId=${sessionId} layout=${JSON.stringify(data.layout)} hand=${JSON.stringify(playerHand)}`);
      // Ignore invalid cards (replace with null) - don't crash, but log error
      data.layout = data.layout.map(cardId => {
        if (cardId === null) return null;
        if (!isValidCardId(cardId) || !playerHand.includes(cardId)) {
          return null; // Replace invalid card with null
        }
        return cardId;
      });
      log(`[DRAFT_FIXED] match=${match.id} sessionId=${sessionId} fixed_layout=${JSON.stringify(data.layout)}`);
    }

    // Сохраняем draft layout (не финализируем до prepTimer или confirm)
    playerData.draftLayout = [...data.layout];
    
    // Отмечаем что игрок отправил draft в этом раунде (источник правды для AFK)
    match.hadDraftThisRound.set(sessionId, true);
    
    log(`[DRAFT] match=${match.id} sessionId=${sessionId} draft=${JSON.stringify(playerData.draftLayout)}`);
  });

  socket.on('layout_confirm', (data) => {
    const sessionId = getSessionIdBySocket(socket.id);
    if (!sessionId) {
      return;
    }

    const match = getMatch(socket.id);
    // INVARIANT: phase correctness - layout_confirm only in PREP
    if (!match) {
      return;
    }
    if (!assertInvariant(match, match.state === 'prep', 'PHASE_CONFIRM', { state: match.state, event: 'layout_confirm' })) {
      log(`[IGNORED_CONFIRM] sid=${socket.id} sessionId=${sessionId} reason=wrong_state`);
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
      log(`[IGNORED_CONFIRM] match=${match.id} sessionId=${sessionId} reason=invalid_layout`);
      return; // Игнорируем молча
    }

    // Валидация: все карты должны быть из hand игрока
    const playerHand = match.hands.get(sessionId) || [];
    if (!validateCardsFromHand(data.layout, playerHand)) {
      console.error(`[INVALID_CARD_FROM_CLIENT] match=${match.id} sessionId=${sessionId} layout=${JSON.stringify(data.layout)} hand=${JSON.stringify(playerHand)}`);
      // Reject confirm if cards are invalid (don't accept invalid layout)
      socket.emit('error_msg', { message: 'Invalid cards: cards must be from your hand' });
      log(`[IGNORED_CONFIRM] match=${match.id} sessionId=${sessionId} reason=invalid_cards_from_hand`);
      return;
    }

    playerData.confirmed = true;
    playerData.layout = data.layout;
    
    // Если игрок подтвердил layout, значит он точно отправлял draft (hadDraft = true)
    // Это защита от edge case когда confirm пришёл без предварительного draft
    match.hadDraftThisRound.set(sessionId, true);

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

app.post('/auth/telegram', (req, res) => {
  console.log('[auth/telegram] request received');
  
  try {
    const { initData } = req.body;
    
    if (!initData) {
      console.log('[auth/telegram] missing initData');
      return res.status(400).json({ 
        error: 'MISSING_INITDATA',
        message: 'Missing initData'
      });
    }
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_BOT_TOKEN) {
      console.log('[auth/telegram] TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ 
        error: 'TELEGRAM_NOT_CONFIGURED',
        message: 'Telegram auth not configured'
      });
    }
    
    // Парсим initData как querystring
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      console.log('[auth/telegram] missing hash in initData');
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
      console.log('[auth/telegram] HMAC validation failed');
      return res.status(401).json({ 
        error: 'INVALID_SIGNATURE',
        message: 'Invalid initData signature'
      });
    }
    
    // Извлекаем user из поля user (JSON строка)
    const userStr = params.get('user');
    if (!userStr) {
      console.log('[auth/telegram] missing user in initData');
      return res.status(400).json({ 
        error: 'MISSING_USER',
        message: 'Invalid initData: missing user'
      });
    }
    
    let user;
    try {
      user = JSON.parse(userStr);
    } catch (e) {
      console.log('[auth/telegram] invalid user JSON:', e.message);
      return res.status(400).json({ 
        error: 'INVALID_USER_JSON',
        message: 'Invalid initData: invalid user JSON'
      });
    }
    
    if (!user.id) {
      console.log('[auth/telegram] missing user.id');
      return res.status(400).json({ 
        error: 'MISSING_USER_ID',
        message: 'Invalid initData: missing user.id'
      });
    }
    
    // Находим/создаём аккаунт по telegram_user_id
    if (!db.getOrCreateTelegramAccount || typeof db.getOrCreateTelegramAccount !== 'function') {
      console.error('[auth/telegram] CRITICAL: db.getOrCreateTelegramAccount is not a function');
      return res.status(500).json({ 
        error: 'INTERNAL_ERROR',
        message: 'Database function not available'
      });
    }
    
    const account = db.getOrCreateTelegramAccount(user.id);
    
    if (!account || !account.accountId || !account.authToken) {
      console.error('[auth/telegram] CRITICAL: getOrCreateTelegramAccount returned invalid account:', account);
      return res.status(500).json({ 
        error: 'INTERNAL_ERROR',
        message: 'Failed to create or retrieve account'
      });
    }
    
    console.log('[auth/telegram] success, tgId=', user.id, 'acc=', account.accountId);
    
    res.json({
      accountId: account.accountId,
      authToken: account.authToken,
      tokens: account.tokens,
      nickname: account.nickname || null
    });
  } catch (error) {
    console.error('[auth/telegram] exception:', error);
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
    tokens: account.tokens,
    nickname: account.nickname || null
  });
});

// Валидация nickname
function validateNickname(nickname) {
  if (!nickname || typeof nickname !== 'string') {
    return { valid: false, error: 'Nickname is required' };
  }
  
  const trimmed = nickname.trim();
  
  if (trimmed.length < 3 || trimmed.length > 16) {
    return { valid: false, error: 'Nickname must be 3-16 characters long' };
  }
  
  // Разрешенные символы: латиница, цифры, подчерк, пробел, дефис
  const allowedPattern = /^[a-zA-Z0-9_\s-]+$/;
  if (!allowedPattern.test(trimmed)) {
    return { valid: false, error: 'Nickname can only contain letters, numbers, underscore, space, and hyphen' };
  }
  
  // Нормализация: collapse spaces
  const normalized = trimmed.replace(/\s+/g, ' ');
  
  return { valid: true, normalized };
}

// Endpoint для установки nickname
app.post('/account/nickname', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });
  }

  const authToken = authHeader.substring(7);
  const account = db.getAccountByAuthToken(authToken);
  
  if (!account) {
    return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });
  }

  const { nickname } = req.body;
  
  if (!nickname) {
    return res.status(400).json({ error: 'invalid_nickname', message: 'Nickname is required' });
  }

  const validation = validateNickname(nickname);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid_nickname', message: validation.error });
  }

  const normalized = validation.normalized;
  const nicknameLower = normalized.toLowerCase();
  
  // Проверяем уникальность (case-insensitive)
  const existingAccountId = db.getNicknameByLower(nicknameLower);
  if (existingAccountId && existingAccountId !== account.accountId) {
    return res.status(409).json({ error: 'nickname_taken', message: 'Nickname is already taken' });
  }

  // Устанавливаем nickname
  try {
    db.setNickname(account.accountId, normalized);
    console.log(`[NICKNAME_SET] accountId=${account.accountId} nickname=${normalized}`);
    res.json({ nickname: normalized, nicknameLower });
  } catch (error) {
    console.error('[NICKNAME_SET_FAIL]', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to set nickname' });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
