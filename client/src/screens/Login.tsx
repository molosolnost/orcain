import { useState } from 'react';
import { DEFAULT_AVATAR, DEFAULT_LANGUAGE, t, type AvatarId, type GameLanguage } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';

interface LoginProps {
  onLoginSuccess: (data: { authToken: string; tokens: number; nickname?: string | null; language?: GameLanguage; avatar?: AvatarId }) => void;
  language: GameLanguage;
}

export default function Login({ onLoginSuccess, language }: LoginProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateAccount = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/auth/guest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to create account');
      }

      const data = await response.json();
      const { accountId, authToken, tokens, nickname, avatar, language: profileLanguage } = data;
      
      // Сохраняем authToken и accountId в localStorage
      localStorage.setItem('orcain_authToken', authToken);
      localStorage.setItem('orcain_accountId', accountId);
      
      // Вызываем callback для обновления App (accountId сохраняется в localStorage, не передаём в callback)
      onLoginSuccess({
        authToken,
        tokens,
        nickname: nickname || null,
        avatar: (avatar || DEFAULT_AVATAR) as AvatarId,
        language: (profileLanguage === 'en' || profileLanguage === 'ru') ? profileLanguage : DEFAULT_LANGUAGE
      });
    } catch (error) {
      setError(t(language, 'login.createError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      height: 'var(--app-height)',
      gap: '20px',
      backgroundColor: '#111'
    }}>
      <h1 style={{ fontSize: '48px', margin: 0 }}>{t(language, 'login.title')}</h1>
      <button 
        onClick={handleCreateAccount}
        disabled={loading}
        style={{
          padding: '12px 24px',
          fontSize: '18px',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1
        }}
      >
        {loading ? t(language, 'login.creatingAccount') : t(language, 'login.createAccount')}
      </button>
      {error && (
        <div style={{ color: 'red', marginTop: '10px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
