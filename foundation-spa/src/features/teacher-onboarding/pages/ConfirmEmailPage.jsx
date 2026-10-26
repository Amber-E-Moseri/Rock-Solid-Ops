import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import AuthShell from '../components/AuthShell.jsx';
import Notice from '../components/Notice.jsx';
import { clearAuthParams, consumeAuthCallback, readAuthCallback } from '../lib/authCallback.js';
import { GENERIC_ERROR, LINK_EXPIRED, LINK_INVALID } from '../lib/messages.js';

export default function ConfirmEmailPage() {
  const [phase, setPhase] = useState('checking');
  const started = useRef(false);

  useEffect(() => {
    // Strict-mode double mounts must not exchange the same one-time code twice.
    if (started.current) return;
    started.current = true;

    (async () => {
      const link = readAuthCallback(globalThis.location);
      clearAuthParams(globalThis.window);
      try {
        const outcome = await consumeAuthCallback(supabase, link, ['signup', 'email']);
        if (outcome === 'ok') {
          setPhase('confirmed');
          return;
        }
        if (outcome === 'expired') {
          setPhase('expired');
          return;
        }
        if (outcome === 'invalid') {
          setPhase('invalid');
          return;
        }
        // 'none': the client may already have consumed an implicit-flow callback at start-up.
        const { data } = await supabase.auth.getSession();
        setPhase(data?.session ? 'confirmed' : 'missing');
      } catch {
        setPhase('error');
      }
    })();
  }, []);

  return (
    <AuthShell title="Confirm your email">
      {phase === 'checking' && (
        <p role="status" className="to-body">Confirming your email address…</p>
      )}
      {phase === 'confirmed' && (
        <>
          <Notice tone="success">Your email address is confirmed. You can now complete your teacher application.</Notice>
          <Link to="/auth/teacher/application" className="rso-btn rso-btn-primary rso-btn-lg to-submit">Continue to your application</Link>
        </>
      )}
      {phase === 'expired' && (
        <>
          <Notice tone="error">{LINK_EXPIRED}</Notice>
          <Link to="/auth/teacher/check-email" className="rso-btn rso-btn-secondary rso-btn-lg to-submit">Request a new link</Link>
        </>
      )}
      {(phase === 'invalid' || phase === 'missing') && (
        <>
          <Notice tone="error">{LINK_INVALID}</Notice>
          <Link to="/auth/teacher/register" className="rso-btn rso-btn-secondary rso-btn-lg to-submit">Back to registration</Link>
        </>
      )}
      {phase === 'error' && (
        <>
          <Notice tone="error">{GENERIC_ERROR}</Notice>
          <Link to="/auth/login" className="to-link">Go to sign in</Link>
        </>
      )}
    </AuthShell>
  );
}
