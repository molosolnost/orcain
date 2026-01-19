/**
 * PvP scenario H: endMatch idempotency — one match_end per client, no crash.
 * Both AFK 2 rounds → match_end. Both clients must receive exactly 1 match_end.
 * Attach buffers BEFORE queue_join so no event is lost; await match_end on BOTH
 * with separate predicates (no shared abort). Verify buffer has no extras after.
 */
const common = require('./common');

function diag(s1, s2, matchId, label) {
  const b1 = s1._simBuffer || { buffer: {}, last: {} };
  const b2 = s2._simBuffer || { buffer: {}, last: {} };
  const sum = (buf) =>
    Object.entries(buf.buffer || {}).map(([e, arr]) => ({
      event: e,
      count: (arr || []).length,
      last: buf.last ? buf.last[e] : undefined
    }));
  console.error(`[sim][H diag] ${label || 'failure'}`);
  console.error(`  matchId=${matchId || 'n/a'} s1.id=${s1.id} s2.id=${s2.id}`);
  console.error('  s1:', JSON.stringify(sum(b1)));
  console.error('  s2:', JSON.stringify(sum(b2)));
}

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);

  common.attachEventBuffer(s1, ['match_found', 'prep_start', 'match_end', 'error_msg']);
  common.attachEventBuffer(s2, ['match_found', 'prep_start', 'match_end', 'error_msg']);

  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEvent(s1, 'prep_start', 3000),
    common.waitForEvent(s2, 'prep_start', 3000)
  ]);
  const matchId = prep1.matchId || prep2.matchId;
  if (!matchId) {
    diag(s1, s2, null, 'prep_start missing matchId');
    throw new Error('H: prep_start missing matchId');
  }

  const pEnd1 = common.waitForEventBuffered(s1, 'match_end', {
    predicate: (p) => p.matchId === matchId,
    timeoutMs: 8000
  });
  const pEnd2 = common.waitForEventBuffered(s2, 'match_end', {
    predicate: (p) => p.matchId === matchId,
    timeoutMs: 8000
  });

  for (let i = 0; i < 3; i++) await common.waitForEvent(s1, 'step_reveal', 5000);
  await common.waitForEvent(s1, 'round_end', 5000);

  await common.waitForEventBuffered(s1, 'prep_start', {
    timeoutMs: 5000,
    predicate: (p) => p.roundIndex === 2
  });

  let end1, end2;
  try {
    [end1, end2] = await Promise.all([pEnd1, pEnd2]);
  } catch (e) {
    diag(s1, s2, matchId, 'match_end timeout or error');
    throw e;
  }

  const b1 = s1._simBuffer || {};
  const b2 = s2._simBuffer || {};
  const rem1 = (b1.buffer && b1.buffer['match_end']) ? b1.buffer['match_end'].length : 0;
  const rem2 = (b2.buffer && b2.buffer['match_end']) ? b2.buffer['match_end'].length : 0;
  if (rem1 > 0 || rem2 > 0) {
    diag(s1, s2, matchId, 'idempotency fail: extra match_end in buffer');
    throw new Error(`H: idempotency fail s1.match_end_remain=${rem1} s2.match_end_remain=${rem2}`);
  }

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
