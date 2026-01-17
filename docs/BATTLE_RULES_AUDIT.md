# Battle Rules Audit: Spec vs Code Compliance

**Date**: 2025-01-17  
**Spec Version**: v1.0  
**Code Commit**: c0ee2f0

This document maps BATTLE_RULES_SPEC.md requirements to actual code implementation.

---

## 1. Layout Finalization Rules

### Spec Requirement
> **Canonical order** (applied in `finalizeRound()`):
> 1. If `confirmedLayout` exists and is valid → use as-is
> 2. Else if `hadDraftThisRound === true` AND `draftLayout` contains at least one real card → fill null with GRASS
> 3. Else → `[GRASS, GRASS, GRASS]` (AFK)

### Code Implementation
**File**: `server/index.js`  
**Function**: `finalizeLayout()` (lines 593-611)  
**Called from**: `finalizeRound()` (lines 643-652)

**Status**: ✅ **COMPLIANT**

- Line 595: Checks `confirmedLayout` first
- Line 600-606: Checks `draftLayout` with real cards, fills null with GRASS
- Line 610: Returns `[GRASS, GRASS, GRASS]` as fallback

**Note**: `finalizeLayout()` correctly implements spec order. However, it doesn't check `hadDraftThisRound` - this is checked in `finalizeRound()` before calling `finalizeLayout()`.

---

## 2. finalizeRound Single Point of Truth

### Spec Requirement
> `finalizeRound()` is the **single point of truth** for layout finalization. Called exactly once per round (at PREP deadline).

### Code Implementation
**File**: `server/index.js`  
**Function**: `finalizeRound()` (lines 615-743)

**Status**: ✅ **COMPLIANT**

- Line 617-620: Guard prevents double-run (`finalizedRoundIndex === roundIndex`)
- Line 622-625: Guard ensures state is 'prep'
- Called from:
  - `prepTimer` timeout (line 1419)
  - `startPlay()` if layouts not finalized (line 1006)

**Invariant Guards**:
- `FINALIZE_ROUND_DOUBLE`: Prevents double execution
- `FINALIZE_ROUND_WRONG_STATE`: Ensures state === 'prep'

---

## 3. AFK Rules

### Spec Requirement
> - Player is **AFK for a round** if `hadDraftThisRound === false`
> - Match **MUST NOT** end after 1 AFK round. Only after 2 consecutive AFK rounds.
> - One Player AFK (2 rounds): `afkStreakByPlayer[player] >= 2` → endMatch(reason="timeout")
> - Both Players AFK (2 rounds): `bothAfkStreak >= 2` → endMatch(reason="timeout", potBurn=true)

### Code Implementation
**File**: `server/index.js`  
**Function**: `finalizeRound()` (lines 654-738)

**Status**: ✅ **COMPLIANT**

- Line 655-659: AFK determined by `!hadDraftThisRound` (spec-compliant)
- Line 658: BOT never considered AFK (correct for PvE)
- Line 665-675: Streaks updated correctly (increment if AFK, reset if not)
- Line 681-685: `bothAfkStreak` updated correctly
- Line 708-717: Both AFK check (`bothAfkStreak >= 2`) → `endMatchBothAfk()`
- Line 718-727: One AFK check (`newStreak1 >= 2`) → `endMatchForfeit()`
- Line 728-737: One AFK check (`newStreak2 >= 2`) → `endMatchForfeit()`

**Invariant Guards**:
- `AFK_CANON_BOTH`: Ensures both players are AFK when `bothAfkStreak >= 2`
- `AFK_CANON_P1`: Ensures player 1 is AFK when `streak1 >= 2`
- `AFK_CANON_P2`: Ensures player 2 is AFK when `streak2 >= 2`

**Critical**: ✅ Match does NOT end after 1 AFK round (requires streak >= 2)

---

## 4. GRASS Interactions

### Spec Requirement
> - **GRASS vs GRASS**: Nothing happens (0 effects)
> - **ATTACK vs GRASS**: ATTACK deals 2 damage (GRASS does NOT block)
> - **GRASS vs ATTACK**: ATTACK deals 2 damage
> - **GRASS vs anything else**: GRASS has no effect

### Code Implementation
**File**: `server/index.js`  
**Function**: `applyStepLogic()` (lines 860-925)

**Status**: ✅ **COMPLIANT**

- Line 871-873: GRASS vs GRASS → no effects
- Line 888: Comment: "ATTACK vs GRASS -> защищающийся -2 (GRASS не блокирует)"
- Line 904-907: ATTACK vs GRASS → defender takes 2 damage
- Line 918-921: GRASS vs ATTACK → defender takes 2 damage

**Verification**: Code correctly implements GRASS interactions per spec.

---

## 5. Watchdog Rules

### Spec Requirement
> Watchdog does NOT end matches in PREP (only in PLAYING for disconnect).

### Code Implementation
**File**: `server/index.js`  
**Function**: `startPlay()` watchdog (lines 954-996), `startPrepPhase()` watchdog (lines 1289-1326)

**Status**: ✅ **COMPLIANT**

- Line 964-969: Watchdog in PREP returns early (does NOT end match)
- Line 1322-1325: Watchdog in PREP only logs (does NOT end match)
- Line 970-995: Watchdog in PLAYING only handles disconnect/timeout

**Critical**: ✅ Watchdog does NOT trigger AFK rules in PREP (prepTimer handles that)

---

## 6. Match End Rules

