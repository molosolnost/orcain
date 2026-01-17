/**
 * PvP scenario E: Both AFK 2 rounds → match_end reason=timeout.
 * Neither sends draft or confirm for 2 rounds. Expect match_end after 2nd round.
 */
const common = require('./common');

function diag(logBuffer, matchId, extra = '') {
  const tail = (Array.isArray(logBuffer) ? logBuffer : []).slice(-30).join('');
  return `matchId=${matchId || '?'} ${extra}\nServer log tail:\n${tail}`;
}

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);
  common.attachEventBuffer(s1, ['prep_start', 'match_end']);
  common.attachEventBuffer(s2, ['prep_start', 'match_end']);

  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 3000),
    common.waitForEvent(s2, 'prep_start', 3000)
  ]);
  const matchId = prep1.matchId || prep2.matchId;
  if (!matchId) throw new Error('prep_start missing matchId');

  // Round 1: do nothing. Wait for step_reveal x3, round_end.
  for (let i = 0; i < 3; i++) await common.waitForEvent(s1, 'step_reveal', 5000);
  await common.waitForEvent(s1, 'round_end', 5000);

  // Round 2: wait for prep_start (roundIndex 2), do nothing. Server will NOT send step_reveal/round_end
  // (both AFK → finalizeRound ends match directly). So we wait for match_end only.
  await common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: 5000, predicate: (p) => p.roundIndex === 2 });

  const me = await common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 6000 });
  if (me.reason !== 'timeout') {
    throw new Error(`E: match_end reason expected 'timeout', got '${me.reason}'. ${diag(logBuffer, matchId)}`);
  }
  // match_end after prep_start round 2 ensures we're past 2nd round

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
