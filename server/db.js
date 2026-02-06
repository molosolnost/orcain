const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Создаём папку data если её нет
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'orcain.sqlite');
const db = new Database(dbPath);

// Создаём таблицу accounts если её нет
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
    language TEXT
  )
`);

// Миграция: добавляем колонку telegramUserId если её нет (для старых БД)
try {
  db.exec('ALTER TABLE accounts ADD COLUMN telegramUserId INTEGER');
} catch (e) {
  // Колонка уже существует, игнорируем ошибку
}

// Создаём уникальный индекс для telegramUserId (только для не-NULL значений)
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_telegramUserId
    ON accounts(telegramUserId)
    WHERE telegramUserId IS NOT NULL
  `);
} catch (e) {
  // Индекс уже существует или ошибка, игнорируем
}

// Миграция: добавляем колонки nickname если их нет
try {
  db.exec('ALTER TABLE accounts ADD COLUMN nickname TEXT');
} catch (e) {
  // Колонка уже существует, игнорируем ошибку
}

try {
  db.exec('ALTER TABLE accounts ADD COLUMN nicknameLower TEXT');
} catch (e) {
  // Колонка уже существует, игнорируем ошибку
}

// Миграция: добавляем profile-поля если их нет
try {
  db.exec('ALTER TABLE accounts ADD COLUMN avatar TEXT');
} catch (e) {
  // Колонка уже существует, игнорируем ошибку
}

try {
  db.exec('ALTER TABLE accounts ADD COLUMN language TEXT');
} catch (e) {
  // Колонка уже существует, игнорируем ошибку
}

// Заполняем дефолтные profile значения для старых записей
try {
  db.exec("UPDATE accounts SET avatar = 'orc' WHERE avatar IS NULL OR TRIM(avatar) = ''");
  db.exec("UPDATE accounts SET language = 'ru' WHERE language IS NULL OR TRIM(language) = ''");
} catch (e) {
  // Безопасный fallback для несовместимых старых схем
}

