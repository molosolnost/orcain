import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';

interface LoginProps {
  onLoginSuccess: (data: { authToken: string; tokens: number }) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
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
        const text = await response.text();
        console.error('[AUTH_GUEST_FAIL]', response.status, text);
        
        let errorMessage = 'Server error';
        try {
          const errorJson = JSON.parse(text);
          errorMessage = errorJson.message || errorJson.error || `Server error ${response.status}`;
        } catch (e) {
          errorMessage = text || `Server error ${response.status}`;
        }
        
        setError(errorMessage);
        return;
      }

      const data = await response.json();
      const { accountId, authToken, tokens } = data;
      
      // Сохраняем authToken и accountId в localStorage
      localStorage.setItem('orcain_authToken', authToken);
      localStorage.setItem('orcain_accountId', accountId);
      
      // Вызываем callback для обновления App (accountId сохраняется в localStorage, не передаём в callback)
      onLoginSuccess({ authToken, tokens });
    } catch (error) {
      console.error('[AUTH_GUEST_FAIL]', 'network error', error);
      setError('Failed to create account. Please try again.');
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
      height: '100vh',
      gap: '20px'
    }}>
      <h1 style={{ fontSize: '48px', margin: 0 }}>ORCAIN</h1>
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
        {loading ? 'Creating account...' : 'Create account'}
      </button>
      {error && (
        <div style={{ color: 'red', marginTop: '10px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
