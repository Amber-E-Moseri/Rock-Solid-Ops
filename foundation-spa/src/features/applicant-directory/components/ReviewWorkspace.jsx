import { useState, useMemo } from 'react';
import { Badge, Button, Textarea, EmptyState } from '../../../components/ui/index.js';
import {
  reviewComparisonGroup, reviewFieldRows, reviewStatusClass, relativeTime,
} from '../lib/applicants.js';

const STATUS_VARIANT = { duplicate: 'danger', attention: 'warning', assigned: 'success', unassigned: 'neutral' };

const initials = (name) =>
  String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

function Avatar({ name, size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--radius-full)',
      background: 'var(--soft-purple)', color: 'var(--primary)',
      fontSize: size > 40 ? 20 : 13, fontWeight: 800, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{initials(name)}</div>
  );
}

function CompareCard({ app, kicker, badge, badgeVariant, fieldRows, side, selected }) {
  return (
    <article style={{
      border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
      borderRadius: 'var(--r-lg)', background: 'var(--surface)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>{kicker}</div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{app?.full_name || '-'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {app?.class_option_id ? `Enrolled ${relativeTime(app.updated_at || app.created_at)}` : `Submitted ${relativeTime(app?.created_at || app?.updated_at)}`}
          </div>
        </div>
        <Badge variant={badgeVariant}>{badge}</Badge>
      </div>
      <div style={{ padding: '10px 16px' }}>
        {fieldRows.map((row) => (
          <div key={row.label} style={{
            display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0',
            borderBottom: '1px solid var(--border)', fontSize: 13,
            background: row.diff ? 'color-mix(in srgb, var(--warning, #c07400) 8%, transparent)' : 'transparent',
          }}>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{row.label}</span>
            <span style={{ textAlign: 'right', fontWeight: row.diff ? 700 : 500 }}>{side === 'left' ? row.left : row.right}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: '10px 16px', fontSize: 12, fontWeight: 700, color: selected ? 'var(--primary)' : 'var(--muted)', borderTop: '1px solid var(--border)' }}>
        {selected ? '✓ Selected' : 'Use this one'}
      </div>
    </article>
  );
}

export default function ReviewWorkspace({ model, rows, canDecide, onResolveDuplicate, onMarkStatus, busy }) {
  const reviewRows = useMemo(
    () => rows.filter((app) => ['PENDING', 'REVIEW', 'DUPLICATE', 'WAITLISTED', 'ASSIGNED'].includes(String(app.registration_status || 'PENDING').toUpperCase())),
    [rows],
  );
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState('');

  const selected = reviewRows.find((app) => String(app.id) === String(selectedId)) || reviewRows[0] || null;

  if (!reviewRows.length) {
    return <EmptyState icon="✅" title="Review queue is empty" message="No applicants match the current review filters." />;
  }

  const compareGroup = selected ? reviewComparisonGroup(model, selected) : [];
  const incoming = compareGroup[0] || selected;
  const existing = compareGroup.find((item) => String(item.id) !== String(incoming?.id)) || selected;
  const fieldRows = selected ? reviewFieldRows(model, incoming, existing) : [];
  const isDuplicateGroup = compareGroup.length > 1;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* Queue */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
          Showing {reviewRows.length}
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {reviewRows.map((app) => {
            const active = String(app.id) === String(selected?.id);
            const cls = reviewStatusClass(app);
            return (
              <div
                key={app.id}
                onClick={() => { setSelectedId(String(app.id)); setNote(''); }}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: active ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent',
                }}
              >
                <Avatar name={app.full_name || app.email} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.full_name || '-'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {app.preferred_class_time || app.class_option_id || app.fellowship_code || app.subgroup_id || '-'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Badge variant={STATUS_VARIANT[cls]}>{String(app.duplicate_status || app.registration_status || 'PENDING').toUpperCase()}</Badge>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{relativeTime(app.created_at || app.updated_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      {selected ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 18 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
            <Avatar name={selected.full_name || selected.email} size={52} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{selected.full_name || '-'}</h3>
                <Badge variant={STATUS_VARIANT[reviewStatusClass(selected)]}>
                  {String(selected.duplicate_status || selected.registration_status || 'PENDING').toUpperCase()}
                </Badge>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                {selected.fellowship_code || 'Applicant'} · {selected.batch_id || 'No batch'} · submitted {relativeTime(selected.created_at || selected.updated_at)}
              </p>
            </div>
          </div>

          <div style={{
            padding: '10px 14px', borderRadius: 'var(--r-md, 8px)', fontSize: 13, marginBottom: 14,
            background: 'color-mix(in srgb, var(--primary) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)',
          }}>
            {isDuplicateGroup
              ? 'Same person, submitted twice — pick the record to keep going forward. Differences are highlighted.'
              : 'Review this applicant and choose the next action.'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <CompareCard app={incoming} kicker="New submission" badge="Incoming" badgeVariant="info" fieldRows={fieldRows} side="left" selected={String(selected.id) === String(incoming?.id)} />
            <CompareCard app={existing} kicker={`Existing record${existing?.id ? ` · #${String(existing.id).slice(0, 4)}` : ''}`} badge={existing?.class_option_id ? 'Assigned' : 'Current'} badgeVariant={existing?.class_option_id ? 'success' : 'neutral'} fieldRows={fieldRows} side="right" selected={String(selected.id) === String(existing?.id)} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Resolution note (optional)</div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this record was kept..." rows={2} />
          </div>

          {canDecide ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  if (isDuplicateGroup) onResolveDuplicate({ email: selected.email, keepId: selected.id, note });
                  else onMarkStatus(selected, selected.class_option_id ? 'ASSIGNED' : 'PENDING');
                }}
              >
                ✓ {isDuplicateGroup ? 'Keep selected & resolve' : 'Mark reviewed'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onMarkStatus(selected, selected.class_option_id ? 'ASSIGNED' : 'PENDING')}>
                ✕ Not a duplicate
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onMarkStatus(selected, 'REVIEW')}>
                ▢ Request info
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onMarkStatus(selected, 'WAITLISTED')}>
                Waitlist
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => onMarkStatus(selected, 'DUPLICATE')}>
                Mark duplicate
              </Button>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>You do not have permission for review decisions.</p>
          )}
        </div>
      ) : (
        <EmptyState icon="👈" title="Select an applicant" message="Pick someone from the queue to review." />
      )}
    </div>
  );
}
