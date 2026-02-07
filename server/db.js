const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_AVATAR = 'orc';
const DEFAULT_LANGUAGE = 'ru';
const START_TOKENS = 10;
const BOT_ACCOUNT_ID = 'BOT';
const PVP_WIN_RATING_DELTA = 5;
const PVP_LOSS_RATING_DELTA = -2;
const PVP_DRAW_RATING_DELTA = 0;
const PVP_MATCH_HISTORY_LIMIT_DEFAULT = 10;

const RATING_LEAGUES = [
  { key: 'wood', min: 0, max: 99 },
  { key: 'iron', min: 100, max: 199 },
  { key: 'bronze', min: 200, max: 349 },
  { key: 'silver', min: 350, max: 549 },
  { key: 'gold', min: 550, max: 799 },
  { key: 'mythic', min: 800, max: Number.POSITIVE_INFINITY }
];

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const configuredDbPath = (process.env.ORCAIN_DB_PATH || '').trim();
const dbPath = configuredDbPath
  ? path.resolve(configuredDbPath)
  : path.join(dataDir, 'orcain.sqlite');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(tableName, columnName, definitionSql) {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    accountId TEXT PRIMARY KEY,
    authToken TEXT UNIQUE NOT NULL,
    tokens INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    telegramUserId INTEGER,
    nickname TEXT,
    nicknameLower TEXT,
    avatar TEXT,
    language TEXT,
    lastSeenAt INTEGER,
    rating INTEGER NOT NULL DEFAULT 0
  )
`);

addColumnIfMissing('accounts', 'telegramUserId', 'telegramUserId INTEGER');
addColumnIfMissing('accounts', 'nickname', 'nickname TEXT');
addColumnIfMissing('accounts', 'nicknameLower', 'nicknameLower TEXT');
addColumnIfMissing('accounts', 'avatar', 'avatar TEXT');
addColumnIfMissing('accounts', 'language', 'language TEXT');
addColumnIfMissing('accounts', 'lastSeenAt', 'lastSeenAt INTEGER');
addColumnIfMissing('accounts', 'rating', 'rating INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_telegramUserId
  ON accounts(telegramUserId)
  WHERE telegramUserId IS NOT NULL
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_nicknameLower
  ON accounts(nicknameLower)
  WHERE nicknameLower IS NOT NULL
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS account_stats (
    accountId TEXT PRIMARY KEY REFERENCES accounts(accountId) ON DELETE CASCADE,
    totalBattles INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    pvpBattles INTEGER NOT NULL DEFAULT 0,
    pveBattles INTEGER NOT NULL DEFAULT 0,
    pvpWins INTEGER NOT NULL DEFAULT 0,
    pveWins INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS match_history (
    matchId TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    reason TEXT,
    winnerAccountId TEXT,
    loserAccountId TEXT,
    player1AccountId TEXT,
    player2AccountId TEXT,
    roundIndex INTEGER,
    endedAt INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS account_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accountId TEXT REFERENCES accounts(accountId) ON DELETE CASCADE,
    eventType TEXT NOT NULL,
    payloadJson TEXT,
    createdAt INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_account_events_account_time
  ON account_events(accountId, createdAt DESC)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_match_history_endedAt
  ON match_history(endedAt DESC)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_match_history_player1
  ON match_history(player1AccountId)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_match_history_player2
  ON match_history(player2AccountId)
`);

db.exec(`
  UPDATE accounts
  SET avatar = '${DEFAULT_AVATAR}'
  WHERE avatar IS NULL OR TRIM(avatar) = ''
`);

db.exec(`
  UPDATE accounts
  SET language = '${DEFAULT_LANGUAGE}'
  WHERE language IS NULL OR TRIM(language) = ''
`);

db.exec(`
  UPDATE accounts
  SET lastSeenAt = createdAt
  WHERE lastSeenAt IS NULL
`);

db.exec(`
  UPDATE accounts
  SET rating = 0
  WHERE rating IS NULL OR rating < 0
`);

const ensureStatsForAllAccountsStmt = db.prepare(`
  INSERT OR IGNORE INTO account_stats (
    accountId,
    totalBattles,
    wins,
    losses,
    draws,
    pvpBattles,
    pveBattles,
    pvpWins,
    pveWins,
    createdAt,
    updatedAt
  )
  SELECT
    a.accountId,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ?,
    ?
  FROM accounts a
`);

const nowBootstrap = Date.now();
ensureStatsForAllAccountsStmt.run(nowBootstrap, nowBootstrap);

