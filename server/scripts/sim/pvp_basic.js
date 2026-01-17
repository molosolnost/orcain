/**
 * PvP scenario A: both confirm 3 cards.
 * Expect: step_reveal x3, round_end, no INVARIANT_FAIL.
 */
const common = require('./common');

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);
  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 2000),
    common.waitForEvent(s2, 'prep_start', 2000)
  ]);
  if (!prep1.matchId || prep1.matchId !== prep2.matchId) throw new Error('matchId mismatch');
  if (typeof prep1.yourHp !== 'number') throw new Error('yourHp not number');

  const layout = ['attack', 'defense', 'heal'];
  s1.emit('layout_confirm', { layout: [...layout] });
  s2.emit('layout_confirm', { layout: [...layout] });
  await common.waitForEvent(s1, 'confirm_ok', 2000);
  await common.waitForEvent(s2, 'confirm_ok', 2000);

  for (let i = 0; i < 3; i++) {
    const ev = await common.waitForEvent(s1, 'step_reveal', 3000);
    if (typeof ev.yourHp !== 'number') throw new Error('step_reveal yourHp not number');
  }
  await common.waitForEvent(s1, 'round_end', 3000);

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
