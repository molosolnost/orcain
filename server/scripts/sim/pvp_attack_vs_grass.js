/**
 * PvP scenario G: ATTACK vs GRASS → GRASS player takes 2 damage.
 * A: layout_confirm [attack, ...]. B: nothing → [GRASS,GRASS,GRASS].
 * Expect: after step 0, B's yourHp = 8 (10 - 2).
 */
const common = require('./common');

function diag(logBuffer, matchId, extra = '') {
  const tail = (Array.isArray(logBuffer) ? logBuffer : []).slice(-30).join('');
  return `matchId=${matchId || '?'} ${extra}\nServer log tail:\n${tail}`;
}

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);

  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 3000),
    common.waitForEvent(s2, 'prep_start', 3000)
  ]);
  const matchId = prep1.matchId || prep2.matchId;
  if (!matchId) throw new Error('prep_start missing matchId');

  // A (s1): attack in slot0. B (s2): nothing → GRASS.
  s1.emit('layout_confirm', { matchId, layout: ['attack', 'defense', 'heal'] });
  await common.waitForEvent(s1, 'confirm_ok', 2000);
  // s2: no draft, no confirm

  // Step 0: A=attack vs B=GRASS → B takes 2 damage. B's yourHp after step = 8.
  const step0_s2 = await common.waitForEvent(s2, 'step_reveal', 5000);
  if (step0_s2.yourCard !== 'GRASS' || step0_s2.oppCard !== 'attack') {
    throw new Error(`G: step0 s2 expected yourCard=GRASS oppCard=attack, got yourCard=${step0_s2.yourCard} oppCard=${step0_s2.oppCard}. ${diag(logBuffer, matchId)}`);
  }
  if (step0_s2.yourHp !== 8) {
    throw new Error(`G: step0 s2 yourHp expected 8 (10-2), got ${step0_s2.yourHp}. ${diag(logBuffer, matchId)}`);
  }

  await common.waitForEvent(s2, 'step_reveal', 3000);
  await common.waitForEvent(s2, 'step_reveal', 3000);
  await common.waitForEvent(s2, 'round_end', 3000);

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
