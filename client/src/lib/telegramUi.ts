/**
 * Telegram WebApp UI: set native WebView/header colors to match our dark theme.
 * Prevents white flash from the native layer on Android when the page reflows.
 * Call once at boot and once on App mount (in case TG injects after first paint).
 */
export function applyTelegramUi(): void {
  const tg = (window as any).Telegram?.WebApp;
  if (!tg) return;
  try {
    tg.setBackgroundColor?.('#111111');
    tg.setHeaderColor?.('#111111');
  } catch (_) {}
}