// Создаём уникальный индекс для nicknameLower (case-insensitive уникальность)
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_nicknameLower
    ON accounts(nicknameLower)
    WHERE nicknameLower IS NOT NULL
  `);
} catch (e) {
  // Индекс уже существует или ошибка, игнорируем
}

// Функции для работы с аккаунтами
function createGuestAccount() {
  const accountId = require('crypto').randomUUID();
  const authToken = require('crypto').randomUUID();
  const tokens = 10;
  const createdAt = Date.now();

  const stmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, avatar, language) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(accountId, authToken, tokens, createdAt, 'orc', 'ru');

  return { accountId, authToken, tokens, avatar: 'orc', language: 'ru', nickname: null };
}

function getOrCreateTelegramAccount(telegramUserId) {
  try {
    // Ищем существующий аккаунт по telegramUserId
    // Пробуем выбрать с nickname (если колонка есть)
    let findStmt;
    try {
      findStmt = db.prepare('SELECT accountId, authToken, tokens, nickname, avatar, language FROM accounts WHERE telegramUserId = ?');
    } catch (e) {
      // Если nickname колонка отсутствует, выбираем без неё
      findStmt = db.prepare('SELECT accountId, authToken, tokens FROM accounts WHERE telegramUserId = ?');
    }
    
    const existing = findStmt.get(telegramUserId);
    
    if (existing) {
      return { 
        accountId: existing.accountId, 
        authToken: existing.authToken, 
        tokens: existing.tokens,
        nickname: existing.nickname || null,
        avatar: existing.avatar || 'orc',
        language: existing.language || 'ru'
      };
    }
    
    // Создаём новый аккаунт
    const accountId = require('crypto').randomUUID();
    const authToken = require('crypto').randomUUID();
    const tokens = 10;
    const createdAt = Date.now();
    
    try {
      // Пробуем вставить с nickname (если колонка есть)
      const insertStmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, telegramUserId, nickname, nicknameLower, avatar, language) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)');
      insertStmt.run(accountId, authToken, tokens, createdAt, telegramUserId, 'orc', 'ru');
    } catch (e) {
      // Если nickname колонки отсутствуют, вставляем без них
      const insertStmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, telegramUserId) VALUES (?, ?, ?, ?, ?)');
      insertStmt.run(accountId, authToken, tokens, createdAt, telegramUserId);
    }
    
    return { accountId, authToken, tokens, nickname: null, avatar: 'orc', language: 'ru' };
  } catch (error) {
    // Если telegramUserId колонка отсутствует, попробуем без неё (fallback для старых БД)
    if (error.message && error.message.includes('no such column: telegramUserId')) {
      // Создаём аккаунт без telegramUserId (старая схема)
      const accountId = require('crypto').randomUUID();
      const authToken = require('crypto').randomUUID();
      const tokens = 10;
      const createdAt = Date.now();
      
      const insertStmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, avatar, language) VALUES (?, ?, ?, ?, ?, ?)');
      insertStmt.run(accountId, authToken, tokens, createdAt, 'orc', 'ru');
      
      return { accountId, authToken, tokens, nickname: null, avatar: 'orc', language: 'ru' };
    }
    throw error;
  }
}

function getAccountByAuthToken(authToken) {
  const stmt = db.prepare('SELECT accountId, tokens, nickname, avatar, language FROM accounts WHERE authToken = ?');
  const row = stmt.get(authToken);
  return row ? {
    accountId: row.accountId,
    tokens: row.tokens,
    nickname: row.nickname || null,
    avatar: row.avatar || 'orc',
    language: row.language || 'ru'
  } : null;
}

function getAccountById(accountId) {
  const stmt = db.prepare('SELECT accountId, tokens, nickname, avatar, language FROM accounts WHERE accountId = ?');
  const row = stmt.get(accountId);
  return row ? {
    accountId: row.accountId,
    tokens: row.tokens,
    nickname: row.nickname || null,
    avatar: row.avatar || 'orc',
    language: row.language || 'ru'
  } : null;
}

function getTokens(accountId) {
  const account = getAccountById(accountId);
  return account ? account.tokens : null;
}

function setTokens(accountId, tokens) {
  const stmt = db.prepare('UPDATE accounts SET tokens = ? WHERE accountId = ?');
  stmt.run(tokens, accountId);
}

function deductTokens(accountId, amount) {
  const current = getTokens(accountId);
  if (current === null || current < amount) {
    return false;
  }
  setTokens(accountId, current - amount);
  return true;
}

function addTokens(accountId, amount) {
  const current = getTokens(accountId);
  if (current === null) {
    return false;
  }
  setTokens(accountId, current + amount);
  return true;
}

// Функции для работы с nickname
function setNickname(accountId, nickname) {
  const nicknameLower = nickname.toLowerCase().trim();
  const stmt = db.prepare('UPDATE accounts SET nickname = ?, nicknameLower = ? WHERE accountId = ?');
  stmt.run(nickname, nicknameLower, accountId);
}

function getNicknameByLower(nicknameLower) {
  const stmt = db.prepare('SELECT accountId FROM accounts WHERE nicknameLower = ?');
  const row = stmt.get(nicknameLower);
  return row ? row.accountId : null;
}

function getNickname(accountId) {
  const account = getAccountById(accountId);
  return account ? account.nickname : null;
}

function setProfile(accountId, { avatar, language }) {
  const current = getAccountById(accountId);
  if (!current) return false;
  const nextAvatar = avatar || current.avatar || 'orc';
  const nextLanguage = language || current.language || 'ru';
  const stmt = db.prepare('UPDATE accounts SET avatar = ?, language = ? WHERE accountId = ?');
  stmt.run(nextAvatar, nextLanguage, accountId);
  return true;
}

module.exports = {
  createGuestAccount,
  getOrCreateTelegramAccount,
  getAccountByAuthToken,
  getAccountById,
  getTokens,
  setTokens,
  deductTokens,
  addTokens,
  setNickname,
  getNicknameByLower,
  getNickname,
  setProfile
};
