/**
 * Economy: PvE => tokens unchanged (no charge, no payout).
 */
const simUtils = require('../lib/sim_utils');
const db = require('../../db');
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
  const acc = db.createGuestAccount();
  const tBefore = db.getTokens(acc.accountId);

  const s = await simUtils.connectClient(port, acc);
  common.attachEventBuffer(s, ['match_found', 'prep_start', 'confirm_ok', 'round_end', 'match_end']);

  s.emit('pve_start');
  const mf = await common.waitForEventBuffered(s, 'match_found', { timeoutMs: 3000 });
  let prep = await common.waitForEventBuffered(s, 'prep_start', { timeoutMs: 3000 });

  const layout = ['attack', 'defense', 'heal'];
  let gotMatchEnd = false;
  for (let r = 0; r < 10; r++) {
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
      gotMatchEnd = true;
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
      gotMatchEnd = true;
      break;
    }

    const prepOrEnd = await waitEither(
      s,
      'prep_start',
      { timeoutMs: 4000, predicate: (p) => p?.matchId === mf.matchId && p?.roundIndex > currentRound },
      'match_end',
      { timeoutMs: 4000, predicate: (p) => p?.matchId === mf.matchId }
    );
    if (prepOrEnd.event === 'match_end') {
      gotMatchEnd = true;
      break;
    }
    prep = prepOrEnd.payload;
  }
  if (!gotMatchEnd) {
    await common.waitForEventBuffered(s, 'match_end', {
      timeoutMs: 8000,
      predicate: (p) => p?.matchId === mf.matchId
    });
  }

  const tAfter = db.getTokens(acc.accountId);

  if (tAfter !== tBefore) throw new Error(`PvE expected tokens unchanged: before=${tBefore} after=${tAfter}`);

  common.assertNoInvariantFail(logBuffer);
  s.disconnect();
}

module.exports = { run };
