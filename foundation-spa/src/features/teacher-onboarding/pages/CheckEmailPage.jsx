import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import AuthShell from '../components/AuthShell.jsx';
import Field, { fieldAria } from '../components/Field.jsx';
import Notice from '../components/Notice.jsx';
import useCooldown from '../lib/useCooldown.js';
import { AUTH_REDIRECT_PATHS, buildAuthRedirect } from '../lib/redirects.js';
import { RESEND_SENT, GENERIC_ERROR, RATE_LIMIT, VERIFICATION_REQUIRED, VERIFICATION_UNAVAILABLE, isRateLimit } from '../lib/messages.js';
import { normalizeEmail, validateEmail } from '../lib/validation.js';
import TurnstileField from '../../../components/security/TurnstileField.jsx';
import { captchaOptions, captchaReady, turnstileStatus } from '../../../components/security/turnstile.js';

export default function CheckEmailPage() {
  const location = useLocation();
  const [email, setEmail] = useState(normalizeEmail(location.state?.email || ''));
  const [notice, setNotice] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown(60);
  const captcha = turnstileStatus(import.meta.env);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);

  async function resend(event) {
    event.preventDefault();
    if (busy || cooldown.remaining > 0) return;
    const problem = validateEmail(email);
    setEmailError(problem || '');
    if (problem) return;

    const redirect = buildAuthRedirect(AUTH_REDIRECT_PATHS.CONFIRM_EMAIL, import.meta.env);
    if (!redirect) {
      setNotice({ tone: 'error', text: 'This site is not configured for account email links. Contact an administrator.' });
      return;
    }
    if (!captchaReady(captcha, captchaToken)) {
      setNotice({ tone: 'error', text: VERIFICATION_REQUIRED });
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: normalizeEmail(email),
        options: { emailRedirectTo: redirect, ...captchaOptions(captcha, captchaToken) },
      });
      // Unknown addresses do not error, so the same message covers registered and unregistered ones.
      if (isRateLimit(error)) setNotice({ tone: 'error', text: RATE_LIMIT });
      else if (error) setNotice({ tone: 'error', text: GENERIC_ERROR });
      else setNotice({ tone: 'success', text: RESEND_SENT });
      cooldown.start();
    } catch {
      setNotice({ tone: 'error', text: GENERIC_ERROR });
    } finally {
      setBusy(false);
      setCaptchaToken('');
      setCaptchaKey((value) => value + 1);
    }
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle="We sent a confirmation link. Open it on this device. It is valid for a limited time."
      footer={<><Link to="/auth/login" className="to-link">Back to sign in</Link></>}
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <p className="to-body">
        Did not get it? Check your spam folder, or request a new link below.
      </p>
      <form className="to-form" onSubmit={resend} noValidate>
        <Field id="resendEmail" label="Email" error={emailError}>
          <input className="rso-input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} {...fieldAria('resendEmail', { error: emailError })} />
        </Field>
        <TurnstileField
          key={captchaKey}
          status={captcha}
          onToken={setCaptchaToken}
          unavailableText={VERIFICATION_UNAVAILABLE}
          idPrefix="resend"
        />
        <button type="submit" className="rso-btn rso-btn-secondary rso-btn-lg to-submit" disabled={busy || cooldown.remaining > 0 || !captchaReady(captcha, captchaToken)}>
          {cooldown.remaining > 0 ? `Resend available in ${cooldown.remaining}s` : 'Resend confirmation link'}
        </button>
      </form>
    </AuthShell>
  );
}
