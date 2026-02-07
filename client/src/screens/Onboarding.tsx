import { useState } from 'react';
import onboardingBg from '../assets/onboarding_bg.png';
import { t, type GameLanguage } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';

interface OnboardingProps {
  authToken: string;
  onNicknameSet: (nickname: string) => void;
  language: GameLanguage;
}

export default function Onboarding({ authToken, onNicknameSet, language }: OnboardingProps) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        style={{
          position: 'relative',
          width: 'min(100vw, calc(var(--app-height, 100vh) * 2 / 3))',
          maxHeight: 'var(--app-height, 100vh)',
          aspectRatio: '2 / 3',
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
              left: '12.9%',
              top: '83.5%',
              width: '44.6%',
              height: '5.5%',
              border: 'none',
              borderRadius: '14px',
              outline: 'none',
              backgroundColor: 'transparent',
              color: '#4e4e55',
              fontSize: 'clamp(14px, 2.35vw, 28px)',
              fontWeight: 700,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              padding: '0 4.2%',
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
              left: '59.9%',
              top: '83.5%',
              width: '28.7%',
              height: '5.5%',
              border: 'none',
              borderRadius: '14px',
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
                left: '8%',
                right: '8%',
                top: '75.8%',
                textAlign: 'center',
                color: '#b72929',
                fontWeight: 700,
                fontSize: 'clamp(12px, 2.15vw, 16px)',
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
