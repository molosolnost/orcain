# Battle Engine Baseline

**Baseline Commit**: `16c07ba98edffe211d54f8c1af64979df6732bf1`  
**Date**: 2026-01-17 20:03:38 +0300  
**Purpose**: Freeze stable PvP+PvE battle engine as reference point for future development

---

## What's Included

### ✅ Core Features
- **PvP (Player vs Player)**: Full matchmaking, queue system, token-based matches
- **PvE (Player vs Environment)**: Training mode with bot opponent, no token cost
- **Card System Freeze**: ATTACK, DEFENSE, HEAL, COUNTER cards with fixed effects
- **Battle Engine Hardening**: Invariants, guards, structured logging

### ✅ Battle Phases
- **PREP**: 20-second preparation phase, draft/confirm layout
- **REVEAL**: 3-step card resolution phase
- **END**: Match completion with winner determination

### ✅ Match Rules
- **Partial Play**: Players can draft 1-3 cards, unfilled slots become GRASS
- **AFK Rules**: 2 consecutive AFK rounds → match end (one player) or timeout (both players)
- **Disconnect Handling**: Immediate match end, winner gets pot
- **Sudden Death**: Activates after 3 rounds with equal HP

---

## What's Excluded

### ❌ Not in Baseline
- **Tutorial Mode**: Removed/rolled back (was experimental, caused regressions)
- **Rating System**: Not implemented
- **Tournament Mode**: Not implemented
- **Spectator Mode**: Not implemented

---

## Critical Invariants

### Phase Guards (Client)
- `layout_draft` **ONLY** sent when `phase === 'PREP'`
- `layout_confirm` **ONLY** sent when `phase === 'PREP'`
- Debounce cancelled on phase transition (PREP → REVEAL)
- No draft sends after confirm until next `prep_start`

### Server Invariants
- `finalizeRound()`: Single execution point per round (guarded by `finalizedRoundIndex`)
- `endMatch()`: Idempotent (guarded by `match.state !== 'ended'`)
- **AFK Detection**: `hadDraftThisRound` is source of truth (not `layout.length`)
- **GRASS Rules**: 
  - GRASS is server-only placeholder (never sent to client)
  - Empty slots (`null`) filled with GRASS in `finalizeLayout()`
  - ATTACK vs GRASS deals damage (GRASS does not block)

### Phase Correctness
- `layout_draft` handler: Only accepts in `state === 'prep'`
- `layout_confirm` handler: Only accepts in `state === 'prep'`
- `step_reveal`: Only sent when `state === 'playing'`
- Watchdog: Does NOT end match in PREP phase

### HP/Pot Sanity
- HP clamped to `[0, MAX_HP]` (MAX_HP = 10)
- Pot never negative (guarded in `finalizeRound`)
- HEAL caps at MAX_HP

---

## Socket Protocol (Frozen)

### Client → Server
- `hello`: Session authentication
- `queue_join`: Join matchmaking
- `queue_leave`: Leave matchmaking
- `pve_start`: Start PvE match
- `layout_draft`: Send draft layout (PREP only)
- `layout_confirm`: Confirm final layout (PREP only)

### Server → Client
- `hello_ok`: Authentication success
- `connected`: Connection established
- `queue_ok`: Queue join success
- `match_found`: Match created
- `prep_start`: PREP phase begins
- `confirm_ok`: Confirm accepted
- `step_reveal`: Card resolution step
- `round_end`: Round completed
- `match_end`: Match ended

---

## Anti-Regression Checklist

Before making changes to battle engine, verify:
- ✅ No `[INVARIANT_FAIL]` errors in logs
- ✅ Partial play works (1 card → GRASS fill, not AFK)
- ✅ AFK rules: 1 round = continue, 2 rounds = end
- ✅ Phase guards: No draft/confirm outside PREP
- ✅ PvE uses same engine as PvP (no special paths)
- ✅ GRASS interactions: ATTACK deals damage vs GRASS

---

## Related Documents

- `docs/BATTLE_RULES_SPEC.md`: Canonical battle rules specification
- `docs/BATTLE_RULES_AUDIT.md`: Code compliance audit against spec
- `docs/REGRESSION_TESTS.md`: Manual test scenarios
- `docs/SMOKE_CHECKLIST.md`: Quick smoke tests

---

**Note**: This baseline is frozen. Any changes to battle engine logic, phases, or socket protocol must be documented and tested against this baseline.
