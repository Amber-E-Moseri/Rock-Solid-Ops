import { useEffect, useRef, useState } from 'react';
import { loadTurnstile } from './turnstile.js';
import './turnstile.css';

// Renders the verification challenge for a public form, or the reason it cannot be shown.
// The parent owns the token. Remount with a new `key` after each submission: tokens are single use.
export default function TurnstileField({ status, onToken, unavailableText, idPrefix = 'turnstile' }) {
  if (!status.configured) {
    if (!status.available) {
      return (
        <p role="alert" className="turnstile-note turnstile-note-error">
          {unavailableText}
        </p>
      );
    }
    return <p className="turnstile-note">Verification is not configured in this environment.</p>;
  }
  return <TurnstileChallenge siteKey={status.siteKey} onToken={onToken} idPrefix={idPrefix} />;
}

function TurnstileChallenge({ siteKey, onToken, idPrefix }) {
  const containerRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const [phase, setPhase] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    let widgetId = null;
    let turnstile = null;

    onTokenRef.current('');
    setPhase('loading');

    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        turnstile = api;
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          callback: (token) => {
            setPhase('verified');
            onTokenRef.current(token);
          },
          'expired-callback': () => {
            setPhase('expired');
            onTokenRef.current('');
          },
          'timeout-callback': () => {
            setPhase('expired');
            onTokenRef.current('');
          },
          'error-callback': () => {
            setPhase('error');
            onTokenRef.current('');
          },
        });
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setPhase('error');
          onTokenRef.current('');
        }
      });

    return () => {
      cancelled = true;
      if (turnstile && widgetId !== null) {
        try {
          turnstile.remove(widgetId);
        } catch {
          // The widget node is already gone. Nothing else to clean up.
        }
      }
    };
  }, [siteKey, attempt]);

  const message = {
    loading: 'Loading verification…',
    ready: 'Complete the verification to continue.',
    verified: 'Verification complete.',
    expired: 'Verification expired. Complete it again.',
    error: 'The verification check did not load or failed.',
  }[phase];

  return (
    <div className="turnstile-field">
      <div ref={containerRef} id={`${idPrefix}-widget`} className="turnstile-widget" />
      <p className={phase === 'error' || phase === 'expired' ? 'turnstile-note turnstile-note-error' : 'turnstile-note'} role="status">
        {message}
      </p>
      {phase === 'error' && (
        <button type="button" className="rso-btn rso-btn-secondary rso-btn-md" onClick={() => setAttempt((value) => value + 1)}>
          Try verification again
        </button>
      )}
    </div>
  );
}
