# Smoke Test Checklist

Quick manual verification checklist to ensure battle engine baseline is working correctly.

**Time**: ~10-15 minutes  
**Prerequisites**: Server running, 2 test accounts (or 2 browser windows)

---

## Quick Smoke Tests

### ✅ Test 1: PvP Partial Play (1 card, no confirm)

**Steps**:
1. Start PvP match
2. Place 1 card in slot, **DO NOT** confirm
3. Wait for PREP timeout (20s)

**Expected**:
- ✅ Card preserved (not GRASS) - card from `yourHand`
- ✅ Other 2 slots filled with GRASS
- ✅ Round proceeds normally
- ✅ `hadDraftThisRound = true` (not AFK)
- ✅ `yourHand` contains exactly 4 CardIds: `['attack', 'defense', 'heal', 'counter']`

**Red Flags**:
- ❌ Card becomes GRASS (draft not sent)
- ❌ `[INVARIANT_FAIL] PHASE_DRAFT` in logs
- ❌ `yourHand` missing or wrong format

---

### ✅ Test 2: PvP Confirm (3 cards required)

**Steps**:
1. Start PvP match
2. Place 1-2 cards, try to confirm

**Expected**:
- ✅ Confirm button disabled (or shows helper text)
- ✅ Cannot confirm with < 3 cards
- ✅ Cards in slots are from `yourHand` (valid CardIds)

**Red Flags**:
- ❌ Confirm works with < 3 cards (validation broken)
- ❌ Invalid cards accepted (not from hand)

---

### ✅ Test 3: PvE Start (free, no tokens)

**Steps**:
1. Start PvE Training match
2. Check initial state

**Expected**:
- ✅ Match starts immediately (no queue)
- ✅ No token cost
- ✅ `pot = 0` (no rewards)
- ✅ Bot opponent present

**Red Flags**:
- ❌ Tokens deducted
- ❌ Pot > 0

---

### ✅ Test 4: PvE Bot Always Drafts

**Steps**:
1. Start PvE match
2. Wait for PREP phase
3. Check server logs (if DEBUG_MATCH=1)

**Expected**:
- ✅ Bot submits draft in PREP
- ✅ Bot never AFK (`hadDraftThisRound = true`)
- ✅ Bot layout has 3 cards (no GRASS)

**Red Flags**:
- ❌ Bot AFK (`hadDraftThisRound = false`)
- ❌ Bot layout has GRASS

---

### ✅ Test 5: AFK 1 Round → Continue

**Steps**:
1. Start PvP match
2. Player A: Do NOTHING in Round 1 PREP
3. Player B: Confirm 3 cards
4. Wait for Round 1 to complete

**Expected**:
- ✅ Match continues to Round 2
- ✅ Player A gets `[GRASS, GRASS, GRASS]`
- ✅ `afkStreakByPlayer[A] = 1` (not >= 2)

**Red Flags**:
- ❌ Match ends after Round 1 (should be Round 2)

---

### ✅ Test 6: AFK 2 Rounds → End Match

**Steps**:
1. Start PvP match
2. Round 1: Player A does NOTHING, Player B confirms
3. Round 2: Player A does NOTHING, Player B confirms
4. Wait for Round 2 timeout

**Expected**:
- ✅ Match ends after Round 2
- ✅ Player B wins (gets pot)
- ✅ Player A loses
- ✅ `afkStreakByPlayer[A] = 2` (>= 2)

**Red Flags**:
- ❌ Match ends after Round 1 (too early)
- ❌ Match doesn't end after Round 2 (AFK rule broken)

---

### ✅ Test 7: No Draft in REVEAL

**Steps**:
1. Start PvP match
2. Both players confirm in Round 1 PREP
3. Wait for REVEAL phase
4. Try to interact with cards (if UI allows)

**Expected**:
- ✅ No `layout_draft` events sent
- ✅ Server logs show no `[DRAFT_RECV]` during REVEAL
- ✅ No `[INVARIANT_FAIL] PHASE_DRAFT` errors

**Red Flags**:
- ❌ `[INVARIANT_FAIL] PHASE_DRAFT` in logs
- ❌ Draft events sent in REVEAL

---

### ✅ Test 8: Build Version Badge

**Steps**:
1. Open Menu screen
2. Check bottom of screen for version badge

**Expected**:
- ✅ Badge shows: `dev • local` or `prod • <sha>` (if VITE_BUILD_SHA set)
- ✅ In prod without `?debug=1`: badge hidden or very subtle (opacity ~0.3)
- ✅ In dev or with `?debug=1`: badge visible (opacity ~0.7)

**Red Flags**:
- ❌ Badge missing in dev
- ❌ Badge too prominent in prod (should be subtle/hidden)

---

### ✅ Test 9: Render Logs Check

**Steps**:
1. Run any of the above tests
2. Check server logs (Render logs or local)

**Expected**:
- ✅ No `[INVARIANT_FAIL]` errors
- ✅ Normal operation logs: `[FINALIZE_ROUND]`, `[MATCH_END]`, etc.

**Red Flags**:
- ❌ `[INVARIANT_FAIL] PHASE_DRAFT`
- ❌ `[INVARIANT_FAIL] PHASE_CONFIRM`
- ❌ `[INVARIANT_FAIL] FINALIZE_ROUND_DOUBLE`
- ❌ `[INVARIANT_FAIL] ENDMATCH_IDEMPOTENT`

---

## Quick Verification Commands

### Check Server Logs (Local)
```bash
# Start server with debug
DEBUG_MATCH=1 node server/index.js

# Look for red flags:
grep "INVARIANT_FAIL" logs.txt
```

### Check Client (Browser Console)
```bash
# Open browser with ?debug=1
# Check console for:
# - [DRAFT_BLOCKED] (expected in REVEAL)
# - [DRAFT_SEND] (expected in PREP only)
```

---

## Pass Criteria

All 9 tests pass:
- ✅ Partial play works
- ✅ Confirm validation works
- ✅ PvE free and bot works
- ✅ AFK rules correct (1 round = continue, 2 rounds = end)
- ✅ No draft in REVEAL
- ✅ No `[INVARIANT_FAIL]` errors

---

**Last Updated**: 2026-01-17
