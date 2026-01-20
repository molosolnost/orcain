import { useState, useEffect } from 'react';

interface TransitionShieldProps {
  visible: boolean;
}

/**
 * Full-screen #111 overlay to hide Menu→Battle transition flicker on Android TG WebView.
 * When visible becomes false, stays mounted 200ms with opacity 1→0 over 160ms.
 */
export default function TransitionShield({ visible }: TransitionShieldProps) {
  const [isHiding, setIsHiding] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsHiding(false);
      return;
    }
    setIsHiding(true);
    const t = setTimeout(() => setIsHiding(false), 200);
    return () => clearTimeout(t);
  }, [visible]);

  const opacity = visible ? 1 : 0;
  const blockPointer = visible;
  if (!visible && !isHiding) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#111',
        opacity,
        transition: 'opacity 160ms ease-out',
        pointerEvents: blockPointer ? 'auto' : 'none',
      }}
      aria-hidden="true"
    />
  );
}
