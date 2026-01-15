# Regression Test Checklist

This document provides a manual test checklist to verify that battle rules are not regressed after code changes.

## Prerequisites

1. Server running locally or on staging
2. Two test accounts (or two browser windows with different accounts)
3. Access to server logs (for invariant checks)

## Test Scenarios

### Test 1: Both AFK 1 Round → NO endMatch

**Expected**: Match continues to Round 2

**Steps**:
1. Start a match between two players
2. Both players do NOTHING in Round 1 PREP (no draft, no confirm)
3. Wait for PREP timeout (20 seconds)
4. Verify:
   - Match continues to Round 2
   - No `match_end` event received
   - Server log shows `[FINALIZE_ROUND] decision=continue`
   - `bothAfkStreak = 1` (not >= 2)

**Pass Criteria**:
- ✅ Match does NOT end after Round 1
- ✅ Round 2 PREP starts
- ✅ No `[INVARIANT_FAIL]` errors in logs

---

### Test 2: Both AFK 2 Rounds → endMatch(timeout), pot burn

**Expected**: Match ends after Round 2, pot burns, both players lose

**Steps**:
1. Start a match between two players
2. Both players do NOTHING in Round 1 PREP
3. Wait for Round 1 to complete
4. Both players do NOTHING in Round 2 PREP
5. Wait for PREP timeout
6. Verify:
   - `match_end` event received with `reason="timeout"`
   - `winner="OPPONENT"` (both lose)
   - Pot does NOT go to either player
   - Server log shows `[FINALIZE_ROUND_DECISION] decision=endMatch reason=timeout_both`
   - `bothAfkStreak = 2` (>= 2)

**Pass Criteria**:
- ✅ Match ends after Round 2 (not Round 1)
- ✅ Pot burns (no tokens added to either account)
- ✅ Both players see "Match timed out"
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 3: One AFK 2 Rounds → endMatch(afk), pot to winner

**Expected**: Match ends after Round 2, active player wins, pot goes to winner

**Steps**:
1. Start a match between Player A and Player B
2. Round 1:
   - Player A: Drafts and confirms cards (active)
   - Player B: Does NOTHING (AFK)
3. Wait for Round 1 to complete
4. Round 2:
   - Player A: Drafts and confirms cards (active)
   - Player B: Does NOTHING (AFK)
5. Wait for PREP timeout
6. Verify:
   - `match_end` event received with `reason="timeout"`
   - Player A wins (gets pot)
   - Player B loses
   - Server log shows `[FINALIZE_ROUND_DECISION] decision=endMatch reason=afk_p2` (or afk_p1)
   - `afkStreakByPlayer[B] = 2` (>= 2)

**Pass Criteria**:
- ✅ Match ends after Round 2 (not Round 1)
- ✅ Active player wins and receives pot
- ✅ AFK player loses
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 4: Partial Play → NOT AFK

**Expected**: Player with partial draft is NOT considered AFK

**Steps**:
1. Start a match between two players
2. Round 1:
   - Player A: Drafts 1 card (e.g., `[ATTACK, null, null]`), does NOT confirm
   - Player B: Drafts and confirms 3 cards
3. Wait for PREP timeout
4. Verify:
   - Player A's final layout: `[ATTACK, GRASS, GRASS]` (null filled with GRASS)
   - Player A is NOT AFK (`hadDraftThisRound = true`)
   - Match continues normally
   - Server log shows `p1_hadDraft=true p1_afk=false`

**Pass Criteria**:
- ✅ Partial play does NOT count as AFK
- ✅ Match continues normally
- ✅ Final layout has GRASS in empty slots
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 5: ATTACK vs GRASS → damage applies

**Expected**: ATTACK deals damage when opponent plays GRASS

**Steps**:
1. Start a match between two players
2. Round 1:
   - Player A: Confirms `[ATTACK, ATTACK, ATTACK]`
   - Player B: Does NOTHING (will get `[GRASS, GRASS, GRASS]`)
3. Wait for reveal phase
4. Verify:
   - Step 1: ATTACK vs GRASS → Player B takes 2 damage
   - Step 2: ATTACK vs GRASS → Player B takes 2 damage
   - Step 3: ATTACK vs GRASS → Player B takes 2 damage
   - Player B's HP decreases by 6 total (3 steps × 2 damage)

**Pass Criteria**:
- ✅ ATTACK deals damage vs GRASS
- ✅ GRASS does NOT block ATTACK
- ✅ HP updates correctly
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 6: endMatch double-call protected

**Expected**: Multiple calls to endMatch are idempotent (no double-ending)

**Steps**:
1. Start a match
2. Trigger a match end condition (e.g., both AFK 2 rounds)
3. Manually verify (in code/logs) that:
   - `endMatch()` is called
   - If `endMatch()` is called again, it's ignored
   - Server log shows `[INVARIANT_FAIL] code=ENDMATCH_IDEMPOTENT` if double-called
   - Only ONE `match_end` event is sent to each player

**Pass Criteria**:
- ✅ `match.state === 'ended'` prevents double-ending
- ✅ Guards log `[INVARIANT_FAIL]` if violated
- ✅ Only one `match_end` event per player

---

## Additional Checks

### Invariant Verification

After running tests, check server logs for:
- ❌ `[INVARIANT_FAIL]` - Should be NONE in normal operation
- ✅ `[FINALIZE_ROUND]` - Should appear once per round
- ✅ `[FINALIZE_ROUND_DECISION]` - Should show correct decision
- ✅ `[MATCH_END]` - Should appear when match ends
- ✅ `[STATE_TRANSITION]` - Should show state changes

### Phase Correctness

Verify that:
- `layout_draft` only accepted in `state === 'prep'`
- `layout_confirm` only accepted in `state === 'prep'`
- `step_reveal` only sent when `state === 'playing'`

### HP Sanity

Verify that:
- HP never goes below 0
- HP never exceeds MAX_HP (10)
- HEAL caps at MAX_HP

---

## Running Tests

### Quick Test (All Scenarios)

```bash
# Start server with debug mode
DEBUG_MATCH=1 node server/index.js

# Run tests in sequence:
# 1. Test 1 (Both AFK 1 round)
# 2. Test 2 (Both AFK 2 rounds)
# 3. Test 3 (One AFK 2 rounds)
# 4. Test 4 (Partial play)
# 5. Test 5 (ATTACK vs GRASS)
# 6. Test 6 (Double endMatch - manual code check)
```

### Automated Test (Future)

A future enhancement could automate these tests using a test harness that:
- Simulates socket connections
- Sends events programmatically
- Verifies invariants automatically

---

## Notes

- These tests are **manual** and require human verification
- Server logs are critical for debugging invariant failures
- Test on staging before production
- Document any new regressions found

---

**Last Updated**: 2025-01-15
