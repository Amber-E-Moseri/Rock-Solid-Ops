import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import AuthShell from '../components/AuthShell.jsx';
import Field, { fieldAria } from '../components/Field.jsx';
import Notice from '../components/Notice.jsx';
import { AUTH_REDIRECT_PATHS, buildAuthRedirect } from '../lib/redirects.js';
import { GENERIC_ERROR, authErrorMessage } from '../lib/messages.js';
import { hasErrors, normalizeEmail, validateRegistration } from '../lib/validation.js';

const EMPTY = { fullName: '', email: '', password: '', confirm: '' };

export default function TeacherRegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // A signed-in user has nothing to register. Send them to their application instead.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data?.session) navigate('/auth/teacher/application', { replace: true });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [navigate]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    setNotice(null);

    const nextErrors = validateRegistration(form);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    const redirect = buildAuthRedirect(AUTH_REDIRECT_PATHS.CONFIRM_EMAIL, import.meta.env);
    if (!redirect) {
      setNotice({ tone: 'error', text: 'This site is not configured for account email links. Contact an administrator.' });
      return;
    }

    inFlight.current = true;
    setBusy(true);
    const email = normalizeEmail(form.email);
    try {
      // No role or status is sent. The profile trigger creates every new account as pending.
      const { error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          data: { full_name: form.fullName.trim() },
          emailRedirectTo: redirect,
        },
      });
      if (error) {
        setNotice({
          tone: 'error',
          text: authErrorMessage(error, 'We could not create your account. Check your details and try again.'),
        });
        return;
      }
      // Existing and new addresses take the same path, so the response reveals nothing about accounts.
      navigate('/auth/teacher/check-email', { state: { email } });
    } catch {
      setNotice({ tone: 'error', text: GENERIC_ERROR });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Apply to teach"
      subtitle="Create your account first. You will confirm your email, then complete your teacher application."
      footer={<>Already have an account? <Link to="/auth/login" className="to-link">Sign in</Link></>}
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <form className="to-form" onSubmit={onSubmit} noValidate>
        <Field id="fullName" label="Full name" error={errors.fullName}>
          <input className="rso-input" type="text" autoComplete="name" value={form.fullName} onChange={update('fullName')} {...fieldAria('fullName', { error: errors.fullName })} />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input className="rso-input" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={update('email')} {...fieldAria('email', { error: errors.email })} />
        </Field>
        <Field id="password" label="Password" error={errors.password} hint="At least 8 characters.">
          <input className="rso-input" type="password" autoComplete="new-password" value={form.password} onChange={update('password')} {...fieldAria('password', { error: errors.password, hint: 'at least 8 characters' })} />
        </Field>
        <Field id="confirm" label="Confirm password">
          <input className="rso-input" type="password" autoComplete="new-password" value={form.confirm} onChange={update('confirm')} {...fieldAria('confirm', { error: errors.password })} />
        </Field>
        <button type="submit" className="rso-btn rso-btn-primary rso-btn-lg to-submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
