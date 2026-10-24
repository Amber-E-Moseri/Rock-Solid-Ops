import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabase.js';
import { postLoginPath } from './postLoginPath.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { TEACHER_ONBOARDING_CERTIFIED } from '../../releaseHolds.js';

const ERROR_MESSAGES = {
  inactive:     'Your account is inactive. Please contact your administrator.',
  pending:      'Your account is pending approval.',
  unauthorized: 'You do not have permission to access that page.',
  session:      'We could not load your account. Please sign in again.',
};

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [resetMsg, setResetMsg] = useState('');
  const [resetPending, setResetPending] = useState(false);
  // Set once Supabase accepts the password. Navigation waits until the auth
  // context has the profile, so the route guard never sees a half-finished sign-in.
  const [pendingNext, setPendingNext] = useState(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, profile, loading: sessionLoading, error: sessionError } = useAuth();

  const errorCode = params.get('error');
  const serverMsg = errorCode ? ERROR_MESSAGES[errorCode] : '';
  const busy = loading || Boolean(pendingNext);

  useEffect(() => {
    if (!pendingNext || sessionLoading) return;
    if (user && profile) {
      setPendingNext(null);
      navigate(
        postLoginPath({
          role: profile.role,
          next: pendingNext.next,
          teacherOnboardingEnabled: TEACHER_ONBOARDING_CERTIFIED,
        }),
        { replace: true },
      );
      return;
    }
    setPendingNext(null);
    setError(sessionError ? ERROR_MESSAGES.session : 'Sign-in did not complete. Please try again.');
  }, [pendingNext, sessionLoading, user, profile, sessionError, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); return; }
      setPendingNext({ next: params.get('next') });
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setResetMsg('Enter your email address first.');
      return;
    }
    setResetPending(true);
    setResetMsg('Sending reset link...');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/reset-password`,
    });
    setResetPending(false);
    if (resetError) {
      setResetMsg('Could not send reset link. Please try again or contact support.');
      return;
    }
    setResetMsg('Check your email for a reset link.');
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
            disabled={busy}
            style={{
              marginTop: 8,
              padding: '11px 0',
              borderRadius: 'var(--radius-md)',
              background: busy ? 'var(--soft-purple)' : 'var(--primary)',
              color: '#fff',
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={TEACHER_ONBOARDING_CERTIFIED ? () => navigate('/auth/forgot-password') : handleForgotPassword}
            disabled={resetPending}
            style={forgotButtonStyle}
          >
            Forgot password?
          </button>
        </form>

        {TEACHER_ONBOARDING_CERTIFIED && (
          <button
            type="button"
            onClick={() => navigate('/auth/teacher/register')}
            style={forgotButtonStyle}
          >
            New teacher? Apply to teach
          </button>
        )}

        {resetMsg && (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '12px 0 0', lineHeight: 1.5 }}>
            {resetMsg}
          </p>
        )}
      </div>
    </div>
  );
}

const forgotButtonStyle = {
  appearance: 'none',
  background: 'transparent',
  border: 0,
  color: 'var(--primary)',
  textDecoration: 'underline',
  padding: 0,
  marginTop: 2,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  alignSelf: 'flex-start',
};

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
