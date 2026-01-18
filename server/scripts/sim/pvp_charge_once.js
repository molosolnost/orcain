/**
 * Economy: PvP charge happens once per player (tokens -1 each after match found).
 */
const simUtils = require('../lib/sim_utils');
const db = require('../../db');

async function run(port, logBuffer) {
  const acc1 = db.createGuestAccount();
  const acc2 = db.createGuestAccount();

  const t1Before = db.getTokens(acc1.accountId);
  const t2Before = db.getTokens(acc2.accountId);

  const s1 = await simUtils.connectClient(port, acc1);
  const s2 = await simUtils.connectClient(port, acc2);
  s1.emit('queue_join');
  s2.emit('queue_join');

  await Promise.all([
    simUtils.waitForEvent(s1, 'prep_start', 3000),
    simUtils.waitForEvent(s2, 'prep_start', 3000)
  ]);

  const t1After = db.getTokens(acc1.accountId);
  const t2After = db.getTokens(acc2.accountId);

  const cost = 1;
  if (t1After !== t1Before - cost) throw new Error(`p1 tokens: before=${t1Before} after=${t1After}, expected -${cost}`);
  if (t2After !== t2Before - cost) throw new Error(`p2 tokens: before=${t2Before} after=${t2After}, expected -${cost}`);

  simUtils.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
