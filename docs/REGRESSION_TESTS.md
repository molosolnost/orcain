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

### Test 6: Disconnect in PREP → disconnect loses, opponent wins

**Expected**: Disconnected player loses immediately, opponent wins, pot goes to winner

**Steps**:
1. Start a match between Player A and Player B
2. In Round 1 PREP:
   - Player A: Drafts cards (or does nothing)
   - Player B: Disconnects (close browser/tab)
3. Wait for disconnect grace period (5 seconds)
4. Verify:
   - `match_end` event received with `reason="disconnect"`
   - Player A wins (gets pot)
   - Player B loses
   - Server log shows `[MATCH_END] reason=disconnect winner=PlayerA loser=PlayerB`
   - Pot goes to Player A

**Pass Criteria**:
- ✅ Match ends immediately on disconnect (no AFK wait)
- ✅ Disconnected player loses
- ✅ Active player wins and receives pot
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 7: Disconnect in REVEAL → disconnect loses, opponent wins

**Expected**: Disconnected player loses immediately during reveal phase

**Steps**:
1. Start a match between Player A and Player B
2. Both players confirm in Round 1 PREP
3. During REVEAL phase (step 0, 1, or 2):
   - Player B: Disconnects (close browser/tab)
4. Wait for disconnect grace period
5. Verify:
   - `match_end` event received with `reason="disconnect"`
   - Player A wins
   - Server log shows `[WATCHDOG] state=playing p2 disconnected`

**Pass Criteria**:
- ✅ Match ends on disconnect during reveal
- ✅ Watchdog handles disconnect in PLAYING state
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 8: Sudden Death → no infinite loop

**Expected**: Match continues until HP difference, then ends normally

**Steps**:
1. Start a match between two players
2. Play 3 rounds with equal HP (both players maintain same HP)
3. Verify:
   - Round 4 starts (sudden death activated)
   - `suddenDeath=true` in prep_start payload
   - Match continues until HP difference occurs
   - Match ends normally when HP differs
   - Server log shows `suddenDeath=true` in round 4+

**Pass Criteria**:
- ✅ Sudden death activates after 3 rounds with equal HP
- ✅ Match continues (no infinite loop)
- ✅ Match ends when HP differs
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 9: endMatch double-call protected

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

### Test 10: PvE Training → no rewards, bot never AFK

**Expected**: PvE match works correctly, bot always plays, no token rewards

**Steps**:
1. Start PvE Training match
2. Play through 1-3 rounds
3. Verify:
   - Bot always submits draft (never AFK)
   - Bot plays cards correctly
   - Match ends normally (HP-based or player disconnect)
   - No tokens added to player account (pot=0)
   - Server log shows `[PVE_MATCH_CREATED]` and `[BOT_LAYOUT_SUBMITTED]`
   - `bothAfkStreak` never grows (bot excluded)

**Pass Criteria**:
- ✅ PvE uses same battle engine as PvP
- ✅ Bot never considered AFK
- ✅ No token rewards
- ✅ Match ends correctly
- ✅ No `[INVARIANT_FAIL]` errors

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

---

## Client Phase Guards

### Test 11: No layout_draft in REVEAL phase

**Expected**: Client never sends `layout_draft` when phase is REVEAL

**Steps**:
1. Start a match
2. Both players confirm in Round 1 PREP
3. Wait for REVEAL phase to begin
4. Try to drag/drop cards (if UI allows)
5. Verify:
   - No `layout_draft` events sent to server
   - Server logs show no `[DRAFT_RECV]` during REVEAL
   - Client debug logs (if enabled) show `[DRAFT_BLOCKED] reason=phase_not_prep phase=REVEAL`

**Pass Criteria**:
- ✅ No `layout_draft` sent in REVEAL
- ✅ No `[INVARIANT_FAIL] PHASE_DRAFT` errors
- ✅ Client guards prevent draft sends outside PREP

---

