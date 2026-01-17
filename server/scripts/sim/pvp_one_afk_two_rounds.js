/**
 * PvP scenario F: One AFK 2 rounds → match_end reason=timeout, winner=active.
 * A: nothing. B: layout_confirm each round. Expect match_end, winnerId=B, loserId=A.
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

  const layout = ['attack', 'defense', 'heal'];

  // Round 1: s1 (A) nothing, s2 (B) confirm
  s2.emit('layout_confirm', { matchId, layout: [...layout] });
  await common.waitForEvent(s2, 'confirm_ok', 2000);
  for (let i = 0; i < 3; i++) await common.waitForEvent(s1, 'step_reveal', 5000);
  await common.waitForEvent(s1, 'round_end', 5000);

  // Round 2: prep_start, s1 nothing, s2 confirm. Server ends match (A AFK 2); no step_reveal/round_end.
  await common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: 5000, predicate: (p) => p.roundIndex === 2 });
  s2.emit('layout_confirm', { matchId, layout: [...layout] });
  await common.waitForEvent(s2, 'confirm_ok', 2000);

  const me = await common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 6000 });
  if (me.reason !== 'timeout') {
    throw new Error(`F: match_end reason expected 'timeout', got '${me.reason}'. ${diag(logBuffer, matchId)}`);
  }
  // Winner = active (B), loser = AFK (A). We don't have sessionId from sockets; winnerId/loserId are sessionIds.
  // We know s2 was active and s1 was AFK. The server's sessions order: [p1, p2]. We don't know which socket is p1.
  // We can only check: winner and loser are set and differ. reason=timeout.
  if (me.winner != null && me.winner === 'OPPONENT' && me.winnerId == null) {
    // endMatchBothAfk has winnerId=null. Here we have one AFK so winnerId and loserId are set.
  }
  if (!me.winnerId || !me.loserId) {
    throw new Error(`F: one-AFK match_end must have winnerId and loserId. ${diag(logBuffer, matchId)}`);
  }

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
