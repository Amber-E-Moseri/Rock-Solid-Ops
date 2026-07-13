import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabase.js';

const ERROR_MESSAGES = {
  inactive:     'Your account is inactive. Please contact your administrator.',
  pending:      'Your account is pending approval.',
  unauthorized: 'You do not have permission to access that page.',
};

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const errorCode = params.get('error');
  const serverMsg = errorCode ? ERROR_MESSAGES[errorCode] : '';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); return; }
      const next = params.get('next') || '/staff/dashboards';
      navigate(decodeURIComponent(next), { replace: true });
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
        padding: '40px 36px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48,
            borderRadius: 'var(--radius-md)',
            background: 'var(--primary)',
            color: '#fff',
            fontSize: 18, fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>RS</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Rock Solid Ops</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>Sign in to your account</p>
        </div>

        {(error || serverMsg) && (
          <div style={{
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-bd)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--danger)',
            fontSize: 13,
            padding: '10px 14px',
            marginBottom: 20,
          }}>
            {error || serverMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              padding: '11px 0',
              borderRadius: 'var(--radius-md)',
              background: loading ? 'var(--soft-purple)' : 'var(--primary)',
              color: '#fff',
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '9px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  fontWeight: 400,
  outline: 'none',
  transition: 'border-color 0.15s',
};
