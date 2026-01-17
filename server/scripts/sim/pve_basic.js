/**
 * PvE scenario C: start and finish. pve_start, match_found, prep_start, then
 * layout_confirm for up to 15 rounds until match_end. pot=0, no crash, no INVARIANT_FAIL.
 */
const common = require('./common');

async function run(port, logBuffer) {
  const s = await common.connectClient(port);
  s.emit('pve_start');

  const mf = await common.waitForEvent(s, 'match_found', 3000);
  if (mf.pot != null && mf.pot !== 0) throw new Error(`PvE expected pot=0, got ${mf.pot}`);

  await common.waitForEvent(s, 'prep_start', 3000);

  const layout = ['attack', 'defense', 'heal'];
  let rounds = 0;
  const maxRounds = 15;

  while (rounds < maxRounds) {
    s.emit('layout_confirm', { layout: [...layout] });
    await common.waitForEvent(s, 'confirm_ok', 2000);

    for (let i = 0; i < 3; i++) await common.waitForEvent(s, 'step_reveal', 3000);

    const re = await Promise.race([
      common.waitForEvent(s, 'round_end', 5000).then((d) => ({ e: 'round_end', d })),
      common.waitForEvent(s, 'match_end', 5000).then((d) => ({ e: 'match_end', d }))
    ]);
    if (re.e === 'match_end') break;
    rounds++;
    await common.waitForEvent(s, 'prep_start', 4000);
  }

  common.assertNoInvariantFail(logBuffer);
  s.disconnect();
}

module.exports = { run };