const selectAccountByAuthTokenStmt = db.prepare(`
  SELECT
    a.accountId,
    a.tokens,
    a.nickname,
    a.avatar,
    a.language,
    a.telegramUserId,
    a.rating,
    a.createdAt,
    a.lastSeenAt,
    s.totalBattles,
    s.wins,
    s.losses,
    s.draws,
    s.pvpBattles,
    s.pveBattles,
    s.pvpWins,
    s.pveWins,
    s.updatedAt AS statsUpdatedAt
  FROM accounts a
  LEFT JOIN account_stats s ON s.accountId = a.accountId
  WHERE a.authToken = ?
`);

const selectAccountByIdStmt = db.prepare(`
  SELECT
    a.accountId,
    a.tokens,
    a.nickname,
    a.avatar,
    a.language,
    a.telegramUserId,
    a.rating,
    a.createdAt,
    a.lastSeenAt,
    s.totalBattles,
    s.wins,
    s.losses,
    s.draws,
    s.pvpBattles,
    s.pveBattles,
    s.pvpWins,
    s.pveWins,
    s.updatedAt AS statsUpdatedAt
  FROM accounts a
  LEFT JOIN account_stats s ON s.accountId = a.accountId
  WHERE a.accountId = ?
`);

const selectAccountByTelegramStmt = db.prepare(`
  SELECT
    accountId,
    authToken,
    tokens,
    nickname,
    avatar,
    language,
    rating
  FROM accounts
  WHERE telegramUserId = ?
`);

