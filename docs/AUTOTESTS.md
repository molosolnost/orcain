# Automated Regression Tests (PvP / PvE)

Automated, repeatable tests for core gameplay (PvP, PvE, AFK, Partial Play, GRASS, invariants).

## How to run locally

```bash
# Smoke only: client build + node -c server/index.js, server/cards.js
npm run test:smoke

# Full: smoke + sim scenarios A–H
npm run test:sim
```

- **test:smoke**: client `npm run build`, `node -c server/index.js`, `node -c server/cards.js`
- **test:sim**: runs test:smoke, then `server/scripts/sim/run_all.js` (A–H). Server: `TEST_MODE=1`, `TEST_PREP_MS=300`, `TEST_STEP_MS=50`.

## Env (sim only, server)

| Env | Default in sim | Effect |
|-----|----------------|--------|
| `TEST_MODE` | `1` | Enables test timings (only when `1` or `true`) |
| `TEST_PREP_MS` | `300` | PREP phase length in ms (prod: 20000) |
| `TEST_STEP_MS` | `50` | Delay between reveal steps (prod: 900) |
| `PORT` | `3010` | Server port for sim |

Prod timings are unchanged when `TEST_MODE` is unset.

## What each scenario checks

### A) pvp_basic — both confirm 3 cards

- Two clients: queue_join, prep_start, both layout_confirm 3 cards.
- Asserts: step_reveal x3, round_end, matchId, yourHp, no `[INVARIANT_FAIL]`.

### B) pvp_partial_play — 1 card, no confirm (Partial Play)

- Client1: layout_draft `[attack, null, null]` after prep_start. Client2: nothing.
- Asserts: step_reveal; Client1 `yourCard==='attack'`, Client2 `yourCard==='GRASS'`.

### C) pve_basic — start and finish

- One client: pve_start, match_found, prep_start. Loop: layout_confirm, step_reveal, round_end or match_end.
- Asserts: pot=0, no crash, no `[INVARIANT_FAIL]`.

### D) pvp_partial_play_no_confirm — partial, no confirm; B confirms

- A: layout_draft `['attack',null,null]` only. B: layout_confirm 3.
- Asserts: A not AFK (first step yourCard==='attack'), round plays, prep_start round 2 (no match_end).

### E) pvp_both_afk_two_rounds — both AFK 2 rounds → timeout

- Both do nothing 2 rounds. Asserts: match_end reason=timeout after prep_start round 2.

### F) pvp_one_afk_two_rounds — one AFK 2 rounds → afk

- A: nothing. B: layout_confirm each round. Asserts: match_end reason=timeout, winnerId and loserId set.

### G) pvp_attack_vs_grass — ATTACK vs GRASS → 2 damage

- A: layout_confirm [attack,...]. B: nothing (GRASS). Asserts: B's yourHp=8 after step 0.

### H) pvp_endmatch_idempotent — one match_end per client

- Both AFK 2 rounds. Asserts: match_end count 1 per client, no `[INVARIANT_FAIL]`.

## How to read failures

- **`[INVARIANT_FAIL]` in server logs**: `assertNoInvariantFail` throws; fix invariant or scenario.
- **`step_reveal timeout`**: Check PREP/step timings; include `logBuffer` tail in error.
- **`yourCard expected 'attack', got '...'`**: Partial Play regression; drafted card replaced by GRASS.
- **`match_end reason expected 'timeout'`**: AFK/both-afk logic regression.

## Structure

- `server/scripts/sim/common.js` — re-exports sim_utils, `connectClient(port)`.
- `server/scripts/sim/pvp_basic.js` — A.
- `server/scripts/sim/pvp_partial_play.js` — B.
- `server/scripts/sim/pve_basic.js` — C.
- `server/scripts/sim/pvp_partial_play_no_confirm.js` — D.
- `server/scripts/sim/pvp_both_afk_two_rounds.js` — E.
- `server/scripts/sim/pvp_one_afk_two_rounds.js` — F.
- `server/scripts/sim/pvp_attack_vs_grass.js` — G.
- `server/scripts/sim/pvp_endmatch_idempotent.js` — H.
- `server/scripts/sim/run_all.js` — starts server (TEST_PREP_MS=300, TEST_STEP_MS=50), runs A–H, `assertNoInvariantFail`.
- `server/scripts/lib/sim_utils.js` — `startServer`, `stopServer`, `waitForServerReady`, `waitForEvent`, `attachEventBuffer`, `waitForEventBuffered`, `assertNoInvariantFail`.

## Adding a scenario

1. Add `server/scripts/sim/your_scenario.js` with `module.exports = { run };` and `run(port, logBuffer)`.
2. In `run_all.js`: `require('./your_scenario')` and `await yourScenario.run(PORT, logBuffer);`.
3. Use `common.connectClient(port)`, `common.waitForEvent`, `common.assertNoInvariantFail`, and, on step_reveal timeout, include a tail of `logBuffer` in the error.
