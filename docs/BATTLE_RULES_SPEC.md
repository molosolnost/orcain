# Battle Rules Specification v1.0

**Source of Truth** for Orcain battle mechanics. This document defines the canonical rules that must not be violated by future changes.

## Table of Contents
1. [Terminology](#terminology)
2. [Match Lifecycle](#match-lifecycle)
3. [Data Formats](#data-formats)
4. [Layout Finalization Rules](#layout-finalization-rules)
5. [AFK Rules](#afk-rules)
6. [Disconnect Rules](#disconnect-rules)
7. [Card Interactions](#card-interactions)
8. [Sudden Death](#sudden-death)
9. [Match End Rules](#match-end-rules)

---

## Terminology

- **Match**: A complete battle between two players, consisting of multiple rounds.
- **Round**: A single cycle of PREP → REVEAL → NEXT/END.
- **Phase**: Current state of a round:
  - `PREP`: Preparation phase (20 seconds deadline)
  - `REVEAL`: Reveal phase (3 steps of card resolution)
  - `END`: Match ended
- **deadlineTs**: Timestamp (milliseconds) when PREP phase ends. Server sends this in `prep_start` event.
- **layout_draft**: Client event sent when player drags/drops cards (before confirm).
- **layout_confirm**: Client event sent when player confirms their layout.
- **GRASS**: Server-only placeholder card representing "no card played". Never sent to client.

---

## Match Lifecycle

### Sequence of Events

1. **queue_join**: Player joins matchmaking queue
2. **match_found**: Match created, both players notified
3. **prep_start**: PREP phase begins (20s deadline)
   - Contains: `roundIndex`, `deadlineTs`, `yourNickname`, `oppNickname`, `yourHp`, `oppHp`, `pot`, `cards`
4. **layout_draft** (optional): Player drafts cards (can send multiple times)
5. **layout_confirm** (optional): Player confirms layout
6. **step_reveal** (x3): Three steps of card resolution
   - Each step reveals one card pair and applies effects
7. **round_end**: Round completes, HP updated
8. **prep_start** (next round): Next round begins, or...
9. **match_end**: Match ends (winner determined)

### State Transitions

```
queue → match_found → prep_start (R1) → step_reveal x3 → round_end
  → prep_start (R2) → step_reveal x3 → round_end
  → ... → match_end
```

---

## Data Formats

### Layout Format
```typescript
type Layout = [CardId | null, CardId | null, CardId | null];
```

- Array of exactly 3 elements
- Each element is either a `CardId` or `null`
- `null` means "empty slot" (will be filled with GRASS if player is active)
- Client sends `(CardId | null)[]` in `layout_draft` and `layout_confirm`
- Server stores as `(CardId | GRASS | null)[]` internally

### CardId & Hand Contract

**CardId** (stable card identifiers):
```typescript
type CardId = 'attack' | 'defense' | 'heal' | 'counter';
```

- **Server is source of truth**: `server/cards.js` defines all valid CardIds
- **Client mirrors**: `client/src/cards.ts` mirrors server definitions (for UI only)
- **Hand**: Each player has exactly 4 CardIds (stable for entire match)
- **Hand source**: `getHandForAccount(accountId)` returns `CardId[4]` (currently `DEFAULT_HAND`)
- **Hand storage**: `match.hands` (Map: `sessionId -> CardId[4]`)

**CardId → CardType mapping** (for battle engine):
- `'attack'` → `'ATTACK'`
- `'defense'` → `'DEFENSE'`
- `'heal'` → `'HEAL'`
- `'counter'` → `'COUNTER'`

**Validation rules**:
- Client **NEVER** generates cards - only displays `yourHand` from server
- `layout_draft`/`layout_confirm` must contain only CardIds from player's hand
- Duplicates allowed: if hand has `['attack', 'attack', 'heal', 'counter']`, layout can use `'attack'` twice
- Invalid cards in draft: sanitized to `null` (logged as `[INVALID_CARD_FROM_CLIENT]`)
- Invalid cards in confirm: rejected with `error_msg` (strict validation)

**Payloads**:
- `match_found`: `{ yourHand: CardId[4], ... }`
- `prep_start`: `{ yourHand: CardId[4], ... }` (same hand, stable across rounds)
- `step_reveal`: `{ yourCard: CardId, oppCard: CardId, ... }`

### Cards (Legacy CardType - for battle engine only)
```typescript
type CardType = 'ATTACK' | 'DEFENSE' | 'HEAL' | 'COUNTER';
```

- **ATTACK**: Deals 2 damage (unless blocked)
- **DEFENSE**: Blocks ATTACK (0 damage)
- **HEAL**: Restores +1 HP (max HP cap)
- **COUNTER**: Reflects ATTACK back to attacker (-2 to attacker, 0 to defender)

**Note**: Battle engine uses `CardType`, but client/server protocol uses `CardId`. Conversion via `cardIdToType()`.

### GRASS
- Server-only placeholder (never sent to client)
- Represents "no card played"
- Used internally for AFK players and empty slots
- `GRASS = 'GRASS'` (constant in `server/cards.js`)

---

## Layout Finalization Rules

**Canonical order** (applied in `finalizeRound()`):

1. **If `confirmedLayout` exists and is valid**:
   - Use `confirmedLayout` as-is
   - Player is active (not AFK)

2. **Else if `hadDraftThisRound === true` AND `draftLayout` contains at least one real card**:
   - Fill `null` slots with `GRASS`
   - Example: `[ATTACK, null, null]` → `[ATTACK, GRASS, GRASS]`
   - Player is active (Partial Play)

3. **Else** (no draft, or draft is all null):
   - Final layout: `[GRASS, GRASS, GRASS]`
   - Player is AFK for this round

**Important**: `hadDraftThisRound` is set to `true` when:
- Any `layout_draft` is received (even with all nulls)
- Any `layout_confirm` is received

---

## AFK Rules

### AFK Definition
- Player is **AFK for a round** if `hadDraftThisRound === false`
- **NOT** determined by final layout (Partial Play can result in GRASS slots)

### AFK Streaks
- `afkStreakByPlayer[player]`: Consecutive AFK rounds for a player
  - Increments if `isAfkThisRound === true`
  - Resets to 0 if `isAfkThisRound === false`
- `bothAfkStreak`: Consecutive rounds where both players are AFK
  - Increments if `isAfkA && isAfkB`
  - Resets to 0 otherwise

### Match End Conditions

#### One Player AFK (2 rounds)
- If `afkStreakByPlayer[player] >= 2`:
  - `endMatch(reason="timeout", loser=player, winner=opponent)`
  - Pot goes to winner

#### Both Players AFK (2 rounds)
- If `bothAfkStreak >= 2`:
  - `endMatch(reason="timeout", potBurn=true, bothLose=true)`
  - Pot burns (no winner)
  - Both players lose

**Critical**: Match **MUST NOT** end after 1 AFK round. Only after 2 consecutive AFK rounds.

---

## Disconnect Rules

- If player disconnects (socket disconnect detected):
  - Immediate `endMatch(reason="disconnect", loser=disconnectedPlayer, winner=opponent)`
  - No grace period for AFK rules
  - Pot goes to winner

---

## Card Interactions

### GRASS Interactions
- **GRASS vs GRASS**: Nothing happens (0 effects)
- **ATTACK vs GRASS**: ATTACK deals 2 damage (GRASS does NOT block)
- **GRASS vs ATTACK**: ATTACK deals 2 damage
- **GRASS vs anything else**: GRASS has no effect

### Standard Interactions

#### ATTACK
- **ATTACK vs DEFENSE**: 0 damage (defense blocks)
- **ATTACK vs ATTACK**: Both take 2 damage
- **ATTACK vs COUNTER**: Attacker takes 2 damage, defender takes 0
- **ATTACK vs HEAL**: Defender takes 2 damage (heal doesn't block)
- **ATTACK vs GRASS**: Defender takes 2 damage

#### DEFENSE
- Blocks ATTACK (0 damage)
- No effect vs other cards

#### HEAL
- Always +1 HP (if not at max)
- Applied before damage in step resolution

#### COUNTER
- Reflects ATTACK back to attacker
- No effect vs other cards

### Step Resolution Order
1. Apply HEAL effects (both players)
2. Apply ATTACK/DEFENSE/COUNTER interactions
3. Update HP (clamp to 0..MAX_HP)

---

## Sudden Death

### Activation Condition
- Triggered when match reaches round limit (typically 3 rounds) with equal HP

### Effects
- Match continues until HP difference occurs
- No additional rule changes (same card interactions)

---

## Match End Rules

### Single End Point
- **`match_end` event is the ONLY way a match ends**
- All end conditions must call `endMatch()` or `endMatchForfeit()` or `endMatchBothAfk()`
- These functions emit `match_end` to both players

### End Conditions Summary
1. **Normal**: HP reaches 0 or round limit with HP difference
2. **AFK (one player)**: `afkStreakByPlayer >= 2`
3. **Both AFK**: `bothAfkStreak >= 2`
4. **Disconnect**: Socket disconnect detected

### Idempotency
- `endMatch()` functions **MUST** be idempotent
- If `match.state === "ended"`, subsequent calls are ignored
- Guards prevent double-ending

### End Match Functions
- `endMatch(match, reason)`: Normal end (HP-based)
- `endMatchForfeit(match, loser, winner, reason)`: One player forfeits (AFK/disconnect)
- `endMatchBothAfk(match)`: Both players AFK (pot burn)

---

## Implementation Notes

### Server-Side
- `finalizeRound()` is the **single point of truth** for layout finalization
- Called exactly once per round (at PREP deadline)
- All AFK checks happen in `finalizeRound()`
- Watchdog does NOT end matches in PREP (only in PLAYING for disconnect)

### Client-Side
- `layout_draft` sent ONLY on user action (drag/drop)
- Never auto-send real cards
- Default slots: `[null, null, null]`

---

## Version History

- **v1.0** (2025-01-15): Initial specification freeze

---

**This document is the Source of Truth. Any changes to battle mechanics must update this spec first.**
