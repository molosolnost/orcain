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
    telegramUserId INTEGER
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

// Функции для работы с аккаунтами
function createGuestAccount() {
  const accountId = require('crypto').randomUUID();
  const authToken = require('crypto').randomUUID();
  const tokens = 10;
  const createdAt = Date.now();

  try {
    // Пробуем вставить с telegramUserId (NULL для guest)
    const stmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, telegramUserId) VALUES (?, ?, ?, ?, NULL)');
    stmt.run(accountId, authToken, tokens, createdAt);
  } catch (error) {
    // Если telegramUserId колонка отсутствует (старая БД), вставляем без неё
    if (error.message && error.message.includes('no such column: telegramUserId')) {
      const stmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt) VALUES (?, ?, ?, ?)');
      stmt.run(accountId, authToken, tokens, createdAt);
    } else {
      throw error;
    }
  }

  return { accountId, authToken, tokens };
}

function getOrCreateTelegramAccount(telegramUserId) {
  try {
    // Ищем существующий аккаунт по telegramUserId
    const findStmt = db.prepare('SELECT accountId, authToken, tokens FROM accounts WHERE telegramUserId = ?');
    const existing = findStmt.get(telegramUserId);
    
    if (existing) {
      return { accountId: existing.accountId, authToken: existing.authToken, tokens: existing.tokens };
    }
    
    // Создаём новый аккаунт
    const accountId = require('crypto').randomUUID();
    const authToken = require('crypto').randomUUID();
    const tokens = 10;
    const createdAt = Date.now();
    
    const insertStmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, telegramUserId) VALUES (?, ?, ?, ?, ?)');
    insertStmt.run(accountId, authToken, tokens, createdAt, telegramUserId);
    
    return { accountId, authToken, tokens };
  } catch (error) {
    // Если telegramUserId колонка отсутствует, попробуем без неё (fallback для старых БД)
    if (error.message && error.message.includes('no such column: telegramUserId')) {
      // Создаём аккаунт без telegramUserId (старая схема)
      const accountId = require('crypto').randomUUID();
      const authToken = require('crypto').randomUUID();
      const tokens = 10;
      const createdAt = Date.now();
      
      const insertStmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt) VALUES (?, ?, ?, ?)');
      insertStmt.run(accountId, authToken, tokens, createdAt);
      
      return { accountId, authToken, tokens };
    }
    throw error;
  }
}

function getAccountByAuthToken(authToken) {
  const stmt = db.prepare('SELECT accountId, tokens FROM accounts WHERE authToken = ?');
  const row = stmt.get(authToken);
  return row ? { accountId: row.accountId, tokens: row.tokens } : null;
}

function getAccountById(accountId) {
  const stmt = db.prepare('SELECT accountId, tokens FROM accounts WHERE accountId = ?');
  const row = stmt.get(accountId);
  return row ? { accountId: row.accountId, tokens: row.tokens } : null;
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

module.exports = {
  createGuestAccount,
  getOrCreateTelegramAccount,
  getAccountByAuthToken,
  getAccountById,
  getTokens,
  setTokens,
  deductTokens,
  addTokens
};
