/**
 * Economy / Token system: PvP paid, PvE free.
 * All token changes MUST go through this module.
 */
const db = require('./db');

/** Cost to start a PvP match (per player). pot = COST_PVP_START * 2. */
const COST_PVP_START = 1;

/**
 * @param {string} accountId
 * @returns {{ can: boolean, reason?: string }}
 */
function canStartPvp(accountId) {
  const t = db.getTokens(accountId);
  if (t === null) return { can: false, reason: 'tokens_null' };
  if (t < COST_PVP_START) return { can: false, reason: 'not_enough_tokens' };
  return { can: true };
}

/**
 * Charge COST_PVP_START from account for this match. Idempotent.
 * @param {string} accountId
 * @param {object} match - must have match.econCharged = {} (or already charged)
 * @returns {boolean} true if charged or already charged, false if deduct failed
 */
function chargePvpStart(accountId, match) {
  if (!match.econCharged) match.econCharged = {};
  if (match.econCharged[accountId] === true) {
    console.log(`[ECON_CHARGE_DUPLICATE] accountId=${accountId} matchId=${match.id}`);
    return true;
  }
  const before = db.getTokens(accountId);
  const ok = db.deductTokens(accountId, COST_PVP_START);
  if (!ok) return false;
  const after = db.getTokens(accountId);
  match.econCharged[accountId] = true;
  console.log(`[ECON_CHARGE] accountId=${accountId} matchId=${match.id} cost=${COST_PVP_START} tokensBefore=${before} tokensAfter=${after}`);
  return true;
}

/**
 * Settle PvP pot: pay winner or burn. PvE is always skip.
 * @param {object} match - { mode, pot, id }
 * @param {string} reason - 'normal' | 'timeout' | 'disconnect'
 * @param {string|null} winnerAccountId - null for both-afk (burn)
 */
function settleMatchPayout(match, reason, winnerAccountId) {
  if (match.mode === 'PVE') {
    console.log(`[ECON_SETTLE] matchId=${match.id} reason=${reason} action=skip (PVE)`);
    return;
  }
  if (match.pot < 0) {
    console.log(`[ECON_GUARD_FAIL] matchId=${match.id} pot=${match.pot} (negative, skip)`);
    return;
  }
  if (reason === 'timeout' && !winnerAccountId) {
    console.log(`[ECON_SETTLE] matchId=${match.id} reason=${reason} pot=${match.pot} action=burn`);
    return;
  }
  if (winnerAccountId && match.pot > 0) {
    db.addTokens(winnerAccountId, match.pot);
    console.log(`[ECON_SETTLE] matchId=${match.id} reason=${reason} pot=${match.pot} winnerAcc=${winnerAccountId} action=paid`);
  }
}

module.exports = {
  COST_PVP_START,
  canStartPvp,
  chargePvpStart,
  settleMatchPayout
};