### Spec Requirement
> - `match_end` event is the ONLY way a match ends
> - All end conditions must call `endMatch()`, `endMatchForfeit()`, or `endMatchBothAfk()`
> - `endMatch()` functions **MUST** be idempotent

### Code Implementation
**File**: `server/index.js`  
**Functions**: 
- `endMatch()` (lines 1597-1734)
- `endMatchForfeit()` (lines 1434-1595)
- `endMatchBothAfk()` (lines 746-855)

**Status**: ✅ **COMPLIANT**

- Line 1599: `endMatch()` idempotency guard (`match.state !== 'ended'`)
- Line 1439: `endMatchForfeit()` idempotency guard
- Line 748: `endMatchBothAfk()` idempotency guard
- All functions emit `match_end` event via `emitToBoth()`

**Invariant Guards**:
- `ENDMATCH_IDEMPOTENT`: Prevents double-ending

---

## 7. Phase Correctness

### Spec Requirement
> - `layout_draft` only accepted in `state === 'prep'`
> - `layout_confirm` only accepted in `state === 'prep'`

### Code Implementation
**File**: `server/index.js`

**Status**: ✅ **COMPLIANT**

- Line 2106: `layout_draft` guard: `match.state === 'prep'`
- Line 2165: `layout_confirm` guard: `match.state === 'prep'`

**Invariant Guards**:
- `PHASE_DRAFT`: Ensures draft only in PREP
- `PHASE_CONFIRM`: Ensures confirm only in PREP

---

## 8. HP Sanity

### Spec Requirement
> HP in range 0..MAX_HP

### Code Implementation
**File**: `server/index.js`  
**Function**: `doOneStep()` (lines 1021-1092)

**Status**: ✅ **COMPLIANT**

- Line 1031-1036: HP sanity guards with clamping
- Line 877, 880: HEAL caps at MAX_HP
- Line 898, 902, 906, 916, 920: Damage floors at 0

**Invariant Guards**:
- `HP_SANITY_P1`: Ensures p1Hp in range 0..MAX_HP
- `HP_SANITY_P2`: Ensures p2Hp in range 0..MAX_HP

---

## 9. Pot Sanity

### Spec Requirement
> Pot never < 0

### Code Implementation
**File**: `server/index.js`  
**Function**: `finalizeRound()` (line 638)

**Status**: ✅ **COMPLIANT**

- Line 638-640: Pot sanity guard (`match.pot >= 0`)

**Invariant Guards**:
- `POT_NEGATIVE`: Prevents negative pot

---

## 10. PvE Compliance

### Spec Requirement
> PvE must use same battle engine (finalizeRound, doOneStep, applyStepLogic) without bypasses.

### Code Implementation
**File**: `server/index.js`

**Status**: ✅ **COMPLIANT**

- Line 1346-1349: PvE bot submits draft (never AFK)
- Line 658: BOT never considered AFK (correct)
- Line 681: `bothAfkStreak` only grows if both are real players (BOT excluded)
- Line 1524-1531: PvE pot = 0, no rewards (correct)
- Line 1665-1672: PvE no token rewards (correct)

**Verification**: PvE uses same `finalizeRound()`, `doOneStep()`, `applyStepLogic()` as PvP. No bypasses.

---

## 11. hadDraftThisRound Source of Truth

### Spec Requirement
> `hadDraftThisRound` is set to `true` when:
> - Any `layout_draft` is received (even with all nulls)
> - Any `layout_confirm` is received

### Code Implementation
**File**: `server/index.js`

**Status**: ✅ **COMPLIANT**

- Line 2120: `layout_draft` sets `hadDraftThisRound.set(sessionId, true)`
- Line 2220: `layout_confirm` sets `hadDraftThisRound.set(sessionId, true)`
- Line 1342-1343: Reset to `false` at start of new round

**Verification**: Correctly used as source of truth for AFK determination.

---

## Summary

| Spec Section | Code Location | Status | Notes |
|-------------|----------------|--------|-------|
| Layout Finalization | `finalizeLayout()`:593-611 | ✅ | Correct order |
| finalizeRound Single Point | `finalizeRound()`:615-743 | ✅ | Guards prevent double-run |
| AFK Rules (2 rounds) | `finalizeRound()`:708-737 | ✅ | Requires streak >= 2 |
| GRASS Interactions | `applyStepLogic()`:860-925 | ✅ | ATTACK vs GRASS deals damage |
| Watchdog (no PREP end) | `startPlay()`:964-969, `startPrepPhase()`:1322-1325 | ✅ | Returns early in PREP |
| Match End Idempotency | `endMatch*()`:1439,1599,748 | ✅ | All guarded |
| Phase Correctness | `layout_draft`:2106, `layout_confirm`:2165 | ✅ | Guards present |
| HP Sanity | `doOneStep()`:1031-1036 | ✅ | Clamped to 0..MAX_HP |
| Pot Sanity | `finalizeRound()`:638 | ✅ | Guard present |
| PvE Compliance | Multiple locations | ✅ | Uses same engine |
| hadDraftThisRound | `layout_draft`:2120, `layout_confirm`:2220 | ✅ | Source of truth |

---

## Issues Found

**None** - Code fully complies with BATTLE_RULES_SPEC.md v1.0.

---

## Recommendations

1. ✅ All critical invariants are guarded
2. ✅ Logging is structured and helpful
3. ✅ PvE correctly uses same engine
4. ✅ No bypasses or shortcuts

**No changes required** - code is spec-compliant.

---

**Last Updated**: 2025-01-17
