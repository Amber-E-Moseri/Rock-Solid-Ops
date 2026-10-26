import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ErrorBanner from '../../components/ui/ErrorBanner.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import AccessRequestForm from './AccessRequestForm.jsx';
import {
  OPEN_STATUSES, ROLE_LABELS, statusInfo, friendlyMessage,
  loadAccessOptions, loadMyRequests, withdrawMyRequest,
} from './lib/accessRequest.js';
import './accessRequest.css';

const MIN_PASSWORD = 8;

// Where the confirmation link returns the applicant: this page, signed in, with the form available.
function returnUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}auth/request-access`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function RequestAccessPage() {
  const { user, loading, signOut } = useAuth();

  return (
    <main className="ar-page">
      <header className="ar-header">
        <div className="ar-brand" aria-hidden="true">RS</div>
        <div>
          <h1 className="ar-title">Request access</h1>
          <p className="ar-sub">Ask for a staff role. A reviewer checks every request before any access is granted.</p>
        </div>
      </header>

      {loading && <Skeleton variant="card" />}
      {!loading && !user && <AccountStep />}
      {!loading && user && !user.email_confirmed_at && <VerifyStep email={user.email} onSignOut={signOut} />}
      {!loading && user && user.email_confirmed_at && <RequestPanel />}
    </main>
  );
}

// ── Signed out: sign in, or create an account that must confirm its email before filing ─────

function AccountStep() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (mode === 'sent') {
    return (
      <section className="ar-card" aria-labelledby="ar-sent-title">
        <h2 id="ar-sent-title" className="ar-section-title">Check your email</h2>
        <p>We sent a confirmation link to <strong>{email.trim()}</strong>. Open the link, then come back to this page and sign in to finish your request.</p>
        <Button variant="secondary" onClick={() => setMode('signin')}>Back to sign in</Button>
      </section>
    );
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) setError(authError.message);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: returnUrl() },
    });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    // A session here means the project does not require confirmation. The page then shows the verified state.
    if (!data?.session) setMode('sent');
  }

  const isCreate = mode === 'create';
  return (
    <section className="ar-card" aria-labelledby="ar-account-title">
      <h2 id="ar-account-title" className="ar-section-title">{isCreate ? 'Create an account' : 'Sign in to request access'}</h2>
      <p className="ar-help">
        {isCreate
          ? 'You will confirm your email address first. Your account has no staff access until a reviewer approves a request.'
          : 'Sign in with the account you use for Rock Solid Ops. New to Rock Solid Ops? Create an account instead.'}
      </p>

      {error && <ErrorBanner message={error} />}

      <form className="ar-stack" onSubmit={isCreate ? handleCreate : handleSignIn} noValidate>
        <div className="rso-field">
          <label htmlFor="ar-email">Email address</label>
          <input id="ar-email" className="rso-input" type="email" autoComplete="email" required
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="rso-field">
          <label htmlFor="ar-password">Password</label>
          <input id="ar-password" className="rso-input" type="password" required
                 autoComplete={isCreate ? 'new-password' : 'current-password'}
                 aria-describedby={isCreate ? 'ar-password-help' : undefined}
                 value={password} onChange={(e) => setPassword(e.target.value)} />
          {isCreate && <p id="ar-password-help" className="ar-help">At least {MIN_PASSWORD} characters.</p>}
        </div>
        {isCreate && (
          <div className="rso-field">
            <label htmlFor="ar-confirm">Confirm password</label>
            <input id="ar-confirm" className="rso-input" type="password" required autoComplete="new-password"
                   value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        )}
        <div className="ar-actions">
          <Button type="submit" variant="primary" size="md" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Please wait…' : isCreate ? 'Create account' : 'Sign in'}
          </Button>
          <Button variant="ghost" size="md" type="button" onClick={() => { setError(''); setMode(isCreate ? 'signin' : 'create'); }}>
            {isCreate ? 'I already have an account' : 'Create an account'}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ── Signed in, email not yet confirmed ──────────────────────────────────────

function VerifyStep({ email, onSignOut }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function resend() {
    setError('');
    setBusy(true);
    const { error: authError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: returnUrl() },
    });
    setBusy(false);
    if (authError) setError(authError.message);
    else setSent(true);
  }

  return (
    <section className="ar-card" aria-labelledby="ar-verify-title">
      <h2 id="ar-verify-title" className="ar-section-title">Confirm your email to continue</h2>
      <p>Open the confirmation link we sent to <strong>{email}</strong>. You can request access after that.</p>
      {error && <ErrorBanner message={error} />}
      {sent && <p role="status" className="ar-help">A new confirmation link is on its way.</p>}
      <div className="ar-actions">
        <Button variant="secondary" onClick={resend} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Sending…' : 'Send the link again'}
        </Button>
        <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
      </div>
    </section>
  );
}

// ── Signed in and verified: the request, or the request already on file ───────

function RequestPanel() {
  const { user } = useAuth();
  const [options, setOptions] = useState({ status: 'loading', tree: [], error: '' });
  const [mine, setMine] = useState({ status: 'loading', items: [], error: '' });
  const [success, setSuccess] = useState(null);
  const [withdrawError, setWithdrawError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setMine({ status: 'ready', items: await loadMyRequests(), error: '' });
    } catch (err) {
      setMine({ status: 'error', items: [], error: friendlyMessage(err, 'Your requests could not be loaded.') });
    }
  }, []);

  const loadOptions = useCallback(async () => {
    setOptions({ status: 'loading', tree: [], error: '' });
    try {
      setOptions({ status: 'ready', tree: await loadAccessOptions(), error: '' });
    } catch (err) {
      setOptions({ status: 'error', tree: [], error: friendlyMessage(err, 'The group list could not be loaded.') });
    }
  }, []);

  useEffect(() => {
    refresh();
    loadOptions();
  }, [refresh, loadOptions]);

  async function withdraw(item) {
    setWithdrawError('');
    try {
      await withdrawMyRequest(item);
      setSuccess(null);
      await refresh();
    } catch (err) {
      setWithdrawError(friendlyMessage(err, 'The request could not be withdrawn. Reload and try again.'));
    }
  }

  if (success) {
    return <SuccessCard result={success.result} role={success.role} onAnother={() => { setSuccess(null); refresh(); }} />;
  }

  if (mine.status === 'loading') return <Skeleton variant="card" />;
  if (mine.status === 'error') return <ErrorBanner message={mine.error} onRetry={refresh} />;

  const open = mine.items.find((i) => OPEN_STATUSES.includes(i.status));
  const past = mine.items.filter((i) => !OPEN_STATUSES.includes(i.status));

  return (
    <div className="ar-stack">
      {withdrawError && <ErrorBanner message={withdrawError} />}

      {open && open.status !== 'INFO_REQUESTED' && (
        <ExistingRequest item={open} onWithdraw={withdraw} />
      )}

      {(!open || open.status === 'INFO_REQUESTED') && (
        <section className="ar-card" aria-live="polite">
          {open && open.status === 'INFO_REQUESTED' && (
            <div className="ar-notice" role="status">
              <strong>A reviewer asked for more information.</strong>
              {open.reviewMessage && <p className="ar-message">“{open.reviewMessage}”</p>}
              <p className="ar-help">Update your request below and send it again. Your reviewer will see the new version.</p>
            </div>
          )}
          {options.status === 'loading' && <Skeleton variant="card" />}
          {options.status === 'error' && <ErrorBanner message={options.error} onRetry={loadOptions} />}
          {options.status === 'ready' && (
            <AccessRequestForm
              tree={options.tree}
              email={user.email}
              initial={open ? {
                requestedRole: open.role,
                fullName: open.fullName || '',
                fellowshipCode: open.fellowshipCode || '',
                groupId: open.groupId || '',
                subgroupId: open.subgroupId || '',
                note: open.note || '',
              } : undefined}
              submitLabel={open ? 'Send updated request' : 'Submit request'}
              onSubmitted={(result, draft) => setSuccess({ result, role: draft.requestedRole })}
            />
          )}
        </section>
      )}

      {past.length > 0 && <PastRequests items={past} />}
    </div>
  );
}

function ExistingRequest({ item, onWithdraw }) {
  const info = statusInfo(item.status);
  const canWithdraw = item.status === 'SUBMITTED';
  return (
    <section className="ar-card" aria-labelledby="ar-existing-title">
      <h2 id="ar-existing-title" className="ar-section-title">You already have an open request</h2>
      <dl className="ar-facts">
        <div><dt>Requested role</dt><dd>{ROLE_LABELS[item.role] || item.role}</dd></div>
        <div><dt>Status</dt><dd><Badge variant={info.variant}>{info.label}</Badge></dd></div>
        <div><dt>Submitted</dt><dd>{formatDate(item.submittedAt)}</dd></div>
      </dl>
      <p className="ar-help">{info.detail}</p>
      {item.status === 'APPROVAL_PENDING_PROVISIONING' && (
        <p className="ar-help">You cannot change or withdraw this request. Contact an administrator if something is wrong.</p>
      )}
      {canWithdraw && (
        <div className="ar-actions">
          <Button variant="secondary" onClick={() => onWithdraw(item)}>Withdraw this request</Button>
          <p className="ar-help">Withdrawing lets you file a new request.</p>
        </div>
      )}
    </section>
  );
}

function PastRequests({ items }) {
  return (
    <section className="ar-card" aria-labelledby="ar-past-title">
      <h2 id="ar-past-title" className="ar-section-title">Earlier requests</h2>
      <ul className="ar-list">
        {items.map((item) => {
          const info = statusInfo(item.status);
          return (
            <li key={`${item.kind}-${item.id}`} className="ar-list-item">
              <span>{ROLE_LABELS[item.role] || item.role} · {formatDate(item.submittedAt)}</span>
              <Badge variant={info.variant}>{info.label}</Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SuccessCard({ result, role, onAnother }) {
  const info = statusInfo(result?.status || 'SUBMITTED');
  const unchanged = result?.outcome === 'UNCHANGED';
  const isTeacher = result?.kind === 'teacher' || role === 'teacher';
  return (
    <section className="ar-card" aria-labelledby="ar-success-title">
      <h2 id="ar-success-title" className="ar-section-title">
        {unchanged ? 'Your request is already on file' : 'Your request was received'}
      </h2>
      <p>
        {isTeacher
          ? 'Your teacher application is in the review queue.'
          : `Your ${ROLE_LABELS[role] || 'access'} request is in the review queue.`}
      </p>
      <p><Badge variant={info.variant}>{info.label}</Badge></p>
      <p className="ar-help">
        Access is not active yet. A reviewer checks every request. Approval records a decision; your account is set up separately.
      </p>
      <div className="ar-actions">
        <Button variant="secondary" onClick={onAnother}>Back to my requests</Button>
      </div>
    </section>
  );
}
