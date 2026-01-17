/**
 * PvP scenario B: Partial play — 1 card, no confirm.
 * Client1: layout_draft [attack, null, null] immediately after prep_start.
 * Client2: nothing (AFK).
 * Expect: step_reveal; at stepIndex=0: s1.yourCard==='attack', s2.yourCard==='GRASS'.
 * Uses TEST_PREP_MS=1200 so draft is processed before prep timer.
 */
const common = require('./common');

function diag(logBuffer, matchId, extra = '') {
  const tail = (Array.isArray(logBuffer) ? logBuffer : []).slice(-50).join('');
  return `matchId=${matchId || '?'} ${extra}\nServer log tail:\n${tail}`;
}

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);
  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 2000),
    common.waitForEvent(s2, 'prep_start', 2000)
  ]);
  const matchId = prep1.matchId;
  if (!matchId) throw new Error('prep_start missing matchId');

  // Emit draft immediately after prep_start — no delay, so it is processed before prep timer.
  s1.emit('layout_draft', { matchId, layout: ['attack', null, null] });
  // B does nothing

  let d1, d2;
  try {
    [d1, d2] = await Promise.all([
      common.waitForEvent(s1, 'step_reveal', 5000),
      common.waitForEvent(s2, 'step_reveal', 5000)
    ]);
  } catch (e) {
    throw new Error(`Partial play: step_reveal timeout. ${diag(logBuffer, matchId, e.message)}`);
  }

  if (d1.yourCard !== 'attack') {
    throw new Error(`Partial play: s1 yourCard expected 'attack', got '${d1.yourCard}'. ${diag(logBuffer, matchId)}`);
  }
  if (d2.yourCard !== 'GRASS') {
    throw new Error(`Partial play: s2 yourCard expected 'GRASS', got '${d2.yourCard}'. ${diag(logBuffer, matchId)}`);
  }

  await common.waitForEvent(s1, 'step_reveal', 3000);
  await common.waitForEvent(s1, 'step_reveal', 3000);
  await common.waitForEvent(s1, 'round_end', 3000);

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
