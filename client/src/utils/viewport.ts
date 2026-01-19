/**
 * Single source of truth for app height to prevent Android/Telegram WebView
 * viewport jump and layout shift. Sets --app-height (and --app-width) on :root.
 */

const DEBUG_VIEWPORT =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

export function setAppHeight(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;

  const tg = (window as any).Telegram?.WebApp;
  const tgH = tg?.viewportHeight;
  const h = Math.round(
    typeof tgH === 'number' && tgH > 0 ? tgH : window.innerHeight
  );
  const w = Math.round(window.innerWidth);

  document.documentElement.style.setProperty('--app-height', `${h}px`);
  document.documentElement.style.setProperty('--app-width', `${w}px`);

  if (DEBUG_VIEWPORT) {
    console.log(
      `[VIEWPORT] innerHeight=${window.innerHeight} tgViewportHeight=${tgH ?? 'n/a'} appHeight=${h}`
    );
  }
}

export function setupViewportListeners(): () => void {
  setAppHeight();

  const onResize = () => {
    setAppHeight();
  };

  window.addEventListener('resize', onResize);

  const tg = (window as any).Telegram?.WebApp;
  if (tg && typeof tg.onEvent === 'function') {
    tg.onEvent('viewportChanged', onResize);
  }

  return () => {
    window.removeEventListener('resize', onResize);
    if (tg && typeof tg.offEvent === 'function') {
      tg.offEvent('viewportChanged', onResize);
    }
  };
}