### Test 12: Debounce cancelled after confirm

**Expected**: After confirm, no pending draft sends until next prep_start

**Steps**:
1. Start a match
2. Player A: Drafts 1 card (triggers debounced draft)
3. Player A: Immediately confirms (before debounce fires)
4. Verify:
   - Confirm sent successfully
   - Debounce timer cancelled
   - No additional `layout_draft` sent after confirm
   - Next round: Draft works normally again

**Pass Criteria**:
- ✅ Debounce cancelled on confirm
- ✅ No draft sends after confirm
- ✅ Next round draft works normally

---

### Test 13: Unmount draft flush only in PREP

**Expected**: Draft only flushed on unmount if still in PREP phase

**Steps**:
1. Start a match
2. Player A: Drafts 1 card in PREP
3. Wait for REVEAL phase
4. Player A: Close browser/tab (unmount)
5. Verify:
   - If unmounted in PREP: Draft flushed (if enabled)
   - If unmounted in REVEAL: Draft NOT flushed, debounce cancelled
   - Server logs show appropriate behavior

**Pass Criteria**:
- ✅ Unmount in PREP: Draft handled correctly
- ✅ Unmount in REVEAL: No draft flush, debounce cancelled
- ✅ No `[INVARIANT_FAIL]` errors

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

### Automated simulator scenarios D–H

The sim `run_all.js` runs scenarios D–H (see `docs/AUTOTESTS.md`):

- **D) pvp_partial_play_no_confirm**: A: layout_draft 1 card, no confirm. B: layout_confirm 3. Expect: A not AFK, empty slots→GRASS, round plays, prep_start round 2 (no match_end).
- **E) pvp_both_afk_two_rounds**: Both do nothing 2 rounds. Expect: match_end reason=timeout after 2nd round.
- **F) pvp_one_afk_two_rounds**: A nothing 2 rounds, B confirm each. Expect: match_end reason=timeout, winnerId/loserId set.
- **G) pvp_attack_vs_grass**: A confirm [attack,...], B nothing. Expect: B's yourHp=8 after step 0 (ATTACK vs GRASS = 2 damage).
- **H) pvp_endmatch_idempotent**: Both AFK 2 rounds. Count match_end per client; expect 1 each. No server crash.

---

## Notes

- These tests are **manual** and require human verification
- Server logs are critical for debugging invariant failures
- Test on staging before production
- Document any new regressions found

---

## Card System Tests

### Test 14: Partial Play (1 card, no confirm) → Card preserved

**Expected**: Player places 1 card, doesn't confirm → card preserved, other slots become GRASS

**Steps**:
1. Start PvP match
2. Round 1 PREP:
   - Player A: Places 1 card (e.g., `'attack'`) in slot 0, does NOT confirm
   - Player B: Confirms 3 cards
3. Wait for PREP timeout
4. Verify:
   - Player A's `finalLayout`: `['attack', GRASS, GRASS]` (card preserved)
   - Player A's `hadDraftThisRound = true` (not AFK)
   - Server log shows `[FINALIZE_CHECK] p1_final=["attack","GRASS","GRASS"]`
   - Round proceeds normally with Player A's attack card

**Pass Criteria**:
- ✅ Partial play card preserved (not replaced with GRASS)
- ✅ Empty slots filled with GRASS
- ✅ Player not considered AFK
- ✅ No `[INVARIANT_FAIL]` errors

---

### Test 15: Invalid card from client → Draft sanitized, Confirm rejected

**Expected**: Invalid cards in draft sanitized to null; invalid cards in confirm rejected

**Steps**:
1. Start PvP match
2. Round 1 PREP:
   - Player A: Sends `layout_draft` with invalid card (e.g., `['invalid_card', null, null]`)
   - Verify: Server sanitizes to `[null, null, null]`, logs `[INVALID_CARD_FROM_CLIENT]`
   - Player A: Sends `layout_confirm` with invalid card (e.g., `['invalid_card', 'attack', 'defense']`)
   - Verify: Server rejects with `error_msg`, logs `[IGNORED_CONFIRM] reason=invalid_cards_from_hand`
