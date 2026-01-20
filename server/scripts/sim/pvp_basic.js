/**
 * PvP scenario A: both confirm 3 cards.
 * Expect: step_reveal x3, round_end, no INVARIANT_FAIL.
 * Uses buffered events and confirm_ok|error_msg|match_end race to avoid CI flakiness.
 */
const common = require('./common');

const confirmTimeoutMs = process.env.CI ? 10000 : 4000;
const stepTimeoutMs = process.env.CI ? 6000 : 3000;

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);

  common.attachEventBuffer(s1, ['match_found', 'prep_start', 'confirm_ok', 'error_msg', 'step_reveal', 'round_end', 'match_end']);
  common.attachEventBuffer(s2, ['match_found', 'prep_start', 'confirm_ok', 'error_msg', 'step_reveal', 'round_end', 'match_end']);

  s1.emit('queue_join');
  s2.emit('queue_join');

  const [prep1, prep2] = await Promise.all([
    common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: confirmTimeoutMs }),
    common.waitForEventBuffered(s2, 'prep_start', { timeoutMs: confirmTimeoutMs })
  ]);
  if (!prep1.matchId || prep1.matchId !== prep2.matchId) throw new Error('matchId mismatch');
  if (typeof prep1.yourHp !== 'number') throw new Error('yourHp not number');
  const matchId = prep1.matchId;

  const layout = ['attack', 'defense', 'heal'];
  console.log('[sim] sending confirm matchId=' + matchId + ' layout=' + JSON.stringify(layout));

  const waitConfirm = (s) =>
    Promise.race([
      common.waitForEventBuffered(s, 'confirm_ok', { timeoutMs: confirmTimeoutMs, predicate: () => true }).then(() => 'ok'),
      common.waitForEventBuffered(s, 'error_msg', { timeoutMs: confirmTimeoutMs, predicate: () => true }).then((p) => {
        console.error('[sim] recv error_msg code=' + (p?.code || '') + ' msg=' + (p?.message || ''));
        throw new Error('[sim] confirm rejected: ' + (p?.code || '') + ' ' + (p?.message || ''));
      }),
      common.waitForEventBuffered(s, 'match_end', { timeoutMs: confirmTimeoutMs, predicate: (p) => p && p.matchId === matchId }).then((p) => {
        throw new Error('[sim] match_end before confirm_ok (race): matchId=' + matchId + ' payload=' + JSON.stringify(p));
      })
    ]);

  s1.emit('layout_confirm', { layout: [...layout] });
  s2.emit('layout_confirm', { layout: [...layout] });
  await waitConfirm(s1);
  await waitConfirm(s2);

  for (let i = 0; i < 3; i++) {
    const ev = await common.waitForEventBuffered(s1, 'step_reveal', { timeoutMs: stepTimeoutMs, predicate: (p) => p && p.matchId === matchId });
    if (typeof ev.yourHp !== 'number') throw new Error('step_reveal yourHp not number');
  }
  await common.waitForEventBuffered(s1, 'round_end', { timeoutMs: stepTimeoutMs, predicate: (p) => p && p.matchId === matchId });

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
