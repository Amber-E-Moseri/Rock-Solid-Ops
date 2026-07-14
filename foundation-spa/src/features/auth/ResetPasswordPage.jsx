import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase.js';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [sessionReady, setSessionReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // auth-client's detectSessionInUrl equivalent (supabase.js also sets
  // detectSessionInUrl: true) automatically exchanges the #access_token in
  // the URL and fires PASSWORD_RECOVERY.
  useEffect(() => {
    let cancelled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setSessionReady(true);
      }
    });

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        setSessionReady(true);
        return;
      }

      const hash = window.location.hash || '';
      const hasToken = hash.includes('access_token') || hash.includes('type=recovery');
      if (!hasToken) {
        // Give detectSessionInUrl a moment in case the hash exchange is still in flight.
        await new Promise((r) => setTimeout(r, 1200));
        if (cancelled) return;
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        if (retrySession) {
          setSessionReady(true);
        } else {
          setLinkInvalid(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    if (!sessionReady) {
      await new Promise((r) => setTimeout(r, 1200));
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message || 'Could not update password. The link may have expired — request a new one.');
      setSubmitting(false);
      return;
    }

    // Do not await signOut() here — the SIGNED_OUT handler in AuthContext
    // would clear state and could race the redirect. Let the recovery
    // session expire naturally.
    setSuccess(true);
    setTimeout(() => navigate('/auth/login', { replace: true }), 2000);
  }

  if (linkInvalid) {
    return (
      <AuthCard title="Reset Password">
        <p style={msgStyle('error')}>
          This link is invalid or has already been used.{' '}
          <a href="/auth/login" style={linkStyle}>Request a new one</a>.
        </p>
      </AuthCard>
    );
  }

  if (success) {
    return (
      <AuthCard title="Reset Password">
        <p style={msgStyle('success')}>Password updated. Redirecting to sign in…</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset Password" subtitle="Enter a new password for your account.">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="password"
          required
          placeholder="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          required
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyle}
        />
        <button type="submit" disabled={submitting} style={submitStyle(submitting)}>
          {submitting ? 'Saving…' : 'Set New Password'}
        </button>
      </form>
      {error && <p style={msgStyle('error')}>{error}</p>}
    </AuthCard>
  );
}

function AuthCard({ title, subtitle, children }) {
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
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 16px' }}>{subtitle}</p>}
        {children}
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
  outline: 'none',
};

function submitStyle(disabled) {
  return {
    marginTop: 8,
    padding: '11px 0',
    borderRadius: 'var(--radius-md)',
    background: disabled ? 'var(--soft-purple)' : 'var(--primary)',
    color: '#fff',
    border: 'none',
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function msgStyle(kind) {
  return {
    fontSize: 14,
    margin: '12px 0 0',
    lineHeight: 1.5,
    color: kind === 'error' ? 'var(--danger)' : 'var(--success, #067647)',
  };
}

const linkStyle = { color: 'var(--primary)', textDecoration: 'underline' };
