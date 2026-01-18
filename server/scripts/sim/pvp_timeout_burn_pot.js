/**
 * Economy: both AFK 2 rounds => timeout, pot burn, tokens stay (each -1 from start only).
 */
const common = require('./common');

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);
  common.attachEventBuffer(s1, ['prep_start', 'match_end']);
  common.attachEventBuffer(s2, ['prep_start', 'match_end']);

  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 3000),
    common.waitForEvent(s2, 'prep_start', 3000)
  ]);
  const matchId = prep1.matchId;

  for (let i = 0; i < 3; i++) await common.waitForEvent(s1, 'step_reveal', 5000);
  await common.waitForEvent(s1, 'round_end', 5000);

  await common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: 5000, predicate: (p) => p.roundIndex === 2 });

  const me = await common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 6000 });
  if (me.reason !== 'timeout') throw new Error(`Expected reason=timeout, got ${me.reason}`);

  // Each paid 1 at start, pot burned: yourTokens should be 10-1=9
  if (me.yourTokens !== 9) throw new Error(`Expected yourTokens=9 (burn), got ${me.yourTokens}`);

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
