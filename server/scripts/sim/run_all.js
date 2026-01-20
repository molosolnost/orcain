#!/usr/bin/env node
/**
 * Runs all sim scenarios (A–M).
 * Starts server with TEST_MODE=1. Timings: CI uses TEST_PREP_MS=900, TEST_STEP_MS=150;
 * locally TEST_PREP_MS=300, TEST_STEP_MS=50.
 * Usage: node server/scripts/sim/run_all.js
 */
const common = require('./common');
const pvpBasic = require('./pvp_basic');
const pvpPartial = require('./pvp_partial_play');
const pveBasic = require('./pve_basic');
const pvpPartialNoConfirm = require('./pvp_partial_play_no_confirm');
const pvpBothAfk = require('./pvp_both_afk_two_rounds');
const pvpOneAfk = require('./pvp_one_afk_two_rounds');
const pvpAttackVsGrass = require('./pvp_attack_vs_grass');
const pvpEndmatchIdempotent = require('./pvp_endmatch_idempotent');
const pvpNotEnoughTokens = require('./pvp_not_enough_tokens');
const pvpChargeOnce = require('./pvp_charge_once');
const pvpTimeoutBurnPot = require('./pvp_timeout_burn_pot');
const pveNoTokenChange = require('./pve_no_token_change');

const PORT = 3010;
let _logBuffer = [];

const isCI = process.env.CI === 'true' || process.env.CI === '1';
const TEST_PREP_MS = isCI ? '900' : '300';
const TEST_STEP_MS = isCI ? '150' : '50';

function runScenario(label, fn) {
  return fn().catch((e) => {
    throw new Error(`[sim] Scenario ${label} failed: ${e.message}`);
  });
}

async function main() {
  const { startServer, stopServer, waitForServerReady, assertNoInvariantFail, delay } = common;
  const { proc, logBuffer } = startServer({
    PORT: String(PORT),
    TEST_PREP_MS,
    TEST_STEP_MS
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
    console.log('[sim] D: pvp_partial_play_no_confirm...');
    await runScenario('D: pvp_partial_play_no_confirm', () => pvpPartialNoConfirm.run(PORT, logBuffer));
    console.log('[sim] D: pvp_partial_play_no_confirm OK');
    console.log('[sim] E: pvp_both_afk_two_rounds...');
    await runScenario('E: pvp_both_afk_two_rounds', () => pvpBothAfk.run(PORT, logBuffer));
    console.log('[sim] E: pvp_both_afk_two_rounds OK');
    console.log('[sim] F: pvp_one_afk_two_rounds...');
    await runScenario('F: pvp_one_afk_two_rounds', () => pvpOneAfk.run(PORT, logBuffer));
    console.log('[sim] F: pvp_one_afk_two_rounds OK');
    console.log('[sim] G: pvp_attack_vs_grass...');
    await runScenario('G: pvp_attack_vs_grass', () => pvpAttackVsGrass.run(PORT, logBuffer));
    console.log('[sim] G: pvp_attack_vs_grass OK');
    console.log('[sim] H: pvp_endmatch_idempotent...');
    await runScenario('H: pvp_endmatch_idempotent', () => pvpEndmatchIdempotent.run(PORT, logBuffer));
    console.log('[sim] H: pvp_endmatch_idempotent OK');
    console.log('[sim] I: pvp_not_enough_tokens...');
    await runScenario('I: pvp_not_enough_tokens', () => pvpNotEnoughTokens.run(PORT, logBuffer));
    console.log('[sim] I: pvp_not_enough_tokens OK');
    console.log('[sim] J: pvp_charge_once...');
    await runScenario('J: pvp_charge_once', () => pvpChargeOnce.run(PORT, logBuffer));
    console.log('[sim] J: pvp_charge_once OK');
    console.log('[sim] K: pvp_timeout_burn_pot...');
    await runScenario('K: pvp_timeout_burn_pot', () => pvpTimeoutBurnPot.run(PORT, logBuffer));
    console.log('[sim] K: pvp_timeout_burn_pot OK');
    console.log('[sim] M: pve_no_token_change...');
    await runScenario('M: pve_no_token_change', () => pveNoTokenChange.run(PORT, logBuffer));
    console.log('[sim] M: pve_no_token_change OK');
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
