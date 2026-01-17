/**
 * PvP scenario H: endMatch idempotency — one match_end per client, no crash.
 * Both AFK 2 rounds → match_end. Count match_end per socket; expect 1 each.
 * We cannot trigger double endMatch from client; we verify 1 match_end and no crash.
 */
const common = require('./common');

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);
  common.attachEventBuffer(s1, ['prep_start', 'match_end']);
  common.attachEventBuffer(s2, ['prep_start', 'match_end']);

  let matchEndCount1 = 0;
  let matchEndCount2 = 0;
  s1.on('match_end', () => { matchEndCount1++; });
  s2.on('match_end', () => { matchEndCount2++; });

  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 3000),
    common.waitForEvent(s2, 'prep_start', 3000)
  ]);
  const matchId = prep1.matchId || prep2.matchId;
  if (!matchId) throw new Error('prep_start missing matchId');

  // Round 1: both do nothing
  for (let i = 0; i < 3; i++) await common.waitForEvent(s1, 'step_reveal', 5000);
  await common.waitForEvent(s1, 'round_end', 5000);

  // Round 2: wait prep_start, both do nothing. Server ends match (no step_reveal/round_end).
  await common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: 5000, predicate: (p) => p.roundIndex === 2 });

  await common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 6000 });

  if (matchEndCount1 !== 1 || matchEndCount2 !== 1) {
    throw new Error(`H: match_end count expected 1 per client, got s1=${matchEndCount1} s2=${matchEndCount2}`);
  }

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
