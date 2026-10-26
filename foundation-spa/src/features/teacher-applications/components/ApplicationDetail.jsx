import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../../../supabase.js';
import { Badge, Button, ErrorBanner, Skeleton } from '../../../components/ui/index.js';
import {
  APPROVAL_CONTRACT_AVAILABLE,
  APPROVAL_HELD_MESSAGE,
  STATUS_LABELS,
  STATUS_TONES,
  fetchNotificationStatus,
  fetchReviewHistory,
  fetchRosterMatches,
  isDecidable,
  summarizeRoster,
} from '../lib/reviewApi.js';
import {
  NOTIFICATION_STATUS_LABELS,
  TEMPLATE_LABELS,
  auditEventLabel,
} from '../lib/communications.js';
import { formatDate, formatDateTime } from '../lib/format.js';

const RETRY_CENTER_PATH = '/staff/failed-sync-retry-center';

export default function ApplicationDetail({ application, isOwnApplication, onRequestInfo, onReject, deciding }) {
  const decidable = isDecidable(application);
  const verified = Boolean(application.email_verified_at);

  const roster = useQuery({
    queryKey: ['teacher-applications', 'roster', application.id, application.email],
    queryFn: () => fetchRosterMatches(supabase, application.email),
    staleTime: 30_000,
  });
  const notifications = useQuery({
    queryKey: ['teacher-applications', 'notifications', application.id],
    queryFn: () => fetchNotificationStatus(supabase, application.id),
    staleTime: 30_000,
  });
  const history = useQuery({
    queryKey: ['teacher-applications', 'history', application.id],
    queryFn: () => fetchReviewHistory(supabase, application.id),
    staleTime: 30_000,
  });

  const rosterSummary = roster.data ? summarizeRoster(roster.data) : null;

  return (
    <article className="ta-detail-body">
      <header className="ta-detail-head">
        <div>
          <h2 className="ta-detail-title">{application.full_name}</h2>
          <p className="ta-muted ta-wrap">{application.email}</p>
        </div>
        <Badge variant={STATUS_TONES[application.status] || 'neutral'}>
          {STATUS_LABELS[application.status] || 'Unknown status'}
        </Badge>
      </header>

      <p className={verified ? 'ta-verified' : 'ta-unverified'}>
        {verified ? `Email verified ${formatDate(application.email_verified_at)}` : 'Email not verified'}
      </p>

      <dl className="ta-facts">
        <div><dt>Phone</dt><dd>{application.phone || 'Not given'}</dd></div>
        <div><dt>Fellowship</dt><dd>{application.fellowship_code}</dd></div>
        <div><dt>Submitted</dt><dd>{formatDateTime(application.submitted_at)}</dd></div>
        <div><dt>Last updated</dt><dd>{formatDateTime(application.updated_at)}</dd></div>
        <div><dt>Version</dt><dd>{application.version}</dd></div>
        <div><dt>Last decision</dt><dd>{application.reviewed_at ? formatDateTime(application.reviewed_at) : 'None yet'}</dd></div>
      </dl>

      <section className="ta-block" aria-labelledby="ta-notes-title">
        <h3 id="ta-notes-title" className="ta-block-title">Applicant notes</h3>
        <p className="ta-body ta-wrap">{application.notes || 'No notes were given.'}</p>
      </section>

      <section className="ta-block" aria-labelledby="ta-roster-title">
        <h3 id="ta-roster-title" className="ta-block-title">Teacher roster check</h3>
        {roster.isPending && <Skeleton variant="text" count={1} />}
        {roster.isError && <ErrorBanner message="The roster could not be checked. Do not decide until it can be." onRetry={() => roster.refetch()} />}
        {rosterSummary?.kind === 'none' && <p className="ta-body">No roster record uses this email.</p>}
        {rosterSummary?.kind === 'match' && (
          <div className="ta-warning" role="status">
            <strong>An existing roster record uses this email.</strong>
            <p>Status: {rosterStatusText(rosterSummary.matches[0].status)}. Approval must link this record, not create a second teacher.</p>
          </div>
        )}
        {rosterSummary?.kind === 'ambiguous' && (
          <div className="ta-warning" role="status">
            <strong>{rosterSummary.matches.length} roster records use this email.</strong>
            <p>Resolve the duplicate with an administrator before any approval.</p>
          </div>
        )}
      </section>

      {application.status === 'APPROVED' && (
        <section className="ta-block" aria-labelledby="ta-activation-title">
          <h3 id="ta-activation-title" className="ta-block-title">Activation</h3>
          <p className="ta-body">
            Approved. The teacher account is activated only after the teacher-link contract confirms the link.
          </p>
          {application.approved_teacher_id && <p className="ta-muted ta-wrap">Linked roster record: {application.approved_teacher_id}</p>}
        </section>
      )}

      <section className="ta-block" aria-labelledby="ta-messages-title">
        <h3 id="ta-messages-title" className="ta-block-title">Messages</h3>
        {application.review_message ? (
          <p className="ta-body ta-wrap"><strong>Sent to applicant:</strong> {application.review_message}</p>
        ) : (
          <p className="ta-muted">No request for information has been sent.</p>
        )}
        {application.rejection_reason && (
          <p className="ta-body ta-wrap">
            <strong>Internal rejection reason:</strong> {application.rejection_reason}
            <span className="ta-muted"> Never shown to the applicant.</span>
          </p>
        )}
      </section>

      <section className="ta-block" aria-labelledby="ta-email-title">
        <h3 id="ta-email-title" className="ta-block-title">Email notifications</h3>
        {notifications.isPending && <Skeleton variant="text" count={2} />}
        {notifications.isError && <p className="ta-muted">Notification status is not available to this account.</p>}
        {notifications.isSuccess && notifications.data.length === 0 && <p className="ta-muted">No emails have been queued.</p>}
        {notifications.isSuccess && notifications.data.length > 0 && (
          <ul className="ta-list">
            {notifications.data.map((row) => (
              <li key={row.id} className="ta-list-item">
                <span>{TEMPLATE_LABELS[row.template_key] || 'Application email'}</span>
                <Badge variant={row.status === 'Failed' ? 'danger' : row.status === 'Sent' ? 'success' : 'neutral'}>
                  {NOTIFICATION_STATUS_LABELS[row.status] || 'Status unknown'}
                </Badge>
                <span className="ta-muted">{formatDateTime(row.sent_at || row.created_at)}</span>
                {row.status === 'Failed' && (
                  <span className="ta-muted ta-wrap">
                    Not sent. Retry from the <Link to={RETRY_CENTER_PATH}>Retry Center</Link>. This screen does not resend.
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ta-block" aria-labelledby="ta-history-title">
        <h3 id="ta-history-title" className="ta-block-title">Review history</h3>
        {history.isPending && <Skeleton variant="text" count={2} />}
        {history.isError && <p className="ta-muted">Review history is not available to this account.</p>}
        {history.isSuccess && history.data.length === 0 && <p className="ta-muted">No recorded events yet.</p>}
        {history.isSuccess && history.data.length > 0 && (
          <ul className="ta-list">
            {history.data.map((row) => (
              <li key={`${row.logged_at}-${row.action}`} className="ta-list-item">
                <span>{auditEventLabel(row.action)}</span>
                <span className="ta-muted">{formatDateTime(row.logged_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ta-actions" aria-label="Decisions">
        {isOwnApplication && (
          <p className="ta-warning" role="status">You submitted this application, so you cannot decide it.</p>
        )}
        {!decidable && !isOwnApplication && (
          <p className="ta-muted">No decision is open for this status.</p>
        )}
        {decidable && (
          <>
            <Button variant="secondary" onClick={onRequestInfo} disabled={isOwnApplication || deciding}>
              Request information
            </Button>
            <Button variant="danger" onClick={onReject} disabled={isOwnApplication || deciding}>
              Reject
            </Button>
          </>
        )}
        <Button
          variant="success"
          disabled={!APPROVAL_CONTRACT_AVAILABLE || !decidable || isOwnApplication}
          aria-describedby="ta-approve-hold"
        >
          Approve
        </Button>
        <p id="ta-approve-hold" className="ta-muted ta-wrap">{APPROVAL_HELD_MESSAGE}</p>
      </section>
    </article>
  );
}

function rosterStatusText(status) {
  const labels = { PENDING: 'pending', ACTIVE: 'active', SUSPENDED: 'suspended', INACTIVE: 'inactive' };
  return labels[status] || 'unknown';
}
