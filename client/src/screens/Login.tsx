interface LoginProps {
  onLogin: (accountId: string, authToken: string, tokens: number) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const handleCreateAccount = async () => {
    try {
      const response = await fetch('http://localhost:3001/auth/guest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to create account');
      }

      const data = await response.json();
      
      // Сохраняем authToken и accountId в localStorage
      localStorage.setItem('orcain_authToken', data.authToken);
      localStorage.setItem('orcain_accountId', data.accountId);
      
      onLogin(data.accountId, data.authToken, data.tokens);
    } catch (error) {
      console.error('Error creating account:', error);
      alert('Failed to create account. Please try again.');
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
        style={{
          padding: '12px 24px',
          fontSize: '18px',
          cursor: 'pointer'
        }}
      >
        Create account
      </button>
    </div>
  );
}
