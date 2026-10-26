import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import AuthShell from '../components/AuthShell.jsx';
import Field, { fieldAria } from '../components/Field.jsx';
import Notice from '../components/Notice.jsx';
import { clearAuthParams, consumeAuthCallback, isRecoverySession, readAuthCallback } from '../lib/authCallback.js';
import { GENERIC_ERROR, LINK_EXPIRED, LINK_INVALID, authErrorMessage } from '../lib/messages.js';
import { validatePassword } from '../lib/validation.js';

// Reached from the password-reset email. The form is only offered after a recovery callback has been
// consumed on this page, or for a session that Auth issued through a recovery link. A normal signed-in
// session is never enough.
export default function ResetPasswordPage() {
  const [phase, setPhase] = useState('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const link = readAuthCallback(globalThis.location);
      clearAuthParams(globalThis.window);

      let outcome;
      try {
        outcome = await consumeAuthCallback(supabase, link, ['recovery']);
      } catch {
        outcome = 'invalid';
      }
      if (outcome === 'expired' || outcome === 'invalid') {
        setPhase(outcome);
        return;
      }

      let session = null;
      try {
        const { data } = await supabase.auth.getSession();
        session = data?.session ?? null;
      } catch {
        session = null;
      }
      const proven = outcome === 'ok' || (session && isRecoverySession(session));
      setPhase(session && proven ? 'ready' : 'missing');
    })();
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    const problem = validatePassword(password, confirm);
    setErrors(problem ? { password: problem } : {});
    if (problem) return;

    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setNotice({ tone: 'error', text: authErrorMessage(error, 'We could not update your password. Request a new link and try again.') });
        return;
      }
      setPassword('');
      setConfirm('');
      // End the recovery session on this device, so the user signs in with the new password.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setPhase('done');
    } catch {
      setNotice({ tone: 'error', text: GENERIC_ERROR });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={phase === 'ready' ? 'Enter a new password for your account.' : undefined}
      footer={phase === 'done' ? null : <Link to="/auth/login" className="to-link">Back to sign in</Link>}
    >
      {phase === 'checking' && <p role="status" className="to-body">Checking your reset link…</p>}

      {phase === 'ready' && (
        <>
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <form className="to-form" onSubmit={onSubmit} noValidate>
            <Field id="newPassword" label="New password" error={errors.password} hint="At least 8 characters.">
              <input className="rso-input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} {...fieldAria('newPassword', { error: errors.password, hint: 'at least 8 characters' })} />
            </Field>
            <Field id="confirmPassword" label="Confirm new password">
              <input className="rso-input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} {...fieldAria('confirmPassword', { error: errors.password })} />
            </Field>
            <button type="submit" className="rso-btn rso-btn-primary rso-btn-lg to-submit" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </>
      )}

      {phase === 'done' && (
        <>
          <Notice tone="success">Your password has been updated. Sign in with your new password.</Notice>
          <Link to="/auth/login" className="rso-btn rso-btn-primary rso-btn-lg to-submit">Go to sign in</Link>
        </>
      )}

      {phase === 'expired' && (
        <>
          <Notice tone="error">{LINK_EXPIRED}</Notice>
          <Link to="/auth/forgot-password" className="rso-btn rso-btn-primary rso-btn-lg to-submit">Request a new reset link</Link>
        </>
      )}

      {(phase === 'invalid' || phase === 'missing') && (
        <>
          <Notice tone="error">{LINK_INVALID}</Notice>
          <Link to="/auth/forgot-password" className="rso-btn rso-btn-primary rso-btn-lg to-submit">Request a new reset link</Link>
        </>
      )}
    </AuthShell>
  );
}
