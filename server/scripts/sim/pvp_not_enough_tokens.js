/**
 * Economy: tokens=0 => queue_join returns error_msg not_enough_tokens, no match.
 */
const simUtils = require('../lib/sim_utils');
const db = require('../../db');

async function run(port, logBuffer) {
  const acc = db.createGuestAccount();
  db.setTokens(acc.accountId, 0);

  const s = await simUtils.connectClient(port, acc);
  s.emit('queue_join');

  const err = await simUtils.waitForEvent(s, 'error_msg', 3000);
  if (err.code !== 'not_enough_tokens') {
    throw new Error(`Expected error_msg code=not_enough_tokens, got code=${err.code} message=${err.message}`);
  }

  simUtils.assertNoInvariantFail(logBuffer);
  s.disconnect();
}

module.exports = { run };
