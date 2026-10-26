import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import AuthShell from '../components/AuthShell.jsx';
import Field, { fieldAria } from '../components/Field.jsx';
import Notice from '../components/Notice.jsx';
import {
  currentApplicationView,
  fetchActiveFellowships,
  fetchApplicantRole,
  fetchMyApplications,
  submitApplication,
  withdrawApplication,
} from '../lib/applicationApi.js';
import { GENERIC_ERROR, applicationErrorMessage, submitOutcomeMessage } from '../lib/messages.js';
import { NOTES_MAX, hasErrors, validateApplication } from '../lib/validation.js';

const EMPTY_FORM = { fullName: '', phone: '', fellowshipCode: '', notes: '' };

export default function ApplicationPage() {
  const [session, setSession] = useState(undefined);
  const [load, setLoad] = useState({ state: 'loading' });
  const [applications, setApplications] = useState([]);
  const [fellowships, setFellowships] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession()
      .then(({ data }) => { if (!cancelled) setSession(data?.session ?? null); })
      .catch(() => { if (!cancelled) setSession(null); });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async (user) => {
    setLoad({ state: 'loading' });
    try {
      // Any failure here is an error state. It never falls back to showing the applicant form.
      const profile = await fetchApplicantRole(supabase, user.id);
      if (profile?.role && profile.role !== 'pending') {
        setLoad({ state: 'not-applicant', role: profile.role });
        return;
      }
      const [rows, options] = await Promise.all([fetchMyApplications(supabase), fetchActiveFellowships(supabase)]);
      setApplications(rows);
      setFellowships(options);
      setForm((current) => ({
        ...current,
        fullName: current.fullName || profile?.full_name || user.user_metadata?.full_name || '',
      }));
      setLoad({ state: 'ready' });
    } catch {
      setLoad({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setLoad({ state: 'signed-out' });
      return;
    }
    refresh(session.user);
  }, [session, refresh]);

  const { current, view } = currentApplicationView(applications);

  // Pre-fill the editable form from the current application, once per version.
  useEffect(() => {
    if (!current || (view !== 'info' && view !== 'apply')) return;
    setForm((prev) => ({
      ...prev,
      fullName: current.full_name || prev.fullName,
      phone: current.phone || '',
      fellowshipCode: current.fellowship_code || '',
      notes: current.notes || '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.version, view]);

  function update(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    setNotice(null);

    const nextErrors = validateApplication(form);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    inFlight.current = true;
    setBusy(true);
    try {
      const result = await submitApplication(supabase, form);
      setNotice({
        tone: 'success',
        text: submitOutcomeMessage(result?.outcome),
      });
      await refresh(session.user);
    } catch (error) {
      setNotice({ tone: 'error', text: applicationErrorMessage(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (inFlight.current || !current) return;
    if (!confirmWithdraw) {
      setConfirmWithdraw(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      await withdrawApplication(supabase, current);
      setConfirmWithdraw(false);
      setNotice({ tone: 'success', text: 'Your application has been withdrawn.' });
      await refresh(session.user);
    } catch (error) {
      setNotice({ tone: 'error', text: applicationErrorMessage(error) });
      if (String(error?.message || '').startsWith('VERSION_CONFLICT')) await refresh(session.user);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (load.state === 'loading' || session === undefined) {
    return (
      <AuthShell title="Your teacher application">
        <p role="status" className="to-body">Loading your application…</p>
      </AuthShell>
    );
  }

  if (load.state === 'signed-out') {
    return (
      <AuthShell
        title="Your teacher application"
        footer={<>New here? <Link to="/auth/teacher/register" className="to-link">Create an account</Link></>}
      >
        <Notice tone="info">Sign in to view or submit your teacher application.</Notice>
        <Link to="/auth/login" className="rso-btn rso-btn-primary rso-btn-lg to-submit">Sign in</Link>
      </AuthShell>
    );
  }

  if (load.state === 'not-applicant') {
    return (
      <AuthShell title="Your teacher application">
        <Notice tone="info">This page is for teacher applicants. Your account already has a portal role.</Notice>
        {load.role === 'teacher' && (
          <p className="to-body">Your teacher account is active. Sign in to the teacher portal to continue.</p>
        )}
      </AuthShell>
    );
  }

  if (load.state === 'error') {
    return (
      <AuthShell title="Your teacher application">
        <Notice tone="error">{GENERIC_ERROR}</Notice>
        <button type="button" className="rso-btn rso-btn-secondary rso-btn-lg to-submit" onClick={() => refresh(session.user)}>Try again</button>
      </AuthShell>
    );
  }

  const fellowshipsUnavailable = fellowships.length === 0;

  return (
    <AuthShell title={TITLES[view] || 'Your teacher application'} subtitle={SUBTITLES[view]}>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {view === 'pending' && (
        <>
          <p className="to-body">Submitted {formatDate(current.submitted_at)}. The administration team will contact you if they need anything or once a decision is made.</p>
          <WithdrawSection confirm={confirmWithdraw} busy={busy} onWithdraw={onWithdraw} onCancel={() => setConfirmWithdraw(false)} />
        </>
      )}

      {view === 'info' && (
        <>
          <div className="to-request" role="region" aria-label="Request from the administration team">
            <h2 className="to-section-title">Information requested</h2>
            {/* Applicant-visible review message only. Internal notes and rejection reasons are never selected. */}
            <p className="to-request-text">{current.review_message || 'Please review and update your application.'}</p>
          </div>
          <ApplicationForm
            form={form}
            errors={errors}
            fellowships={fellowships}
            fellowshipsUnavailable={fellowshipsUnavailable}
            busy={busy}
            onSubmit={onSubmit}
            update={update}
            submitLabel="Send updated application"
          />
          <WithdrawSection confirm={confirmWithdraw} busy={busy} onWithdraw={onWithdraw} onCancel={() => setConfirmWithdraw(false)} />
        </>
      )}

      {view === 'rejected' && (
        <p className="to-body">We are unable to take this application further at this time. If you have questions, contact the administration team.</p>
      )}

      {view === 'approved' && (
        <p className="to-body">Thank you. Your application has been approved and your teacher account is being activated. You will receive an email when you can sign in to the teacher portal.</p>
      )}

      {view === 'apply' && (
        <>
          {current?.status === 'WITHDRAWN' && <Notice tone="info">Your previous application was withdrawn. You can apply again.</Notice>}
          <ApplicationForm
            form={form}
            errors={errors}
            fellowships={fellowships}
            fellowshipsUnavailable={fellowshipsUnavailable}
            busy={busy}
            onSubmit={onSubmit}
            update={update}
            submitLabel="Submit application"
          />
        </>
      )}
    </AuthShell>
  );
}

const TITLES = {
  apply: 'Apply to teach',
  pending: 'Application received',
  info: 'More information needed',
  rejected: 'Application not approved',
  approved: 'Application approved',
};

const SUBTITLES = {
  apply: 'Tell us about yourself and the fellowship you would serve.',
  info: 'Review the request below, then update your application.',
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function ApplicationForm({ form, errors, fellowships, fellowshipsUnavailable, busy, onSubmit, update, submitLabel }) {
  return (
    <form className="to-form" onSubmit={onSubmit} noValidate>
      <Field id="appFullName" label="Full name" error={errors.fullName}>
        <input className="rso-input" type="text" autoComplete="name" value={form.fullName} onChange={update('fullName')} {...fieldAria('appFullName', { error: errors.fullName })} />
      </Field>
      <Field id="appPhone" label="Phone (optional)" error={errors.phone}>
        <input className="rso-input" type="tel" autoComplete="tel" value={form.phone} onChange={update('phone')} {...fieldAria('appPhone', { error: errors.phone })} />
      </Field>
      <Field id="appFellowship" label="Fellowship" error={errors.fellowshipCode}>
        <select className="rso-select" value={form.fellowshipCode} onChange={update('fellowshipCode')} disabled={fellowshipsUnavailable} {...fieldAria('appFellowship', { error: errors.fellowshipCode })}>
          <option value="">Choose a fellowship</option>
          {fellowships.map((option) => (
            <option key={option.fellowship_code} value={option.fellowship_code}>
              {option.campus_name || option.fellowship_code}
            </option>
          ))}
        </select>
      </Field>
      {fellowshipsUnavailable && (
        <Notice tone="error">Fellowship choices are unavailable right now. Try again later.</Notice>
      )}
      <Field id="appNotes" label="Notes (optional)" error={errors.notes} hint={`Up to ${NOTES_MAX} characters.`}>
        <textarea className="rso-textarea" rows={4} maxLength={NOTES_MAX} value={form.notes} onChange={update('notes')} {...fieldAria('appNotes', { error: errors.notes, hint: 'limit' })} />
      </Field>
      <button type="submit" className="rso-btn rso-btn-primary rso-btn-lg to-submit" disabled={busy || fellowshipsUnavailable}>
        {busy ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}

function WithdrawSection({ confirm, busy, onWithdraw, onCancel }) {
  return (
    <div className="to-withdraw">
      {confirm && <p className="to-body">Withdraw this application? You can apply again afterwards.</p>}
      <div className="to-actions">
        <button type="button" className="rso-btn rso-btn-secondary rso-btn-md" onClick={onWithdraw} disabled={busy}>
          {confirm ? 'Yes, withdraw application' : 'Withdraw application'}
        </button>
        {confirm && (
          <button type="button" className="rso-btn rso-btn-ghost rso-btn-md" onClick={onCancel} disabled={busy}>Keep application</button>
        )}
      </div>
    </div>
  );
}
