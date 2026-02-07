import { useEffect, useMemo, useRef, useState } from 'react';
import onboardingBg from '../assets/onboarding_bg.png';
import { t, type GameLanguage } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';
const ONBOARDING_ART_WIDTH = 1024;
const ONBOARDING_ART_HEIGHT = 1536;
const INPUT_RECT = { x: 132.096, y: 1282.56, width: 456.704, height: 84.48 };
const CONTINUE_RECT = { x: 613.376, y: 1282.56, width: 293.888, height: 84.48 };
const ERROR_TOP_Y = 1164.288;

interface OnboardingProps {
  authToken: string;
  onNicknameSet: (nickname: string) => void;
  language: GameLanguage;
}

function projectRectOnCover(
  containerWidth: number,
  containerHeight: number,
  artWidth: number,
  artHeight: number,
  rect: { x: number; y: number; width: number; height: number }
) {
  const scale = Math.max(containerWidth / artWidth, containerHeight / artHeight);
  const offsetX = (containerWidth - artWidth * scale) / 2;
  const offsetY = (containerHeight - artHeight * scale) / 2;
  return {
    left: offsetX + rect.x * scale,
    top: offsetY + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
    scale,
    offsetX,
    offsetY
  };
}

export default function Onboarding({ authToken, onNicknameSet, language }: OnboardingProps) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setFrameSize({
        width: rect.width,
        height: rect.height
      });
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const inputRect = useMemo(() => {
    if (!frameSize.width || !frameSize.height) return { left: 0, top: 0, width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 };
    return projectRectOnCover(frameSize.width, frameSize.height, ONBOARDING_ART_WIDTH, ONBOARDING_ART_HEIGHT, INPUT_RECT);
  }, [frameSize.width, frameSize.height]);

  const continueRect = useMemo(() => {
    if (!frameSize.width || !frameSize.height) return { left: 0, top: 0, width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 };
    return projectRectOnCover(frameSize.width, frameSize.height, ONBOARDING_ART_WIDTH, ONBOARDING_ART_HEIGHT, CONTINUE_RECT);
  }, [frameSize.width, frameSize.height]);

  const errorTop = useMemo(() => {
    if (!frameSize.width || !frameSize.height) return 0;
    const scale = Math.max(frameSize.width / ONBOARDING_ART_WIDTH, frameSize.height / ONBOARDING_ART_HEIGHT);
    const offsetY = (frameSize.height - ONBOARDING_ART_HEIGHT * scale) / 2;
    return offsetY + ERROR_TOP_Y * scale;
  }, [frameSize.width, frameSize.height]);

  const validateNickname = (value: string): string | null => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || trimmed.length > 16) {
      return t(language, 'onboarding.nicknameLength');
    }
    const allowedPattern = /^[\p{L}\p{N}_\s-]+$/u;
    if (!allowedPattern.test(trimmed)) {
      return t(language, 'onboarding.nicknameChars');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateNickname(nickname);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/account/nickname`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ nickname: nickname.trim() }),
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMessage = 'Failed to set nickname';
        try {
          const errorJson = JSON.parse(text);
          if (errorJson.error === 'nickname_taken') {
            errorMessage = t(language, 'onboarding.nicknameTaken');
          } else {
            errorMessage = errorJson.message || errorJson.error || errorMessage;
          }
        } catch (e) {
          errorMessage = text || errorMessage;
        }
        setError(errorMessage);
        return;
      }

      const data = await response.json();
      onNicknameSet(data.nickname);
    } catch (error) {
      console.error('[NICKNAME_SET_FAIL]', error);
      setError(t(language, 'onboarding.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#11253d'
      }}
    >
      <div
        ref={frameRef}
        style={{
          position: 'relative',
          width: '100vw',
          height: 'var(--app-height, 100vh)',
          overflow: 'hidden'
        }}
      >
        <img
          src={onboardingBg}
          alt="Onboarding background"
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />

        <form
          onSubmit={handleSubmit}
          style={{
            position: 'absolute',
            inset: 0
          }}
        >
          <input
            type="text"
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setError(null);
            }}
            placeholder={t(language, 'onboarding.placeholder')}
            disabled={loading}
            style={{
              position: 'absolute',
              left: `${inputRect.left}px`,
              top: `${inputRect.top}px`,
              width: `${inputRect.width}px`,
              height: `${inputRect.height}px`,
              border: 'none',
              borderRadius: `${Math.max(10, inputRect.height * 0.18)}px`,
              outline: 'none',
              backgroundColor: 'transparent',
              color: '#4e4e55',
              fontSize: `${Math.max(14, Math.min(30, inputRect.height * 0.45))}px`,
              fontWeight: 700,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              padding: `0 ${Math.max(10, inputRect.width * 0.042)}px`,
              fontFamily: 'inherit'
            }}
            maxLength={16}
            autoCapitalize="characters"
            autoCorrect="off"
          />
          <button
            type="submit"
            disabled={loading || nickname.trim().length < 3}
            style={{
              position: 'absolute',
              left: `${continueRect.left}px`,
              top: `${continueRect.top}px`,
              width: `${continueRect.width}px`,
              height: `${continueRect.height}px`,
              border: 'none',
              borderRadius: `${Math.max(10, continueRect.height * 0.18)}px`,
              background: 'transparent',
              cursor: loading || nickname.trim().length < 3 ? 'not-allowed' : 'pointer',
              opacity: loading || nickname.trim().length < 3 ? 0.7 : 1,
              color: 'transparent'
            }}
            aria-label={loading ? t(language, 'onboarding.saving') : t(language, 'onboarding.saveAndContinue')}
            title={loading ? t(language, 'onboarding.saving') : t(language, 'onboarding.saveAndContinue')}
          >
            {' '}
          </button>

          {error && (
            <div
              style={{
                position: 'absolute',
                left: `${Math.max(12, inputRect.left * 0.65)}px`,
                right: `${Math.max(12, inputRect.left * 0.65)}px`,
                top: `${errorTop}px`,
                textAlign: 'center',
                color: '#b72929',
                fontWeight: 700,
                fontSize: `${Math.max(12, Math.min(18, inputRect.height * 0.27))}px`,
                textShadow: '0 1px 0 rgba(255,255,255,0.88)'
              }}
            >
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
