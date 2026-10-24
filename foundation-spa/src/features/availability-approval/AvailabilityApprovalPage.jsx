import { useState, useMemo, useCallback, useEffect } from 'react';
import { PageHeader, Card, Badge, Button, Skeleton, SearchInput, Select, ErrorBanner, EmptyState, Modal } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchAvailabilitySlots, approveSlot, groupSlots, computeKpis, filterSlots,
  statusInfo, canApprove, formatTime, APPROVAL_CERTIFIED, APPROVAL_HOLD_MESSAGE, APPROVER_ROLES,
} from './lib/availabilityApproval.js';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'awaiting', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'other', label: 'Other status' },
];

function teacherLabel(group) {
  return group.teacher_name || 'No name on teacher record';
}

function slotLabel(slot) {
  return `${slot.day || '—'} ${formatTime(slot.time_slot)}`;
}

export default function AvailabilityApprovalPage() {
  const { profile, user } = useAuth();
  const toast = useToast();

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pending, setPending] = useState(null); // slot awaiting confirmation
  const [pendingError, setPendingError] = useState(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSlots(await fetchAvailabilitySlots());
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message || 'Failed to load availability');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => computeKpis(slots), [slots]);
  const groups = useMemo(() => groupSlots(filterSlots(slots, { search, status: statusFilter })), [slots, search, statusFilter]);
  const filtersActive = Boolean(search || statusFilter);
  const role = profile?.role;

  function openApprove(slot) {
    setPendingError(null);
    setPending(slot);
  }

  async function confirmApprove() {
    if (!pending) return;
    setApproving(true);
    setPendingError(null);
    try {
      const result = await approveSlot({
        id: pending.id,
        actorEmail: profile?.email,
        actorId: user?.id || profile?.user_id,
      });
      toast(`Approved ${slotLabel(pending)} for ${teacherLabel(pending)}${result.classOptionId ? ` (${result.classOptionId})` : ''}`, 'success');
      setPending(null);
      await load();
    } catch (e) {
      setPendingError(e.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  const kpiValue = (value) => (loading || loadError ? '—' : value);

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <PageHeader
        title="Availability Approval"
        subtitle="Teacher slot availability by batch. Approving a slot creates its class option and class slot."
        actions={<Button variant="secondary" onClick={load}>Refresh</Button>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {[
          { label: 'Teachers', value: kpis.teachers },
          { label: 'Slots', value: kpis.slots },
          { label: 'Awaiting approval', value: kpis.awaiting, color: 'var(--color-warning)' },
          { label: 'Approved', value: kpis.approved, color: 'var(--color-success)' },
        ].map((k) => (
          <Card key={k.label}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: k.color || 'var(--text)' }}>{kpiValue(k.value)}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{k.label}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teacher name, email or ID" style={{ flex: '1 1 220px' }} />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {filtersActive && <Button size="sm" variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear</Button>}
        </div>

        {loading ? (
          <Skeleton variant="rows" rows={6} />
        ) : loadError ? (
          <ErrorBanner message={`Could not load availability. ${loadError}`} onRetry={load} />
        ) : slots.length === 0 ? (
          // Read access to slot rows is limited to approver roles (RLS). For other roles an empty list
          // means "not visible to this account", not "no teacher has submitted".
          <EmptyState
            icon="inbox"
            title="No availability slots"
            subtitle={APPROVER_ROLES.includes(role)
              ? 'No teacher has submitted availability yet.'
              : 'Slot data is limited to approvers and to each teacher’s own records, so none is visible to this account.'}
          />
        ) : groups.length === 0 ? (
          <EmptyState icon="search" title="No slots match" subtitle="Try a different search or status." />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {groups.map((group) => (
              <SlotGroup key={group.key} group={group} canApproveSlot={(s) => canApprove(s, role)} onApprove={openApprove} disabled={approving} />
            ))}
          </div>
        )}
      </Card>

      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', margin: 0 }}>
        Rejecting slots and approving several at once are not available: the backend provides no verified action for either.
        {!APPROVAL_CERTIFIED && ' Approval is on hold pending contract review.'}
      </p>

      <Modal
        open={Boolean(pending)}
        title="Approve availability slot"
        onClose={() => !approving && setPending(null)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={approving}>Cancel</Button>
            <Button variant="primary" onClick={confirmApprove} disabled={approving}>{approving ? 'Approving…' : 'Approve'}</Button>
          </>
        )}
      >
        {pending && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
              Approve <strong>{slotLabel(pending)}</strong> for <strong>{teacherLabel(pending)}</strong>
              {pending.batch_id ? <> in batch <strong>{pending.batch_id}</strong></> : null}?
            </p>
            <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
              This creates the class option and an active class slot, and sets the slot to Available.
            </p>
            {pendingError && <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--color-danger)' }}>{pendingError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SlotGroup({ group, canApproveSlot, onApprove, disabled }) {
  const counts = group.slots.reduce((acc, s) => {
    const key = statusInfo(s.status).key;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rso-table-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="rso-table-card-head" style={{ padding: '14px 14px 6px' }}>
        <div>
          <div className="rso-table-card-title">{teacherLabel(group)}</div>
          <div className="rso-cell-meta">{group.teacher_id}{group.teacher_email ? ` · ${group.teacher_email}` : ''}</div>
        </div>
        <Badge variant="info">{group.batch_id ? `Batch ${group.batch_id}` : 'No batch'}</Badge>
      </div>
      <div className="rso-cell-meta" style={{ padding: '0 14px 10px' }}>
        {group.slots.length} slot{group.slots.length !== 1 ? 's' : ''}
        {counts.awaiting ? ` · ${counts.awaiting} awaiting approval` : ''}
        {counts.approved ? ` · ${counts.approved} approved` : ''}
      </div>

      <div className="rso-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
        <table className="rso-table rso-table--sticky-actions">
          <thead><tr><th>Day</th><th>Time</th><th>Status</th><th>Class option</th><th>Action</th></tr></thead>
          <tbody>
            {group.slots.map((s) => {
              const info = statusInfo(s.status);
              return (
                <tr key={s.id}>
                  <td>{s.day || '—'}</td>
                  <td>{formatTime(s.time_slot)}</td>
                  <td><Badge variant={info.variant}>{info.label}</Badge></td>
                  <td><SlotClassCell slot={s} /></td>
                  <td>{canApproveSlot(s) ? <ApproveButton slot={s} group={group} onApprove={onApprove} disabled={disabled} /> : <span className="rso-cell-meta">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rso-table-cards" style={{ padding: '0 14px 14px' }}>
        {group.slots.map((s) => {
          const info = statusInfo(s.status);
          return (
            <div className="rso-table-card" key={s.id} style={{ boxShadow: 'none' }}>
              <div className="rso-table-card-head">
                <span className="rso-table-card-title">{slotLabel(s)}</span>
                <Badge variant={info.variant}>{info.label}</Badge>
              </div>
              <div className="rso-table-card-row"><span className="rso-table-card-label">Class option</span><span><SlotClassCell slot={s} /></span></div>
              {canApproveSlot(s) && <div className="rso-row-actions"><ApproveButton slot={s} group={group} onApprove={onApprove} disabled={disabled} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotClassCell({ slot }) {
  if (slot.class_option_sync_status === 'FAILED') {
    return <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>Sync failed{slot.class_option_sync_error ? `: ${slot.class_option_sync_error}` : ''}</span>;
  }
  return slot.class_option_id ? <span className="rso-cell-meta">{slot.class_option_id}</span> : <span className="rso-cell-meta">—</span>;
}

// Rendered disabled while approval is on hold. The lib also refuses the call, so this is not the only guard.
function ApproveButton({ slot, group, onApprove, disabled }) {
  const held = !APPROVAL_CERTIFIED;
  return (
    <Button
      size="sm"
      variant="primary"
      onClick={() => onApprove({ ...slot, teacher_name: group.teacher_name, teacher_email: group.teacher_email })}
      disabled={disabled || held}
      title={held ? APPROVAL_HOLD_MESSAGE : undefined}
      aria-label={`${held ? 'Approval on hold for' : 'Approve'} ${slotLabel(slot)} for ${teacherLabel(group)}`}
    >
      {held ? 'On hold' : 'Approve'}
    </Button>
  );
}
