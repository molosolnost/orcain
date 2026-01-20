/**
 * Simulation utilities for PvP/PvE regression tests.
 * Uses socket.io-client and spawns the server with TEST_MODE=1.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const __dirnameLib = __dirname; // server/scripts/lib

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** One-shot HTTP GET /health; resolves true if 200, else false. */
function httpHealthCheck(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Start server with TEST_MODE and capture logs.
 * @param {object} envOverrides - merged into process.env (e.g. { PORT: '3010' })
 * @returns {{ proc: ChildProcess, logBuffer: string[] }}
 */
function startServer(envOverrides = {}) {
  const env = { ...process.env, TEST_MODE: '1', PORT: '3010', TEST_PREP_MS: '300', ...envOverrides };
  const logBuffer = [];
  const serverDir = path.join(__dirnameLib, '../..'); // server/

  const proc = spawn('node', ['index.js'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (chunk) => {
    const s = chunk.toString();
    logBuffer.push(s);
  });
  proc.stderr.on('data', (chunk) => {
    const s = chunk.toString();
    logBuffer.push(s);
  });

  return { proc, logBuffer };
}

/**
 * Stop server process.
 */
function stopServer(proc) {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
  }
}

/**
 * Wait for server to be ready via HTTP GET /health (log-independent).
 * Requires TEST_MODE=1 so /health exists. Polls until 200 or timeout.
 */
async function waitForServerReady(proc, logBuffer, port, timeoutMs = 8000) {
  await delay(300);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await httpHealthCheck(port)) return;
    await delay(100);
  }
  const tail = (Array.isArray(logBuffer) ? logBuffer : []).slice(-30).join('');
  throw new Error(`Server start timeout: GET /health did not return 200. Last 30 log lines:\n${tail}`);
}

/**
 * Connect client, send hello, wait for hello_ok.
 * @param {number} port
 * @param {{ accountId: string, authToken: string }} account - from db.createGuestAccount()
 * @returns {Promise<import('socket.io-client').Socket>}
 */
async function connectClient(port, account) {
  const { io } = require('socket.io-client');
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('connect', () => {
      socket.emit('hello', { sessionId: account.accountId, authToken: account.authToken });
    });
    socket.once('hello_ok', () => {
      clearTimeout(t);
      resolve();
    });
    socket.once('error_msg', (e) => {
      clearTimeout(t);
      reject(new Error(e?.message || 'hello error'));
    });
  });

  return socket;
}

/**
 * Wait for a single event.
 */
function waitForEvent(socket, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

/**
 * Event buffer: subscribe to eventNames and store all payloads so they are never lost.
 * Must be called before emitting actions that trigger these events.
 * @param {object} socket
 * @param {string[]} eventNames
 * @returns {{ buffer: Record<string, any[]>, last: Record<string, any> }}
 */
function attachEventBuffer(socket, eventNames) {
  const buf = (socket._simBuffer = socket._simBuffer || { buffer: {}, last: {} });
  for (const en of eventNames) {
    if (buf.buffer[en]) continue; // already attached
    buf.buffer[en] = [];
    socket.on(en, (payload) => {
      buf.buffer[en].push(payload);
      buf.last[en] = payload;
      const m = payload?.matchId ?? '-';
      const r = payload?.roundIndex ?? '-';
      console.log(`[sim][recv] event=${en} matchId=${m} roundIndex=${r}`);
    });
  }
  return buf;
}

/**
 * Wait for an event, consuming from the buffer if already arrived. Never misses events
 * that were emitted before the wait started.
 * @param {object} socket - must have been passed to attachEventBuffer first
 * @param {string} eventName
 * @param {{ timeoutMs?: number, predicate?: (p: any) => boolean, signal?: AbortSignal }} opts
 */
async function waitForEventBuffered(socket, eventName, opts = {}) {
  const { timeoutMs = 8000, predicate = () => true, signal } = opts;
  const buf = socket._simBuffer;
  if (!buf) throw new Error('attachEventBuffer(socket, [eventNames]) must be called before waitForEventBuffered');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('aborted');
    const arr = buf.buffer[eventName] || [];
    const idx = arr.findIndex(predicate);
    if (idx >= 0) {
      const payload = arr[idx];
      arr.splice(idx, 1);
      return payload;
    }
    await delay(50);
  }
  const seen = Object.entries(buf.buffer || {}).map(([e, arr]) => ({
    event: e,
    count: (arr || []).length,
    last: buf.last ? buf.last[e] : undefined
  }));
  console.error('[sim] Seen events summary:', JSON.stringify(seen, null, 2));
  if (buf.last && buf.last['error_msg']) {
    console.error('[sim] last error_msg:', JSON.stringify(buf.last['error_msg']));
  }
  throw new Error(`Timeout waiting for ${eventName}. Seen: ${JSON.stringify(seen)}`);
}

/**
 * Assert no [INVARIANT_FAIL] in server logs.
 * @param {string[]} logBuffer - array of log chunks
 */
function assertNoInvariantFail(logBuffer) {
  const all = (Array.isArray(logBuffer) ? logBuffer : []).join('');
  if (all.includes('[INVARIANT_FAIL]')) {
    const idx = all.indexOf('[INVARIANT_FAIL]');
    const snippet = all.slice(Math.max(0, idx - 50), idx + 200);
    throw new Error(`[INVARIANT_FAIL] found in server logs: ...${snippet}...`);
  }
}

module.exports = {
  delay,
  startServer,
  stopServer,
  waitForServerReady,
  connectClient,
  waitForEvent,
  attachEventBuffer,
  waitForEventBuffered,
  assertNoInvariantFail
};