3. Verify:
   - Draft with invalid card: sanitized to null (no crash)
   - Confirm with invalid card: rejected (strict validation)

**Pass Criteria**:
- ✅ Draft sanitizes invalid cards (replaces with null)
- ✅ Confirm rejects invalid cards (strict validation)
- ✅ Server logs show `[INVALID_CARD_FROM_CLIENT]` and `[DRAFT_FIXED]`
- ✅ No crashes or `[INVARIANT_FAIL]` errors

---

### Test 16: Hand stable across rounds

**Expected**: Player's hand is identical in `match_found` and all `prep_start` events

**Steps**:
1. Start PvP match
2. Check `match_found` payload: `yourHand = ['attack', 'defense', 'heal', 'counter']`
3. Play Round 1 (both confirm)
4. Check `prep_start` (Round 2): `yourHand = ['attack', 'defense', 'heal', 'counter']` (same)
5. Play Round 2
6. Check `prep_start` (Round 3): `yourHand = ['attack', 'defense', 'heal', 'counter']` (same)

**Pass Criteria**:
- ✅ Hand is identical across all rounds
- ✅ Hand always contains exactly 4 CardIds
- ✅ Hand matches `DEFAULT_HAND` from `server/cards.js`
- ✅ No hand regeneration or changes

---

### Test 17: Duplicate cards in hand → Layout can use duplicates

**Expected**: If hand has duplicates (future deck builder), layout can use them correctly

**Steps**:
1. **Note**: This test requires hand with duplicates (e.g., `['attack', 'attack', 'heal', 'counter']`)
2. **Current**: Default hand has no duplicates, so this test is for future deck builder
3. **Verification**: `validateCardsFromHand` correctly counts duplicates
   - Hand: `['attack', 'attack', 'heal', 'counter']`
   - Layout: `['attack', 'attack', 'heal']` → ✅ Valid (2 attacks used, 2 available)
   - Layout: `['attack', 'attack', 'attack', 'heal']` → ❌ Invalid (3 attacks used, only 2 available)

**Pass Criteria**:
- ✅ `validateCardsFromHand` counts duplicates correctly
- ✅ Layout can use cards up to hand count (not more)
- ✅ Server validation prevents overuse of duplicates

---

## Expected Render Logs (No Red Flags)

After running all tests, verify server logs contain **NO** red flags:

### ❌ Must NOT Appear
- `[INVARIANT_FAIL] code=PHASE_DRAFT` - Client sent draft outside PREP
- `[INVARIANT_FAIL] code=PHASE_CONFIRM` - Client sent confirm outside PREP
- `[INVARIANT_FAIL] code=FINALIZE_ROUND_DOUBLE` - finalizeRound called twice
- `[INVARIANT_FAIL] code=ENDMATCH_IDEMPOTENT` - endMatch called twice
- `[INVARIANT_FAIL] code=AFK_CANON_*` - AFK rules violated

### ✅ Should Appear (Normal Operation)
- `[FINALIZE_ROUND]` - Once per round
- `[FINALIZE_ROUND_DECISION]` - Decision for each round
- `[MATCH_END]` - When match ends
- `[STATE_TRANSITION]` - State changes
- `[DRAFT]` - Draft received (PREP only)
- `[DRAFT_RECV]` - Draft received (if DEBUG_MATCH=1)

### Debug Logs (Optional)
If `DEBUG_MATCH=1` or client `?debug=1`:
- `[DRAFT_SEND]` - Client sent draft
- `[DRAFT_BLOCKED]` - Client blocked draft (expected in REVEAL)
- `[DRAFT_CANCEL]` - Debounce cancelled
- `[FINALIZE_CHECK]` - Finalize round check

---

**Last Updated**: 2026-01-17
