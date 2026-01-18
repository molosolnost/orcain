import type { ReactNode } from 'react';

interface BackgroundLayoutProps {
  bgImage: string;
  children: ReactNode;
  overlay?: number;
  align?: 'center' | 'top';
}

export default function BackgroundLayout({
  bgImage,
  children,
  overlay = 0.2,
  align = 'center'
}: BackgroundLayoutProps) {
  return (
    <div
      className="bl-root"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      {/* Background: full-bleed, NO opacity (keeps original tones) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          pointerEvents: 'none'
        }}
      />
      {/* Overlay: subtle darkening only for text/button readability */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `rgba(0,0,0,${overlay})`,
          pointerEvents: 'none'
        }}
      />
      {/* Content */}
      <div
        className="bl-content"
        style={{
          position: 'relative',
          zIndex: 1,
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: align === 'top' ? 'flex-start' : 'center',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)'
        }}
      >
        {children}
      </div>
    </div>
  );
}
