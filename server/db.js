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
    createdAt INTEGER NOT NULL
  )
`);

// Добавляем колонку telegramUserId если её нет (миграция)
try {
  db.exec('ALTER TABLE accounts ADD COLUMN telegramUserId INTEGER UNIQUE');
} catch (e) {
  // Колонка уже существует, игнорируем ошибку
}

// Функции для работы с аккаунтами
function createGuestAccount() {
  const accountId = require('crypto').randomUUID();
  const authToken = require('crypto').randomUUID();
  const tokens = 10;
  const createdAt = Date.now();

  const stmt = db.prepare('INSERT INTO accounts (accountId, authToken, tokens, createdAt, telegramUserId) VALUES (?, ?, ?, ?, NULL)');
  stmt.run(accountId, authToken, tokens, createdAt);

  return { accountId, authToken, tokens };
}

function getOrCreateTelegramAccount(telegramUserId) {
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
