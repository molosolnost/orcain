#!/usr/bin/env node
/**
 * Runs all sim scenarios (A: pvp_basic, B: pvp_partial_play, C: pve_basic).
 * Starts server with TEST_MODE=1, TEST_PREP_MS=1200, TEST_STEP_MS=50.
 * Usage: node server/scripts/sim/run_all.js
 */
const common = require('./common');
const pvpBasic = require('./pvp_basic');
const pvpPartial = require('./pvp_partial_play');
const pveBasic = require('./pve_basic');

const PORT = 3010;
let _logBuffer = [];

function runScenario(label, fn) {
  return fn().catch((e) => {
    throw new Error(`[sim] Scenario ${label} failed: ${e.message}`);
  });
}

async function main() {
  const { startServer, stopServer, waitForServerReady, assertNoInvariantFail, delay } = common;
  const { proc, logBuffer } = startServer({
    PORT: String(PORT),
    TEST_PREP_MS: '1200',
    TEST_STEP_MS: '50'
  });
  _logBuffer = logBuffer;

  try {
    await waitForServerReady(proc, logBuffer, PORT, 6000);
    console.log('[sim] A: pvp_basic...');
    await runScenario('A: pvp_basic', () => pvpBasic.run(PORT, logBuffer));
    console.log('[sim] A: pvp_basic OK');
    console.log('[sim] B: pvp_partial_play...');
    await runScenario('B: pvp_partial_play', () => pvpPartial.run(PORT, logBuffer));
    console.log('[sim] B: pvp_partial_play OK');
    console.log('[sim] C: pve_basic...');
    await runScenario('C: pve_basic', () => pveBasic.run(PORT, logBuffer));
    console.log('[sim] C: pve_basic OK');
  } finally {
    stopServer(proc);
    await delay(200);
  }

  assertNoInvariantFail(logBuffer);
  console.log('[sim] run_all: all scenarios OK');
}

main().catch((e) => {
  console.error('[sim] FAILED:', e.message);
  const tail = (_logBuffer || []).slice(-30).join('');
  if (tail) console.error('[sim] Last 30 server log lines:\n' + tail);
  console.error(e);
  process.exit(1);
});
