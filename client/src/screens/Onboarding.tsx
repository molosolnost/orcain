import { useState } from 'react';
import menuBg from "../assets/orc-theme/menu_bg.svg";
import BackgroundLayout from "../components/BackgroundLayout";
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

  // Slightly higher overlay for input readability (still subtle, art stays visible)
  return (
    <BackgroundLayout bgImage={menuBg} overlay={0.24}>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        gap: '20px',
        padding: '20px',
        width: '100%',
        maxWidth: '500px'
      }}>
        <h1 style={{ fontSize: '36px', margin: 0 }}>{t(language, 'onboarding.title')}</h1>
        <p style={{ fontSize: '18px', color: '#666', textAlign: 'center', maxWidth: '400px' }}>
          {t(language, 'onboarding.subtitle')}
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%', maxWidth: '400px' }}>
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
              padding: '12px',
              fontSize: '16px',
              border: '2px solid #333',
              borderRadius: '8px',
              outline: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.95)'
            }}
            maxLength={16}
          />
          {error && (
            <div style={{ color: 'red', fontSize: '14px', textAlign: 'center' }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || nickname.trim().length < 3}
            style={{
              padding: '12px 24px',
              fontSize: '18px',
              cursor: loading || nickname.trim().length < 3 ? 'not-allowed' : 'pointer',
              opacity: loading || nickname.trim().length < 3 ? 0.7 : 1,
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#646cff',
              color: 'white'
            }}
          >
            {loading ? t(language, 'onboarding.saving') : t(language, 'onboarding.saveAndContinue')}
          </button>
        </form>
      </div>
    </BackgroundLayout>
  );
}
