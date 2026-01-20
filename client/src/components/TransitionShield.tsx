interface TransitionShieldProps {
  visible: boolean;
}

/**
 * Full-screen #111 overlay to hide Menu→Battle transition flicker on Android TG WebView.
 * When visible becomes false, opacity 1→0 over 160ms; always in DOM so transition runs.
 */
export default function TransitionShield({ visible }: TransitionShieldProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#111',
        opacity: visible ? 1 : 0,
        transition: 'opacity 160ms ease-out',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden="true"
    />
  );
}
