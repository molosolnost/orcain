/**
 * PvP scenario D: Partial play, no confirm.
 * A: layout_draft ['attack', null, null] only. B: layout_confirm 3 cards.
 * Expect: A hadDraft=true, empty slots→GRASS, round plays, next prep_start (no match_end).
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

  // A: draft only. B: confirm 3 cards.
  s1.emit('layout_draft', { matchId, layout: ['attack', null, null] });
  s2.emit('layout_confirm', { matchId, layout: ['attack', 'defense', 'heal'] });
  await common.waitForEvent(s2, 'confirm_ok', 2000);

  // step_reveal x3: A must have at least one real card (attack in slot0)
  const d1 = await common.waitForEvent(s1, 'step_reveal', 5000);
  if (d1.yourCard !== 'attack') {
    throw new Error(`D: s1 first step yourCard expected 'attack', got '${d1.yourCard}'. ${diag(logBuffer, matchId)}`);
  }
  await common.waitForEvent(s1, 'step_reveal', 3000);
  await common.waitForEvent(s1, 'step_reveal', 3000);
  await common.waitForEvent(s1, 'round_end', 5000);

  // Next must be prep_start (round 2). If match_end = fail (A must not be AFK).
  const ac = { aborted: false };
  const next = await Promise.race([
    common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: 6000, predicate: (p) => p.roundIndex === 2, signal: ac }).then((d) => { ac.aborted = true; return { e: 'prep_start', d }; }).catch((e) => { if ((e?.message || '').includes('aborted') || (e?.message || '').includes('Timeout')) return new Promise(() => {}); return Promise.reject(e); }),
    common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 6000, signal: ac }).then((d) => { ac.aborted = true; return { e: 'match_end', d }; }).catch((e) => { if ((e?.message || '').includes('aborted') || (e?.message || '').includes('Timeout')) return new Promise(() => {}); return Promise.reject(e); })
  ]);
  if (next.e === 'match_end') {
    throw new Error(`D: match ended (match_end) — partial play must NOT be AFK. ${diag(logBuffer, matchId)}`);
  }
  if (next.e !== 'prep_start') throw new Error(`D: expected prep_start or match_end, got ${next?.e}. ${diag(logBuffer, matchId)}`);

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
