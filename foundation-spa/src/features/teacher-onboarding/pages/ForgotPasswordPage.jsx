import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import AuthShell from '../components/AuthShell.jsx';
import Field, { fieldAria } from '../components/Field.jsx';
import Notice from '../components/Notice.jsx';
import useCooldown from '../lib/useCooldown.js';
import { AUTH_REDIRECT_PATHS, buildAuthRedirect } from '../lib/redirects.js';
import { GENERIC_ERROR, RATE_LIMIT, RECOVERY_SENT, VERIFICATION_REQUIRED, VERIFICATION_UNAVAILABLE, isRateLimit } from '../lib/messages.js';
import { normalizeEmail, validateEmail } from '../lib/validation.js';
import TurnstileField from '../../../components/security/TurnstileField.jsx';
import { captchaOptions, captchaReady, turnstileStatus } from '../../../components/security/turnstile.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const cooldown = useCooldown(60);
  const captcha = turnstileStatus(import.meta.env);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);

  async function onSubmit(event) {
    event.preventDefault();
    if (inFlight.current || cooldown.remaining > 0) return;

    const problem = validateEmail(email);
    setEmailError(problem || '');
    if (problem) return;

    const redirect = buildAuthRedirect(AUTH_REDIRECT_PATHS.RESET_PASSWORD, import.meta.env);
    if (!redirect) {
      setNotice({ tone: 'error', text: 'This site is not configured for account email links. Contact an administrator.' });
      return;
    }

    if (!captchaReady(captcha, captchaToken)) {
      setNotice({ tone: 'error', text: VERIFICATION_REQUIRED });
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: redirect,
        ...captchaOptions(captcha, captchaToken),
      });
      // Unknown addresses do not error, so an error here is a system or rate-limit problem, never a lookup result.
      if (isRateLimit(error)) setNotice({ tone: 'error', text: RATE_LIMIT });
      else if (error) setNotice({ tone: 'error', text: GENERIC_ERROR });
      else setNotice({ tone: 'success', text: RECOVERY_SENT });
      cooldown.start();
    } catch {
      setNotice({ tone: 'error', text: GENERIC_ERROR });
    } finally {
      inFlight.current = false;
      setBusy(false);
      setCaptchaToken('');
      setCaptchaKey((value) => value + 1);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email address you use. If it matches an account, we will send a reset link."
      footer={<Link to="/auth/login" className="to-link">Back to sign in</Link>}
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <form className="to-form" onSubmit={onSubmit} noValidate>
        <Field id="resetEmail" label="Email" error={emailError}>
          <input className="rso-input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} {...fieldAria('resetEmail', { error: emailError })} />
        </Field>
        <TurnstileField
          key={captchaKey}
          status={captcha}
          onToken={setCaptchaToken}
          unavailableText={VERIFICATION_UNAVAILABLE}
          idPrefix="reset"
        />
        <button type="submit" className="rso-btn rso-btn-primary rso-btn-lg to-submit" disabled={busy || cooldown.remaining > 0 || !captchaReady(captcha, captchaToken)}>
          {cooldown.remaining > 0 ? `Send again in ${cooldown.remaining}s` : busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthShell>
  );
}
