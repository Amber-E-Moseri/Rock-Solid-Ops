import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../supabase.js';
import { isRoleAllowed, useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Select,
  SearchInput,
  Skeleton,
  Table,
  Toolbar,
} from '../../components/ui/index.js';
import ApplicationDetail from './components/ApplicationDetail.jsx';
import DecisionDialog from './components/DecisionDialog.jsx';
import {
  REVIEWER_ROLES,
  REVIEW_ACTIONS,
  STATUS_FILTERS,
  STATUS_LABELS,
  STATUS_TONES,
  fellowshipOptions,
  fetchReviewQueue,
  filterApplications,
  needsReload,
  reviewApplication,
  reviewErrorMessage,
} from './lib/reviewApi.js';
import { formatDate } from './lib/format.js';
import './teacherApplications.css';

const QUERY_ROOT = ['teacher-applications'];

export default function TeacherApplicationsPage() {
  const { user, profile } = useAuth();
  const addToast = useToast();
  const queryClient = useQueryClient();
  const allowed = isRoleAllowed(profile?.role, REVIEWER_ROLES);

  const [status, setStatus] = useState('ALL');
  const [fellowship, setFellowship] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState('');

  const queue = useQuery({
    queryKey: [...QUERY_ROOT, 'queue'],
    queryFn: () => fetchReviewQueue(supabase),
    enabled: allowed,
    staleTime: 30_000,
  });

  const rows = queue.data ?? [];
  const fellowships = useMemo(() => fellowshipOptions(rows), [rows]);
  const visible = useMemo(
    () => filterApplications(rows, { status, fellowship, search }),
    [rows, status, fellowship, search],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const decide = useMutation({
    mutationFn: (input) => reviewApplication(supabase, input),
    onSuccess: () => {
      setDialog(null);
      setDialogError('');
      addToast('Decision recorded. The applicant has been notified by email.', 'success');
      queryClient.invalidateQueries({ queryKey: QUERY_ROOT });
    },
    onError: (error) => {
      setDialogError(reviewErrorMessage(error));
      if (needsReload(error)) queryClient.invalidateQueries({ queryKey: QUERY_ROOT });
    },
  });

  function openDialog(action) {
    setDialogError('');
    setDialog({ action });
  }

  function confirmDecision(message) {
    if (!selected || decide.isPending) return;
    decide.mutate({
      applicationId: selected.id,
      action: dialog.action,
      expectedVersion: selected.version,
      message,
    });
  }

  const columns = [
    {
      key: 'full_name',
      label: 'Applicant',
      render: (value, row) => (
        <span className="ta-name-cell">
          <button type="button" className="ta-link" onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); }}>
            {row.full_name}
          </button>
          <span className="ta-muted ta-wrap">{row.email}</span>
        </span>
      ),
    },
    { key: 'fellowship_code', label: 'Fellowship' },
    {
      key: 'status',
      label: 'Status',
      render: (value) => <Badge variant={STATUS_TONES[value] || 'neutral'}>{STATUS_LABELS[value] || 'Unknown status'}</Badge>,
    },
    { key: 'submitted_at', label: 'Submitted', render: (value) => formatDate(value) },
  ];

  if (!allowed) {
    return (
      <div className="ta-page">
        <PageHeader title="Teacher Applications" />
        <EmptyState
          title="Not available for your role"
          message="Teacher applications are visible to administrators only."
        />
      </div>
    );
  }

  return (
    <div className="ta-page">
      <PageHeader
        title="Teacher Applications"
        subtitle="Review applications from verified accounts. Decisions are recorded on the server and the applicant is emailed."
        actions={<Button variant="secondary" size="sm" onClick={() => queue.refetch()} disabled={queue.isFetching}>Refresh</Button>}
      />

      <Toolbar className="ta-toolbar">
        <SearchInput
          type="search"
          aria-label="Search applications"
          placeholder="Search name, email, phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>{value === 'ALL' ? 'All statuses' : STATUS_LABELS[value]}</option>
          ))}
        </Select>
        <Select aria-label="Filter by fellowship" value={fellowship} onChange={(event) => setFellowship(event.target.value)}>
          <option value="">All fellowships</option>
          {fellowships.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </Select>
      </Toolbar>

      <div className="ta-layout">
        <section className="ta-queue" aria-label="Application queue">
          {queue.isPending && <Skeleton variant="row" count={5} />}
          {queue.isError && (
            <ErrorBanner message="Applications could not be loaded." onRetry={() => queue.refetch()} />
          )}
          {queue.isSuccess && (
            <>
              <p className="ta-count" role="status">
                {visible.length} of {rows.length} applications shown
              </p>
              <Table
                columns={columns}
                data={visible}
                sortable={false}
                onRowClick={(row) => setSelectedId(row.id)}
                emptyMessage={rows.length === 0 ? 'No applications are waiting.' : 'No applications match these filters.'}
                mobileCardRender={(row) => (
                  <div className="ta-card-row">
                    <button type="button" className="ta-link" onClick={() => setSelectedId(row.id)}>{row.full_name}</button>
                    <span className="ta-muted ta-wrap">{row.email}</span>
                    <span className="ta-muted">{row.fellowship_code} · submitted {formatDate(row.submitted_at)}</span>
                    <Badge variant={STATUS_TONES[row.status] || 'neutral'}>{STATUS_LABELS[row.status] || 'Unknown status'}</Badge>
                  </div>
                )}
              />
            </>
          )}
        </section>

        <section className="ta-detail" aria-label="Application detail">
          {selected ? (
            <ApplicationDetail
              key={selected.id}
              application={selected}
              isOwnApplication={Boolean(user?.id) && selected.applicant_user_id === user.id}
              onRequestInfo={() => openDialog(REVIEW_ACTIONS.REQUEST_INFO)}
              onReject={() => openDialog(REVIEW_ACTIONS.REJECT)}
              deciding={decide.isPending}
            />
          ) : (
            <EmptyState title="Select an application" message="Choose an applicant to see the full record and decide." />
          )}
        </section>
      </div>

      {dialog && selected && (
        <DecisionDialog
          action={dialog.action}
          application={selected}
          busy={decide.isPending}
          error={dialogError}
          onCancel={() => { if (!decide.isPending) setDialog(null); }}
          onConfirm={confirmDecision}
        />
      )}
    </div>
  );
}
