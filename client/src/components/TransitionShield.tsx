interface TransitionShieldProps {
  visible: boolean;
}

/**
 * Full-screen #111 overlay to hide Menu→Battle transition flicker on Android TG WebView.
 * When visible: opacity 1, pointer-events auto; else opacity 0, pointer-events none.
 * Transition 120ms. z-index 9999 so it sits above .app-screen.
 */
export default function TransitionShield({ visible }: TransitionShieldProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#111',
        opacity: visible ? 1 : 0,
        transition: 'opacity 120ms ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden="true"
    />
  );
}
