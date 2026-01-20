/**
 * Single source of truth for app height to prevent Android/Telegram WebView
 * viewport jump and layout shift. Uses Telegram.viewportHeight, then
 * visualViewport.height, then innerHeight. Updates --app-height on :root.
 *
 * LOCK: during Battle we lock --app-height to avoid resize-driven jumps;
 * resize/viewportChanged still call applyAppHeight() but it uses lockedHeight.
 */

const DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

const THROTTLE_MS = 120;

type LockOwner = 'transition' | 'battle';

let lockedBy: LockOwner | null = null;
let lockedHeight: number | null = null;

function applyAppHeightWithValue(value: number): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.style.setProperty('--app-height', `${value}px`);
}

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

export function getIsAppHeightLocked(): boolean {
  return lockedBy != null;
}

export function applyAppHeight(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const inner = typeof window !== 'undefined' ? window.innerHeight : 0;
  const vv = (window as any).visualViewport?.height;
  const tg = (window as any).Telegram?.WebApp?.viewportHeight;
  if (lockedBy != null && lockedHeight !== null) {
    applyAppHeightWithValue(lockedHeight);
    if (DEBUG) console.log(`[VIEWPORT] inner=${inner} vv=${vv ?? 'n/a'} tg=${tg ?? 'n/a'} app=${lockedHeight} locked=true`);
    return;
  }
  const set = computeAppHeight();
  applyAppHeightWithValue(set);
  if (DEBUG) {
    console.log(`[VIEWPORT] inner=${inner} vv=${vv ?? 'n/a'} tg=${tg ?? 'n/a'} app=${set} locked=false`);
  }
}

export function lockAppHeight(reason?: string): void {
  lockedBy = 'battle';
  lockedHeight = computeAppHeight();
  applyAppHeightWithValue(lockedHeight);
  if (DEBUG) console.log('[VIEWPORT_LOCK]', { reason, lockedHeight });
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (lockedHeight !== null) applyAppHeightWithValue(lockedHeight);
    });
  }
}

export function unlockAppHeight(reason?: string): void {
  if (lockedBy !== 'battle') return;
  lockedBy = null;
  lockedHeight = null;
  applyAppHeight();
  if (DEBUG) console.log('[VIEWPORT_UNLOCK]', { reason });
}

/**
 * Freeze --app-height for ms during Menu→Battle transition to reduce viewportChanged-induced jump.
 * Returns a cancel function. Battle’s lockAppHeight will take over when it mounts; the timer
 * only clears if we are still the owner (lockedBy==='transition').
 */
export function lockAppHeightFor(ms: number): () => void {
  lockedBy = 'transition';
  lockedHeight = computeAppHeight();
  applyAppHeightWithValue(lockedHeight);
  if (DEBUG) console.log('[VIEWPORT_LOCK]', { reason: 'transition', ms, lockedHeight });
  const id = setTimeout(() => {
    if (lockedBy === 'transition') {
      lockedBy = null;
      lockedHeight = null;
      applyAppHeight();
      if (DEBUG) console.log('[VIEWPORT_UNLOCK]', { reason: 'transition_timeout' });
    }
  }, ms);
  return () => {
    clearTimeout(id);
    if (lockedBy === 'transition') {
      lockedBy = null;
      lockedHeight = null;
      applyAppHeight();
      if (DEBUG) console.log('[VIEWPORT_UNLOCK]', { reason: 'transition_cancel' });
    }
  };
}

export function initAppViewport(): () => void {
  applyAppHeight();
  try {
    (window as any).Telegram?.WebApp?.expand?.();
  } catch (_) {}

  let lastApply = 0;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    const now = Date.now();
    if (now - lastApply >= THROTTLE_MS) {
      lastApply = now;
      applyAppHeight();
    } else if (!scheduled) {
      scheduled = setTimeout(() => {
        scheduled = null;
        lastApply = Date.now();
        applyAppHeight();
      }, THROTTLE_MS - (now - lastApply));
    }
  };

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
    if (scheduled) clearTimeout(scheduled);
    window.removeEventListener('resize', onResize);
    if (vv && typeof vv.removeEventListener === 'function') {
      vv.removeEventListener('resize', onResize);
    }
    if (tg && typeof tg.offEvent === 'function') {
      tg.offEvent('viewportChanged', onResize);
    }
  };
}
