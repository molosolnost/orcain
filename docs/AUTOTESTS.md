# Automated Regression Tests (PvP / PvE)

Automated, repeatable tests for core gameplay (PvP, PvE, AFK, Partial Play, GRASS, invariants).

## How to run locally

```bash
# Smoke only: client build + node -c server/index.js, server/cards.js
npm run test:smoke

# Full: smoke + sim scenarios A, B, C
npm run test:sim
```

- **test:smoke** (D): client `npm run build`, `node -c server/index.js`, `node -c server/cards.js`
- **test:sim**: runs test:smoke, then `server/scripts/sim/run_all.js` (A: pvp_basic, B: pvp_partial_play, C: pve_basic). Server is started with `TEST_MODE=1`, `TEST_PREP_MS=1200`, `TEST_STEP_MS=50`.

## Env (sim only, server)

| Env | Default in sim | Effect |
|-----|----------------|--------|
| `TEST_MODE` | `1` | Enables test timings (only when `1` or `true`) |
| `TEST_PREP_MS` | `1200` | PREP phase length in ms (prod: 20000) |
| `TEST_STEP_MS` | `50` | Delay between reveal steps (prod: 900) |
| `PORT` | `3010` | Server port for sim |

Prod timings are unchanged when `TEST_MODE` is unset.

## What each scenario checks

### A) pvp_basic — both confirm 3 cards

- Two clients: hello, queue_join, match_found, prep_start.
- Both send layout_confirm with 3 cards.
- Asserts: step_reveal x3, round_end, matchId consistent, yourHp numbers, no `[INVARIANT_FAIL]`.

### B) pvp_partial_play — 1 card, no confirm (Partial Play)

- Client1: layout_draft `[attack, null, null]` **immediately after** prep_start.
- Client2: no draft, no confirm.
- Asserts:
  - step_reveal arrives (timeout 5s); on timeout, dumps last 50 lines of server log.
  - stepIndex=0: Client1 `yourCard === 'attack'` (not GRASS), Client2 `yourCard === 'GRASS'`.
- Uses `TEST_PREP_MS=1200` so draft is applied before the prep timer.

### C) pve_basic — start and finish

- One client: pve_start, match_found, prep_start.
- Loop: layout_confirm, 3× step_reveal, round_end or match_end; up to 15 rounds.
- Asserts: pot=0 in match_found, no crash, no `[INVARIANT_FAIL]`.

### D) Smoke

- `node -c server/index.js`, `node -c server/cards.js`, `npm run build` (client).

## How to read failures

- **`[INVARIANT_FAIL]` in server logs**: `assertNoInvariantFail` throws; fix invariant or scenario.
- **`step_reveal timeout`**: B fails; message includes `matchId` and last 50 lines of server log. Check PREP/step timings and that draft is sent right after prep_start.
- **`yourCard expected 'attack', got '...'`**: Partial Play regression; drafted card was replaced (e.g. by GRASS).
- **`yourCard expected 'GRASS', got '...'`**: Client2 (AFK) did not get GRASS in that step.

## Structure

- `server/scripts/sim/common.js` — re-exports sim_utils, `connectClient(port)` (creates guest account and connects).
- `server/scripts/sim/pvp_basic.js` — scenario A.
- `server/scripts/sim/pvp_partial_play.js` — scenario B (Partial Play, TEST_PREP_MS=1200, diagnostics on timeout).
- `server/scripts/sim/pve_basic.js` — scenario C.
- `server/scripts/sim/run_all.js` — starts server (TEST_PREP_MS=1200, TEST_STEP_MS=50), runs A, B, C, stops server, `assertNoInvariantFail`.
- `server/scripts/lib/sim_utils.js` — `startServer`, `stopServer`, `waitForServerReady`, `waitForEvent`, `assertNoInvariantFail`, `connectClient(port, account)`.

## Adding a scenario

1. Add `server/scripts/sim/your_scenario.js` with `module.exports = { run };` and `run(port, logBuffer)`.
2. In `run_all.js`: `require('./your_scenario')` and `await yourScenario.run(PORT, logBuffer);`.
3. Use `common.connectClient(port)`, `common.waitForEvent`, `common.assertNoInvariantFail`, and, on step_reveal timeout, include a tail of `logBuffer` in the error.
