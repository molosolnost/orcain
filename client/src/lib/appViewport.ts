/**
 * Single source of truth for app height to prevent Android/Telegram WebView
 * viewport jump and layout shift. Uses Telegram.viewportHeight, then
 * visualViewport.height, then innerHeight. Updates --app-height on :root.
 */

const DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

export function computeAppHeight(): number {
  if (typeof window === 'undefined') return 0;
  const tg = (window as any).Telegram?.WebApp;
  const vv = (window as any).visualViewport;
  if (typeof tg?.viewportHeight === 'number' && tg.viewportHeight > 0) {
    return Math.round(tg.viewportHeight);
  }
  if (typeof vv?.height === 'number') return Math.round(vv.height);
  return Math.round(window.innerHeight);
}

export function applyAppHeight(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const inner = typeof window !== 'undefined' ? window.innerHeight : 0;
  const vv = (window as any).visualViewport?.height;
  const tg = (window as any).Telegram?.WebApp?.viewportHeight;
  const set = computeAppHeight();
  document.documentElement.style.setProperty('--app-height', `${set}px`);
  if (DEBUG) {
    console.log(`[VIEWPORT] inner=${inner} vv=${vv ?? 'n/a'} tg=${tg ?? 'n/a'} set=${set}`);
  }
}

export function initAppViewport(): () => void {
  applyAppHeight();
  try {
    (window as any).Telegram?.WebApp?.expand?.();
  } catch (_) {}

  const onResize = () => applyAppHeight();
  window.addEventListener('resize', onResize);
  const vv = (window as any).visualViewport;
  if (vv && typeof vv.addEventListener === 'function') {
    vv.addEventListener('resize', onResize);
  }

  const tg = (window as any).Telegram?.WebApp;
  if (tg && typeof tg.onEvent === 'function') {
    tg.onEvent('viewportChanged', onResize);
  }

  return () => {
    window.removeEventListener('resize', onResize);
    if (vv && typeof vv.removeEventListener === 'function') {
      vv.removeEventListener('resize', onResize);
    }
    if (tg && typeof tg.offEvent === 'function') {
      tg.offEvent('viewportChanged', onResize);
    }
  };
}
