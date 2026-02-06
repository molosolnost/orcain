/**
 * PvE scenario C: start and finish. pve_start, match_found, prep_start, then
 * layout_confirm for up to 15 rounds until match_end. pot=0, no crash, no INVARIANT_FAIL.
 * Uses attachEventBuffer + waitForEventBuffered so prep_start is never lost when the
 * server emits it before we await.
 */
const common = require('./common');

async function waitEither(socket, leftName, leftOpts, rightName, rightOpts) {
  const ac = { aborted: false };
  return Promise.race([
    common
      .waitForEventBuffered(socket, leftName, { ...leftOpts, signal: ac })
      .then((payload) => {
        ac.aborted = true;
        return { event: leftName, payload };
      })
      .catch((e) => (e?.message === 'aborted' ? new Promise(() => {}) : Promise.reject(e))),
    common
      .waitForEventBuffered(socket, rightName, { ...rightOpts, signal: ac })
      .then((payload) => {
        ac.aborted = true;
        return { event: rightName, payload };
      })
      .catch((e) => (e?.message === 'aborted' ? new Promise(() => {}) : Promise.reject(e))),
  ]);
}

async function run(port, logBuffer) {
  const s = await common.connectClient(port);
  common.attachEventBuffer(s, ['match_found', 'prep_start', 'confirm_ok', 'round_end', 'match_end']);
  console.log('[sim] Scenario C: pve_basic expecting: match_found, prep_start, match_end');

  const pMatch = common.waitForEventBuffered(s, 'match_found', { timeoutMs: 6000 });
  const pPrep = common.waitForEventBuffered(s, 'prep_start', { timeoutMs: 6000 });
  s.emit('pve_start');

  const mf = await pMatch;
  if (mf.pot != null && mf.pot !== 0) throw new Error(`PvE expected pot=0, got ${mf.pot}`);
  let prep = await pPrep;

  const layout = ['attack', 'defense', 'heal'];
  const maxRounds = 15;
  let rounds = 0;

  while (rounds < maxRounds) {
    const currentRound = prep.roundIndex;
    s.emit('layout_confirm', { layout: [...layout] });

    const confirmOrEnd = await waitEither(
      s,
      'confirm_ok',
      { timeoutMs: 2500 },
      'match_end',
      { timeoutMs: 2500, predicate: (p) => p?.matchId === mf.matchId }
    );
    if (confirmOrEnd.event === 'match_end') {
      break;
    }

    const roundOrEnd = await waitEither(
      s,
      'round_end',
      { timeoutMs: 6000, predicate: (p) => p?.matchId === mf.matchId && p?.roundIndex === currentRound },
      'match_end',
      { timeoutMs: 6000, predicate: (p) => p?.matchId === mf.matchId }
    );
    if (roundOrEnd.event === 'match_end') {
      break;
    }

    rounds++;
    const prepOrEnd = await waitEither(
      s,
      'prep_start',
      { timeoutMs: 4000, predicate: (p) => p?.matchId === mf.matchId && p?.roundIndex > currentRound },
      'match_end',
      { timeoutMs: 4000, predicate: (p) => p?.matchId === mf.matchId }
    );
    if (prepOrEnd.event === 'match_end') {
      console.log('[sim] pve_basic: match ended after round_end — OK');
      break;
    }
    prep = prepOrEnd.payload;
  }

  common.assertNoInvariantFail(logBuffer);
  s.disconnect();
}

module.exports = { run };
