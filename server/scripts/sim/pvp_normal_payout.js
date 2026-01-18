/**
 * Economy: PvP normal win => winner gets pot. Loser stays at (start-1).
 */
const common = require('./common');

async function run(port, logBuffer) {
  const s1 = await common.connectClient(port);
  const s2 = await common.connectClient(port);
  common.attachEventBuffer(s1, ['prep_start', 'match_end']);
  common.attachEventBuffer(s2, ['prep_start', 'match_end']);

  s1.emit('queue_join');
  s2.emit('queue_join');

  await Promise.all([
    common.waitForEvent(s1, 'prep_start', 3000),
    common.waitForEvent(s2, 'prep_start', 3000)
  ]);

  // P1 [attack,defense,heal] vs P2 [heal,defense,counter]: P2 -2 HP/round (attack vs heal), 5 rounds to 0.
  const p1Layout = ['attack', 'defense', 'heal'];
  const p2Layout = ['heal', 'defense', 'counter'];
  for (let r = 0; r < 6; r++) {
    const p1 = common.waitForEvent(s1, 'confirm_ok', 2000);
    const p2 = common.waitForEvent(s2, 'confirm_ok', 2000);
    s1.emit('layout_confirm', { layout: [...p1Layout] });
    s2.emit('layout_confirm', { layout: [...p2Layout] });
    await Promise.all([p1, p2]);
    for (let i = 0; i < 3; i++) {
      await common.waitForEvent(s1, 'step_reveal', 3000);
    }
    const re = await Promise.race([
      common.waitForEvent(s1, 'round_end', 3000).then(() => 'round'),
      common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 3000 }).then(() => 'match')
    ]);
    if (re === 'match') break;
    await common.waitForEventBuffered(s1, 'prep_start', { timeoutMs: 3000 });
  }

  const me1 = await common.waitForEventBuffered(s1, 'match_end', { timeoutMs: 5000 });
  const me2 = await common.waitForEventBuffered(s2, 'match_end', { timeoutMs: 5000 });

  const winnerTokens = me1.winner === 'YOU' ? me1.yourTokens : me2.yourTokens;
  const loserTokens = me1.winner === 'YOU' ? me2.yourTokens : me1.yourTokens;

  // Winner: 10 - 1 + 2 = 11. Loser: 10 - 1 = 9.
  if (winnerTokens !== 11) throw new Error(`Winner expected yourTokens=11, got ${winnerTokens}`);
  if (loserTokens !== 9) throw new Error(`Loser expected yourTokens=9, got ${loserTokens}`);

  common.assertNoInvariantFail(logBuffer);
  s1.disconnect();
  s2.disconnect();
}

module.exports = { run };
