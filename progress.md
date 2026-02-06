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
