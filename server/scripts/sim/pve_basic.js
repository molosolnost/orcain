/**
 * PvE scenario C: start and finish. pve_start, match_found, prep_start, then
 * layout_confirm for up to 15 rounds until match_end. pot=0, no crash, no INVARIANT_FAIL.
 * Uses attachEventBuffer + waitForEventBuffered so prep_start is never lost when the
 * server emits it before we await.
 */
const common = require('./common');

async function run(port, logBuffer) {
  const s = await common.connectClient(port);
  common.attachEventBuffer(s, ['match_found', 'prep_start', 'match_end']);
  console.log('[sim] Scenario C: pve_basic expecting: match_found, prep_start, match_end');

  const pMatch = common.waitForEventBuffered(s, 'match_found', { timeoutMs: 6000 });
  const pPrep = common.waitForEventBuffered(s, 'prep_start', { timeoutMs: 6000 });
  s.emit('pve_start');

  const mf = await pMatch;
  if (mf.pot != null && mf.pot !== 0) throw new Error(`PvE expected pot=0, got ${mf.pot}`);
  await pPrep;

  const layout = ['attack', 'defense', 'heal'];
  let rounds = 0;
  const maxRounds = 15;

  while (rounds < maxRounds) {
    s.emit('layout_confirm', { layout: [...layout] });
    await common.waitForEvent(s, 'confirm_ok', 2000);

    for (let i = 0; i < 3; i++) await common.waitForEvent(s, 'step_reveal', 3000);

    const ac1 = { aborted: false };
    const re = await Promise.race([
      common.waitForEvent(s, 'round_end', 5000).then((d) => { ac1.aborted = true; return { e: 'round_end', d }; }).catch(() => new Promise(() => {})),
      common.waitForEventBuffered(s, 'match_end', { timeoutMs: 5000, signal: ac1 }).then((d) => { ac1.aborted = true; return { e: 'match_end', d }; }).catch((e) => (e?.message === 'aborted' ? new Promise(() => {}) : Promise.reject(e)))
    ]);
    if (re.e === 'match_end') break;
    rounds++;
    const ac2 = { aborted: false };
    const next = await Promise.race([
      common.waitForEventBuffered(s, 'prep_start', { timeoutMs: 4000, signal: ac2 }).then((d) => { ac2.aborted = true; return { e: 'prep_start', d }; }).catch((e) => (e?.message === 'aborted' ? new Promise(() => {}) : Promise.reject(e))),
      common.waitForEventBuffered(s, 'match_end', { timeoutMs: 4000, signal: ac2 }).then((d) => { ac2.aborted = true; return { e: 'match_end', d }; }).catch((e) => (e?.message === 'aborted' ? new Promise(() => {}) : Promise.reject(e)))
    ]);
    if (next.e === 'match_end') break;
  }

  common.assertNoInvariantFail(logBuffer);
  s.disconnect();
}

module.exports = { run };
