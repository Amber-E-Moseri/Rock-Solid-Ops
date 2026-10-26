import { useId, useRef, useState } from 'react';
import ErrorBanner from '../../components/ui/ErrorBanner.jsx';
import {
  REQUEST_ROLES, NAME_MAX, NOTE_MAX, PHONE_MAX,
  groupOptions, subgroupOptions, fellowshipOptions,
  validateRequestDraft, submitRequest, friendlyMessage,
} from './lib/accessRequest.js';

const FIELD_ORDER = ['requestedRole', 'fullName', 'phone', 'groupId', 'subgroupId', 'fellowshipCode', 'note'];

export default function AccessRequestForm({ tree, email, initial, submitLabel = 'Submit request', onSubmitted }) {
  const uid = useId();
  const [draft, setDraft] = useState(() => ({
    requestedRole: '', fullName: '', phone: '', groupId: '', subgroupId: '', fellowshipCode: '', note: '',
    ...(initial || {}),
  }));
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const refs = useRef({});

  const errors = validateRequestDraft(draft, tree);
  const groups = groupOptions(tree);
  const subgroups = subgroupOptions(tree, draft.groupId);
  const fellowships = fellowshipOptions(tree, draft.groupId, draft.subgroupId);
  const visibleErrors = Object.fromEntries(
    Object.entries(errors).filter(([field]) => attempted || touched[field]),
  );
  const errorList = FIELD_ORDER.filter((f) => errors[f]).map((f) => ({ field: f, message: errors[f] }));

  // Changing a parent selector clears the children, so a stale subgroup or fellowship is never submitted.
  function update(field, value) {
    setDraft((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'groupId') { next.subgroupId = ''; next.fellowshipCode = ''; }
      if (field === 'subgroupId') { next.fellowshipCode = ''; }
      return next;
    });
  }

  function touch(field) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  function describedBy(field, base = '') {
    const parts = [base, visibleErrors[field] ? `${uid}-${field}-error` : ''].filter(Boolean);
    return parts.join(' ') || undefined;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');
    setAttempted(true);
    if (errorList.length > 0) {
      const first = refs.current[errorList[0].field];
      first?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await submitRequest(draft);
      onSubmitted?.(result, draft);
    } catch (err) {
      setServerError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const invalid = (field) => (visibleErrors[field] ? true : undefined);

  return (
    <form className="ar-form" onSubmit={handleSubmit} noValidate aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="ar-section-title">Request access</h2>

      {errorList.length > 0 && attempted && (
        <div className="rso-error-banner ar-summary" role="alert" id={`${uid}-summary`}>
          <div>
            <strong>Please correct {errorList.length === 1 ? 'one field' : `${errorList.length} fields`}:</strong>
            <ul className="ar-summary-list">
              {errorList.map(({ field, message }) => (
                <li key={field}>
                  <button type="button" className="ar-link" onClick={() => refs.current[field]?.focus()}>
                    {message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {serverError && <ErrorBanner message={serverError} />}

      <fieldset className="ar-fieldset" aria-describedby={describedBy('requestedRole')}>
        <legend className="ar-legend">Requested role <span className="ar-required">(required)</span></legend>
        <div className="ar-roles" role="radiogroup" aria-invalid={invalid('requestedRole')}>
          {REQUEST_ROLES.map((role, index) => (
            <label key={role.value} className={`ar-role${draft.requestedRole === role.value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name={`${uid}-role`}
                value={role.value}
                checked={draft.requestedRole === role.value}
                onChange={() => { update('requestedRole', role.value); touch('requestedRole'); }}
                ref={(el) => { if (index === 0 && el) refs.current.requestedRole = el; }}
              />
              <span className="ar-role-label">{role.label}</span>
              <span className="ar-role-hint">{role.hint}</span>
            </label>
          ))}
        </div>
        {visibleErrors.requestedRole && (
          <p id={`${uid}-requestedRole-error`} className="ar-error">{visibleErrors.requestedRole}</p>
        )}
      </fieldset>

      <div className="ar-grid ar-grid-2">
        <div className="rso-field">
          <label htmlFor={`${uid}-fullName`}>Full name <span className="ar-required">(required)</span></label>
          <input
            id={`${uid}-fullName`}
            className="rso-input"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={draft.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            onBlur={() => touch('fullName')}
            ref={(el) => { refs.current.fullName = el; }}
            aria-invalid={invalid('fullName')}
            aria-describedby={describedBy('fullName')}
            required
          />
          {visibleErrors.fullName && <p id={`${uid}-fullName-error`} className="ar-error">{visibleErrors.fullName}</p>}
        </div>

        <div className="rso-field">
          <label htmlFor={`${uid}-email`}>Email address</label>
          <input
            id={`${uid}-email`}
            className="rso-input"
            type="email"
            value={email || ''}
            readOnly
            aria-readonly="true"
            aria-describedby={`${uid}-email-help`}
          />
          <p id={`${uid}-email-help`} className="ar-help">
            This is the address on your account. It is confirmed and cannot be changed here.
          </p>
        </div>

        <div className="rso-field">
          <label htmlFor={`${uid}-phone`}>Phone number <span className="ar-optional">(optional)</span></label>
          <input
            id={`${uid}-phone`}
            className="rso-input"
            type="tel"
            autoComplete="tel"
            maxLength={PHONE_MAX}
            value={draft.phone}
            onChange={(e) => update('phone', e.target.value)}
            onBlur={() => touch('phone')}
            ref={(el) => { refs.current.phone = el; }}
            aria-invalid={invalid('phone')}
            aria-describedby={describedBy('phone')}
          />
          {visibleErrors.phone && <p id={`${uid}-phone-error`} className="ar-error">{visibleErrors.phone}</p>}
        </div>

        <div className="rso-field">
          <label htmlFor={`${uid}-groupId`}>Group <span className="ar-required">(required)</span></label>
          <select
            id={`${uid}-groupId`}
            className="rso-select"
            value={draft.groupId}
            onChange={(e) => { update('groupId', e.target.value); touch('groupId'); }}
            onBlur={() => touch('groupId')}
            ref={(el) => { refs.current.groupId = el; }}
            aria-invalid={invalid('groupId')}
            aria-describedby={describedBy('groupId')}
          >
            <option value="">Choose a group</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {visibleErrors.groupId && <p id={`${uid}-groupId-error`} className="ar-error">{visibleErrors.groupId}</p>}
        </div>

        <div className="rso-field">
          <label htmlFor={`${uid}-subgroupId`}>Subgroup <span className="ar-required">(required)</span></label>
          <select
            id={`${uid}-subgroupId`}
            className="rso-select"
            value={draft.subgroupId}
            onChange={(e) => { update('subgroupId', e.target.value); touch('subgroupId'); }}
            onBlur={() => touch('subgroupId')}
            disabled={!draft.groupId}
            ref={(el) => { refs.current.subgroupId = el; }}
            aria-invalid={invalid('subgroupId')}
            aria-describedby={describedBy('subgroupId', draft.groupId ? '' : `${uid}-subgroupId-help`)}
          >
            <option value="">{draft.groupId ? 'Choose a subgroup' : 'Choose a group first'}</option>
            {subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {!draft.groupId && <p id={`${uid}-subgroupId-help`} className="ar-help">Subgroups are listed for the group you choose.</p>}
          {visibleErrors.subgroupId && <p id={`${uid}-subgroupId-error`} className="ar-error">{visibleErrors.subgroupId}</p>}
        </div>

        <div className="rso-field ar-span-2">
          <label htmlFor={`${uid}-fellowshipCode`}>Fellowship or campus <span className="ar-required">(required)</span></label>
          <select
            id={`${uid}-fellowshipCode`}
            className="rso-select"
            value={draft.fellowshipCode}
            onChange={(e) => { update('fellowshipCode', e.target.value); touch('fellowshipCode'); }}
            onBlur={() => touch('fellowshipCode')}
            disabled={!draft.subgroupId}
            ref={(el) => { refs.current.fellowshipCode = el; }}
            aria-invalid={invalid('fellowshipCode')}
            aria-describedby={describedBy('fellowshipCode', draft.subgroupId ? '' : `${uid}-fellowshipCode-help`)}
          >
            <option value="">{draft.subgroupId ? 'Choose a fellowship or campus' : 'Choose a subgroup first'}</option>
            {fellowships.map((f) => <option key={f.code} value={f.code}>{f.campus}</option>)}
          </select>
          {!draft.subgroupId && <p id={`${uid}-fellowshipCode-help`} className="ar-help">Fellowships are listed for the group and subgroup you choose.</p>}
          {visibleErrors.fellowshipCode && <p id={`${uid}-fellowshipCode-error`} className="ar-error">{visibleErrors.fellowshipCode}</p>}
        </div>

        <div className="rso-field ar-span-2">
          <label htmlFor={`${uid}-note`}>Additional note <span className="ar-optional">(optional, up to {NOTE_MAX} characters)</span></label>
          <textarea
            id={`${uid}-note`}
            className="rso-textarea"
            rows={4}
            maxLength={NOTE_MAX + 200}
            value={draft.note}
            onChange={(e) => update('note', e.target.value)}
            onBlur={() => touch('note')}
            ref={(el) => { refs.current.note = el; }}
            aria-invalid={invalid('note')}
            aria-describedby={describedBy('note', `${uid}-note-count`)}
          />
          <p id={`${uid}-note-count`} className="ar-help">{draft.note.length} / {NOTE_MAX}</p>
          {visibleErrors.note && <p id={`${uid}-note-error`} className="ar-error">{visibleErrors.note}</p>}
        </div>
      </div>

      <div className="ar-actions">
        <p className="ar-help">Submitting does not grant access. A reviewer checks every request first.</p>
        <button type="submit" className="rso-btn rso-btn-primary rso-btn-md" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
