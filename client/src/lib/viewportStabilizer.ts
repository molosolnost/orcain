/**
 * Viewport stabilizer for Android Telegram WebView: waits until height metrics
 * (tg viewportHeight, visualViewport.height, --app-height) do not change by
 * more than 1px over 200ms. Resolves on stability or after timeoutMs (default 1200).
 * On non-Android or non-Telegram, resolves immediately.
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
const isAndroid = ua.includes('android');
const isTelegram = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp;

export const isAndroidTg = isAndroid && isTelegram;

export interface ViewportStabilizerOpts {
  timeoutMs?: number;
  /** default 200 */
  stableWindowMs?: number;
  /** default 50 */
  sampleMs?: number;
  /** default 1 */
  tolerancePx?: number;
}

export function startViewportStabilizer(opts?: ViewportStabilizerOpts): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 1200;
  const STABLE_WINDOW_MS = opts?.stableWindowMs ?? 200;
  const SAMPLE_MS = opts?.sampleMs ?? 50;
  const TOLERANCE_PX = opts?.tolerancePx ?? 1;

  if (!isAndroidTg) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    type Sample = { tg: number; vv: number; app: number; ts: number };
    const samples: Sample[] = [];

    function sample(): { tg: number; vv: number; app: number } {
      const tg = (window as any).Telegram?.WebApp?.viewportHeight;
      const vv = (window as any).visualViewport?.height;
      const raw = typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim()
        : '';
      const app = parseInt(raw, 10) || 0;
      return {
        tg: typeof tg === 'number' ? tg : 0,
        vv: typeof vv === 'number' ? vv : 0,
        app: Number.isNaN(app) ? 0 : app,
      };
    }

    function isStable(): boolean {
      const cut = Date.now() - STABLE_WINDOW_MS;
      const recent = samples.filter((s) => s.ts >= cut);
      if (recent.length < 2) return false;
      const ok = (arr: number[]) => (Math.max(...arr) - Math.min(...arr)) <= TOLERANCE_PX;
      return ok(recent.map((s) => s.tg)) && ok(recent.map((s) => s.vv)) && ok(recent.map((s) => s.app));
    }

    const id = setInterval(() => {
      const v = sample();
      samples.push({ ...v, ts: Date.now() });
      if (isStable()) {
        clearInterval(id);
        clearTimeout(toId);
        resolve();
      }
    }, SAMPLE_MS);

    const toId = setTimeout(() => {
      clearInterval(id);
      resolve();
    }, timeoutMs);
  });
}

export function getViewportHeights(): { inner: number; vv: number; tg: number; app: string } {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { inner: 0, vv: 0, tg: 0, app: '—' };
  }
  const inner = window.innerHeight;
  const vv = (window as any).visualViewport?.height;
  const tg = (window as any).Telegram?.WebApp?.viewportHeight;
  const app = getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim() || '—';
  return { inner, vv: typeof vv === 'number' ? vv : 0, tg: typeof tg === 'number' ? tg : 0, app };
}