const insertAccountStmt = db.prepare(`
  INSERT INTO accounts (
    accountId,
    authToken,
    tokens,
    createdAt,
    telegramUserId,
    nickname,
    nicknameLower,
    avatar,
    language,
    lastSeenAt,
    rating
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertStatsRowStmt = db.prepare(`
  INSERT OR IGNORE INTO account_stats (
    accountId,
    totalBattles,
    wins,
    losses,
    draws,
    pvpBattles,
    pveBattles,
    pvpWins,
    pveWins,
    createdAt,
    updatedAt
  ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)
`);

const updateLastSeenStmt = db.prepare(`
  UPDATE accounts
  SET lastSeenAt = ?
  WHERE accountId = ?
`);

const getTokensStmt = db.prepare('SELECT tokens FROM accounts WHERE accountId = ?');
const setTokensStmt = db.prepare('UPDATE accounts SET tokens = ? WHERE accountId = ?');
const getRatingStmt = db.prepare('SELECT rating FROM accounts WHERE accountId = ?');
const addRatingDeltaStmt = db.prepare(`
  UPDATE accounts
  SET rating = MAX(0, rating + ?), lastSeenAt = ?
  WHERE accountId = ?
`);

const setNicknameStmt = db.prepare(`
  UPDATE accounts
  SET nickname = ?, nicknameLower = ?, lastSeenAt = ?
  WHERE accountId = ?
`);

const getNicknameByLowerStmt = db.prepare(`
  SELECT accountId
  FROM accounts
  WHERE nicknameLower = ?
`);

const setProfileStmt = db.prepare(`
  UPDATE accounts
  SET avatar = ?, language = ?, lastSeenAt = ?
  WHERE accountId = ?
`);

const insertAccountEventStmt = db.prepare(`
  INSERT INTO account_events (
    accountId,
    eventType,
    payloadJson,
    createdAt
  ) VALUES (?, ?, ?, ?)
`);

const selectRecentRecordedMatchesStmt = db.prepare(`
  SELECT payloadJson, createdAt
  FROM account_events
  WHERE accountId = ? AND eventType = 'match_recorded'
  ORDER BY createdAt DESC
  LIMIT ?
`);

const selectStatsByAccountStmt = db.prepare(`
  SELECT
    totalBattles,
    wins,
    losses,
    draws,
    pvpBattles,
    pveBattles,
    pvpWins,
    pveWins,
    createdAt,
    updatedAt
  FROM account_stats
  WHERE accountId = ?
`);

const matchExistsByIdStmt = db.prepare('SELECT matchId FROM match_history WHERE matchId = ?');

const insertMatchHistoryStmt = db.prepare(`
  INSERT INTO match_history (
    matchId,
    mode,
    reason,
    winnerAccountId,
    loserAccountId,
    player1AccountId,
    player2AccountId,
    roundIndex,
    endedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStatsAfterMatchStmt = db.prepare(`
  UPDATE account_stats
  SET
    totalBattles = totalBattles + 1,
    wins = wins + ?,
    losses = losses + ?,
    draws = draws + ?,
    pvpBattles = pvpBattles + ?,
    pveBattles = pveBattles + ?,
    pvpWins = pvpWins + ?,
    pveWins = pveWins + ?,
    updatedAt = ?
  WHERE accountId = ?
`);

function sanitizeMode(mode) {
  return mode === 'PVP' ? 'PVP' : 'PVE';
}

function normalizeRating(rawRating) {
  const numeric = Number(rawRating);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function getLeagueByRating(rating) {
  const normalized = normalizeRating(rating);
  return RATING_LEAGUES.find((league) => normalized >= league.min && normalized <= league.max) || RATING_LEAGUES[0];
}

function mapAccountRow(row) {
  if (!row) return null;
  const rating = normalizeRating(row.rating);
  const league = getLeagueByRating(rating);
  const stats = {
    totalBattles: row.totalBattles || 0,
    wins: row.wins || 0,
    losses: row.losses || 0,
    draws: row.draws || 0,
    pvpBattles: row.pvpBattles || 0,
    pveBattles: row.pveBattles || 0,
    pvpWins: row.pvpWins || 0,
    pveWins: row.pveWins || 0,
    updatedAt: row.statsUpdatedAt || row.createdAt || Date.now()
  };

  return {
    accountId: row.accountId,
    tokens: row.tokens,
    rating,
    leagueKey: league.key,
    nickname: row.nickname || null,
    avatar: row.avatar || DEFAULT_AVATAR,
    language: row.language || DEFAULT_LANGUAGE,
    telegramUserId: row.telegramUserId || null,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt || row.createdAt,
    stats
  };
}

function ensureStatsRow(accountId, timestamp = Date.now()) {
  if (!accountId || accountId === BOT_ACCOUNT_ID) return;
  insertStatsRowStmt.run(accountId, timestamp, timestamp);
}

function touchAccount(accountId, timestamp = Date.now()) {
  if (!accountId) return;
  updateLastSeenStmt.run(timestamp, accountId);
}

function logAccountEvent(accountId, eventType, payload = {}, timestamp = Date.now()) {
  if (!accountId || !eventType || accountId === BOT_ACCOUNT_ID) return;
  insertAccountEventStmt.run(accountId, eventType, JSON.stringify(payload), timestamp);
}

function createAccount({
  telegramUserId = null,
  nickname = null,
  avatar = DEFAULT_AVATAR,
  language = DEFAULT_LANGUAGE
} = {}) {
  const accountId = crypto.randomUUID();
  const authToken = crypto.randomUUID();
  const createdAt = Date.now();
  const nicknameTrimmed = nickname ? nickname.trim() : null;
  const nicknameLower = nicknameTrimmed ? nicknameTrimmed.toLowerCase() : null;

  insertAccountStmt.run(
    accountId,
    authToken,
    START_TOKENS,
    createdAt,
    telegramUserId,
    nicknameTrimmed,
    nicknameLower,
    avatar || DEFAULT_AVATAR,
    language || DEFAULT_LANGUAGE,
    createdAt,
    0
  );

  ensureStatsRow(accountId, createdAt);
  return {
    accountId,
    authToken,
    tokens: START_TOKENS,
    nickname: nicknameTrimmed,
    avatar: avatar || DEFAULT_AVATAR,
    language: language || DEFAULT_LANGUAGE,
    createdAt
  };
}

function createGuestAccount() {
  const account = createAccount();
  logAccountEvent(account.accountId, 'guest_account_created', {
    source: 'auth_guest'
  }, account.createdAt);
  return account;
}

function getOrCreateTelegramAccount(telegramUserId) {
  const existing = selectAccountByTelegramStmt.get(telegramUserId);
  if (existing) {
    const now = Date.now();
    ensureStatsRow(existing.accountId, now);
    touchAccount(existing.accountId, now);
    logAccountEvent(existing.accountId, 'telegram_login', { telegramUserId }, now);
    return {
      accountId: existing.accountId,
      authToken: existing.authToken,
      tokens: existing.tokens,
      rating: normalizeRating(existing.rating),
      nickname: existing.nickname || null,
      avatar: existing.avatar || DEFAULT_AVATAR,
      language: existing.language || DEFAULT_LANGUAGE
    };
  }

  const account = createAccount({ telegramUserId });
  logAccountEvent(account.accountId, 'telegram_account_created', { telegramUserId }, account.createdAt);
  return account;
}

function getAccountByAuthToken(authToken) {
  const row = selectAccountByAuthTokenStmt.get(authToken);
  if (!row) return null;
  ensureStatsRow(row.accountId);
  touchAccount(row.accountId);
  return mapAccountRow(selectAccountByIdStmt.get(row.accountId));
}

function getAccountById(accountId) {
  const row = selectAccountByIdStmt.get(accountId);
  if (!row) return null;
  ensureStatsRow(accountId);
  return mapAccountRow(selectAccountByIdStmt.get(accountId));
}

function getTokens(accountId) {
  const row = getTokensStmt.get(accountId);
  return row ? row.tokens : null;
}

function setTokens(accountId, tokens) {
  setTokensStmt.run(tokens, accountId);
  touchAccount(accountId);
}

function getRating(accountId) {
  if (!accountId || accountId === BOT_ACCOUNT_ID) return 0;
  const row = getRatingStmt.get(accountId);
  return row ? normalizeRating(row.rating) : 0;
}

function addRatingDelta(accountId, delta, timestamp = Date.now()) {
  if (!accountId || accountId === BOT_ACCOUNT_ID) return 0;
  const normalizedDelta = Number(delta);
  if (!Number.isFinite(normalizedDelta)) {
    return getRating(accountId);
  }
  addRatingDeltaStmt.run(Math.trunc(normalizedDelta), timestamp, accountId);
  return getRating(accountId);
}

function deductTokens(accountId, amount, reason = 'generic') {
  const current = getTokens(accountId);
  if (current === null || current < amount) {
    return false;
  }
  const next = current - amount;
  setTokens(accountId, next);
  logAccountEvent(accountId, 'tokens_deducted', {
    amount,
    reason,
    before: current,
    after: next
  });
  return true;
}

function addTokens(accountId, amount, reason = 'generic') {
  const current = getTokens(accountId);
  if (current === null) {
    return false;
  }
  const next = current + amount;
  setTokens(accountId, next);
  logAccountEvent(accountId, 'tokens_added', {
    amount,
    reason,
    before: current,
    after: next
  });
  return true;
}

function setNickname(accountId, nickname) {
  const normalized = nickname.trim();
  const nicknameLower = normalized.toLowerCase();
  const now = Date.now();
  setNicknameStmt.run(normalized, nicknameLower, now, accountId);
  ensureStatsRow(accountId, now);
  logAccountEvent(accountId, 'nickname_set', {
    nickname: normalized,
    nicknameLower
  }, now);
}

function getNicknameByLower(nicknameLower) {
  const row = getNicknameByLowerStmt.get(nicknameLower);
  return row ? row.accountId : null;
}

function getNickname(accountId) {
  const account = getAccountById(accountId);
  return account ? account.nickname : null;
}

function setProfile(accountId, { avatar, language }) {
  const current = getAccountById(accountId);
  if (!current) return false;
  const nextAvatar = avatar || current.avatar || DEFAULT_AVATAR;
  const nextLanguage = language || current.language || DEFAULT_LANGUAGE;
  const now = Date.now();
  setProfileStmt.run(nextAvatar, nextLanguage, now, accountId);
  logAccountEvent(accountId, 'profile_updated', {
    avatar: nextAvatar,
    language: nextLanguage
  }, now);
  return true;
}

function getAccountStats(accountId) {
  ensureStatsRow(accountId);
  const row = selectStatsByAccountStmt.get(accountId);
  if (!row) {
    return {
      totalBattles: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      pvpBattles: 0,
      pveBattles: 0,
      pvpWins: 0,
      pveWins: 0,
      updatedAt: Date.now()
    };
  }
  return {
    totalBattles: row.totalBattles || 0,
    wins: row.wins || 0,
    losses: row.losses || 0,
    draws: row.draws || 0,
    pvpBattles: row.pvpBattles || 0,
    pveBattles: row.pveBattles || 0,
    pvpWins: row.pvpWins || 0,
    pveWins: row.pveWins || 0,
    updatedAt: row.updatedAt || row.createdAt || Date.now()
  };
}

function getRecentPvpMatches(accountId, limit = PVP_MATCH_HISTORY_LIMIT_DEFAULT) {
  if (!accountId || accountId === BOT_ACCOUNT_ID) return [];
  const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || PVP_MATCH_HISTORY_LIMIT_DEFAULT, 50));
  const rows = selectRecentRecordedMatchesStmt.all(accountId, safeLimit * 3);
  const matches = [];

  for (const row of rows) {
    let payload = null;
    try {
      payload = row.payloadJson ? JSON.parse(row.payloadJson) : null;
    } catch (error) {
      payload = null;
    }
    if (!payload || payload.mode !== 'PVP') continue;
    matches.push({
      matchId: payload.matchId || null,
      result: payload.result === 'win' || payload.result === 'loss' ? payload.result : 'draw',
      reason: payload.reason || null,
      roundIndex: Number.isFinite(payload.roundIndex) ? payload.roundIndex : null,
      ratingDelta: Number.isFinite(payload.ratingDelta) ? payload.ratingDelta : 0,
      ratingAfter: Number.isFinite(payload.ratingAfter) ? payload.ratingAfter : null,
      leagueKey: typeof payload.leagueKey === 'string' ? payload.leagueKey : null,
      endedAt: Number.isFinite(payload.endedAt) ? payload.endedAt : row.createdAt,
      createdAt: row.createdAt
    });
    if (matches.length >= safeLimit) break;
  }

  return matches;
}

function getAccountProgression(accountId, historyLimit = PVP_MATCH_HISTORY_LIMIT_DEFAULT) {
  const rating = getRating(accountId);
  const league = getLeagueByRating(rating);
  return {
    rating,
    leagueKey: league.key,
    recentPvpMatches: getRecentPvpMatches(accountId, historyLimit)
  };
}

const recordMatchResultTx = db.transaction((payload) => {
  const {
    matchId,
    mode,
    reason,
    winnerAccountId,
    loserAccountId,
    player1AccountId,
    player2AccountId,
    roundIndex
  } = payload;

  if (matchExistsByIdStmt.get(matchId)) {
    return false;
  }

  const endedAt = Date.now();
  const normalizedMode = sanitizeMode(mode);

  insertMatchHistoryStmt.run(
    matchId,
    normalizedMode,
    reason || null,
    winnerAccountId || null,
    loserAccountId || null,
    player1AccountId || null,
    player2AccountId || null,
    Number.isFinite(roundIndex) ? roundIndex : null,
    endedAt
  );

  const participantIds = [player1AccountId, player2AccountId]
    .filter(Boolean)
    .filter((accountId) => accountId !== BOT_ACCOUNT_ID);

  for (const accountId of [...new Set(participantIds)]) {
    ensureStatsRow(accountId, endedAt);

    const isWinner = winnerAccountId && accountId === winnerAccountId;
    const isLoser = loserAccountId && accountId === loserAccountId;
    const isDraw = !isWinner && !isLoser;

    const pvpBattle = normalizedMode === 'PVP' ? 1 : 0;
    const pveBattle = normalizedMode === 'PVE' ? 1 : 0;
    const pvpWin = normalizedMode === 'PVP' && isWinner ? 1 : 0;
    const pveWin = normalizedMode === 'PVE' && isWinner ? 1 : 0;
    const ratingBefore = getRating(accountId);
    const ratingDelta = normalizedMode === 'PVP'
      ? (isWinner ? PVP_WIN_RATING_DELTA : isLoser ? PVP_LOSS_RATING_DELTA : PVP_DRAW_RATING_DELTA)
      : 0;
    const ratingAfter = addRatingDelta(accountId, ratingDelta, endedAt);
    const leagueKey = getLeagueByRating(ratingAfter).key;

    updateStatsAfterMatchStmt.run(
      isWinner ? 1 : 0,
      isLoser ? 1 : 0,
      isDraw ? 1 : 0,
      pvpBattle,
      pveBattle,
      pvpWin,
      pveWin,
      endedAt,
      accountId
    );

    insertAccountEventStmt.run(
      accountId,
      'match_recorded',
      JSON.stringify({
        matchId,
        mode: normalizedMode,
        reason: reason || null,
        result: isWinner ? 'win' : isLoser ? 'loss' : 'draw',
        winnerAccountId: winnerAccountId || null,
        loserAccountId: loserAccountId || null,
        roundIndex: Number.isFinite(roundIndex) ? roundIndex : null,
        ratingBefore,
        ratingDelta,
        ratingAfter,
        leagueKey,
        endedAt
      }),
      endedAt
    );
  }

  return true;
});

function recordMatchResult(payload) {
  if (!payload || !payload.matchId) return false;
  return recordMatchResultTx(payload);
}

module.exports = {
  dbPath,
  createGuestAccount,
  getOrCreateTelegramAccount,
  getAccountByAuthToken,
  getAccountById,
  getTokens,
  setTokens,
  getRating,
  addRatingDelta,
  getLeagueByRating,
  getRecentPvpMatches,
  getAccountProgression,
  deductTokens,
  addTokens,
  setNickname,
  getNicknameByLower,
  getNickname,
  setProfile,
  getAccountStats,
  touchAccount,
  logAccountEvent,
  recordMatchResult
};
