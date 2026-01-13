// Helper для получения/генерации authToken и sessionId

const AUTH_TOKEN_KEY = 'orcain_authToken';
const ACCOUNT_ID_KEY = 'orcain_accountId';
const SESSION_ID_KEY = 'orcain_sessionId';

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getAccountId(): string | null {
  return localStorage.getItem(ACCOUNT_ID_KEY);
}

export function getSessionId(): string {
  // Читаем из sessionStorage
  const stored = sessionStorage.getItem(SESSION_ID_KEY);
  if (stored) {
    return stored;
  }

  // Генерируем новый UUID
  const newSessionId = crypto.randomUUID();
  sessionStorage.setItem(SESSION_ID_KEY, newSessionId);
  return newSessionId;
}

export function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_ID_KEY);
}
