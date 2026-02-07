Original prompt: Добавь в игру интерактивное обучение для новичков "за ручку", которое объяснит механику игры, как работают карты, минимальные тактики боя, чтобы это обучение дало новым игрокам понять что делать в игре и как играть против реальных противников

## Plan
- Add a dedicated interactive tutorial entrypoint from Menu (separate from regular PvE training).
- Add tutorial mode state in App and pass it into Battle.
- Implement in-battle guided tutorial overlay with step progression tied to player actions:
  - card mechanics,
  - drag/drop into slots,
  - confirm move,
  - reveal interpretation,
  - minimal PvP tactics.
- Add completion/skip handling and persist completion in localStorage so users can revisit.
- Run UI checks and TypeScript build for validation.

## Progress update
- Added tutorial mode wiring in App:
  - dedicated menu action for interactive tutorial,
  - tutorial mode passed to Battle,
  - tutorial completion persisted in localStorage.
- Added menu CTA for interactive tutorial with repeat option after completion.
- Added in-battle guided tutorial overlay with 8 steps, action-gated progression, and tactical tips focused on real PvP opponents.
- Added light guidance gating in tutorial mode (cards/confirm unlocked by step progression).

## Validation
- `npm run build --prefix client` passed.
- `npm run test:ui-regression` passed on iphone-se, pixel-7, ipad-mini, desktop-1366.
- Additional tutorial smoke check via Playwright script passed (`Interactive Tutorial` button opens battle and shows `Шаг 1/8`).

## TODO / Suggestions for next iteration
- Consider storing per-step tutorial progress (not only completion) to allow resume after reconnect.
- Consider adding deterministic scripted PvE opening in tutorial mode so first reveal always demonstrates at least one specific interaction (e.g., Attack vs Defense).

## Update: Tutorial quality pass
- Tutorial no longer starts a server PvE match.
- Tutorial runs in fully local deterministic mode (no PREP timer, no auto-round start, no auto-reveal).
- Added strict guided flow with explicit card placement:
  - Attack -> S1
  - Defense -> S2
  - Heal -> S3
  - Confirm
  - Manual reveal step-by-step (button-driven).
- Replaced player-facing phase labels with simpler wording:
  - PREP -> Планирование
  - REVEAL -> Вскрытие
  - END -> Финал
- Added robust rendering guard in App so tutorial view stays visible even if menu state listeners race.

## Additional validation
- `npm run build --prefix client` passed after tutorial refactor.
- `npm run test:ui-regression` passed.
- Additional Playwright tutorial quality check passed:
  - tutorial opens,
  - timer hidden,
  - no automatic step progression without user action.

## Hotfix: Tutorial confirm overlap
- Fixed mobile overlap on tutorial confirm step: tutorial panel now moves to top when current step is `confirm`.
- Added bounded panel height with internal scroll to prevent blocking actionable controls on small/long mobile viewports.
- Verified with `npm run build --prefix client`.

## Hotfix: Black screen in menu entry
- Removed hard blocking `!connected && authToken` full-screen gate in App (this could look like black screen when socket handshake stalls).
- Menu now renders even while socket is reconnecting.
- Added explicit connection status text in menu.
- PvP/PvE start buttons are disabled until socket is connected; tutorial button stays available.
- Added guards in `handleStartBattle` and `handleStartPvE` to prevent queue actions while disconnected.

## Validation
- `npm run build --prefix client` passed.
- `npm run test:ui-regression` passed.

## Update: PvP button image + interaction states
- Added new optimized PvP button image asset from provided source:
  - cropped to content-friendly ratio,
  - resized for UI (860x487),
  - compressed to WebP (~82KB): `client/src/assets/pvp_button.webp`.
- Wired image into PvP start button in menu and tuned fit/size for mobile menu layout.
- Added button interaction polish:
  - press animation (scale + brightness),
  - disabled visual state (dim + grayscale + overlay),
  - disabled reason text under button when unavailable.
- Validation:
  - `npm run build --prefix client` passed,
  - `npm run test:ui-regression` passed,
  - manual screenshot check for mobile menu layout passed.

## Hotfix: PvP black screen after "В бой"
- Root cause: `TransitionShield` was started too early (at `queue_join`) and could stay visible while user remained in menu queue state, creating a black-screen effect.
- Fix:
  - Start transition shield only on actual match transition (`onMatchFound`) instead of `handleStartBattle`.
  - Stop transition shield on queue cancel/queue leave/error/unauthorized/back-to-menu.
  - Added a failsafe effect: if shield remains visible outside battle/tutorial, auto-hide after timeout.
- This reduces regression risk by centralizing shield lifecycle to real screen transitions and adding recovery fallback.

## Validation
- `npm run build --prefix client` passed.
- `npm run test:ui-regression` passed.
- Added targeted Playwright check for PvP start flow on mobile viewport:
  - after tapping PvP button, `Searching opponent…` is visible,
  - transition shield is not blocking viewport.

## Feature: Startup preload loading screen
- Added a dedicated startup loading screen in `App` that appears on launch before app screens render.
- Implemented asset preloading pipeline for critical game/menu images:
  - `menu_bg.webp`
  - `orcain_logo.webp`
  - `pvp_button.webp`
- Startup screen now remains visible until:
  - core assets are preloaded,
  - boot/auth state resolves (`ready` or `error`).
- Added loading progress indicator and fallback timeout handling per image preload to avoid deadlock.

## Validation
- `npm run build --prefix client` passed.
- `npm run test:ui-regression` passed.
- Added startup smoke check: loader appears at startup and app proceeds to login/menu afterward.

## Update: Orc-themed hand-drawn visual overhaul
- Added procedural asset generation script: `client/scripts/generate_orc_assets.mjs`.
- Generated full themed pack in `client/src/assets/orc-theme/`:
  - backgrounds: menu + battle,
  - card art: attack/defense/heal/counter + back + empty slot,
  - buttons: PvP/PvE/Tutorial/Confirm/Cancel/Secondary,
  - decorative ornaments (top/bottom).
- Menu UI migrated to generated assets:
  - new illustrated background and decorative ornaments,
  - all main action buttons are image-based (PvP/PvE/Tutorial/Cancel).
- Battle UI migrated to generated assets:
  - arena background + ornaments,
  - all cards render from themed art instead of emoji/text cards,
  - confirm and key overlay buttons switched to themed button textures,
  - match-end and tutorial panel buttons updated to same style family.
- App preload list updated to include key new themed assets.
- Onboarding background switched to the new themed menu background.

## Validation (orc visual pass)
- `npm run build --prefix client` passed.
- `npm run test:ui-regression` passed (iphone-se, pixel-7, ipad-mini, desktop-1366).

## Update: Battle HP visual feedback (floating numbers + shake)
- Added explicit per-side combat feedback in `client/src/screens/Battle.tsx`:
  - large floating damage/heal numbers above each HP label (`-N` in red, `+N` in green),
  - short HP shake animation when taking damage.
- Implemented separate state/timers for each side (`your`/`opp`) to avoid collisions when both HP values change in the same step.
- Added cleanup for all HP FX timers on unmount to prevent stale animations.

## Validation (HP feedback pass)
- `npm run test:smoke` passed.
- `npm run test:ui-regression` passed (iphone-se, pixel-7, ipad-mini, desktop-1366).
