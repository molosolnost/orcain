/**
 * Economy: PvE => tokens unchanged (no charge, no payout).
 */
const simUtils = require('../lib/sim_utils');
const db = require('../../db');
const common = require('./common');

async function run(port, logBuffer) {
  const acc = db.createGuestAccount();
  const tBefore = db.getTokens(acc.accountId);

  const s = await simUtils.connectClient(port, acc);
  common.attachEventBuffer(s, ['match_found', 'prep_start', 'match_end']);

  s.emit('pve_start');
  await common.waitForEventBuffered(s, 'match_found', { timeoutMs: 3000 });
  await common.waitForEventBuffered(s, 'prep_start', { timeoutMs: 3000 });

  const layout = ['attack', 'defense', 'heal'];
  let gotMatchEnd = false;
  for (let r = 0; r < 10; r++) {
    s.emit('layout_confirm', { layout: [...layout] });
    await common.waitForEvent(s, 'confirm_ok', 2000);
    for (let i = 0; i < 3; i++) await common.waitForEvent(s, 'step_reveal', 3000);
    const re = await Promise.race([
      common.waitForEvent(s, 'round_end', 3000).then(() => 'round'),
      common.waitForEventBuffered(s, 'match_end', { timeoutMs: 3000 }).then(() => 'match')
    ]);
    if (re === 'match') { gotMatchEnd = true; break; }
    const next = await Promise.race([
      common.waitForEventBuffered(s, 'prep_start', { timeoutMs: 4000 }).then(() => 'prep'),
      common.waitForEventBuffered(s, 'match_end', { timeoutMs: 4000 }).then(() => 'match')
    ]);
    if (next === 'match') { gotMatchEnd = true; break; }
  }
  if (!gotMatchEnd) await common.waitForEventBuffered(s, 'match_end', { timeoutMs: 8000 });

  const tAfter = db.getTokens(acc.accountId);

  if (tAfter !== tBefore) throw new Error(`PvE expected tokens unchanged: before=${tBefore} after=${tAfter}`);

  common.assertNoInvariantFail(logBuffer);
  s.disconnect();
}

module.exports = { run };
