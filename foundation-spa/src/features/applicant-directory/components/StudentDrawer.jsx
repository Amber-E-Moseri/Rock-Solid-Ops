import { Drawer, Badge, Skeleton, Button } from '../../../components/ui/index.js';
import { useApplicantDetail } from '../hooks/useApplicants.js';
import {
  getClassInfo, getAttendanceSummary, getApplicantMilestones,
  milestoneKeys, milestoneLabels, displayGroupValue, displaySubgroupValue,
} from '../lib/applicants.js';

const fmt = (v) => (v ? new Date(v).toLocaleString() : '-');

function Kv({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h4 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', margin: '0 0 8px' }}>{title}</h4>
      {children}
    </section>
  );
}

function HistoryRows({ items, renderLabel }) {
  if (!items.length) return <div style={{ fontSize: 13, color: 'var(--muted)' }}>No records yet.</div>;
  return items.map((item, i) => (
    <div key={item.id ?? i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span>{renderLabel(item)}</span>
      <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {fmt(item.created_at || item.updated_at || item.timestamp || item.scheduled_for || item.date)}
      </span>
    </div>
  ));
}

export default function StudentDrawer({ model, applicantId, onClose, canDecide, busy, onChangeClass, onToggleFollowUp }) {
  const open = Boolean(applicantId);
  const app = open ? model?.applicants.find((a) => String(a.id) === String(applicantId)) : null;
  const { data: detail, isLoading } = useApplicantDetail(open ? applicantId : null);

  if (!app) return <Drawer open={false} onClose={onClose} title="" />;

  const cls = getClassInfo(model, app.class_option_id);
  const attendance = getAttendanceSummary(model, app);
  const applicantMilestones = new Set(getApplicantMilestones(model, app));
  const labels = milestoneLabels(model);
  const moodleStatus = detail?.moodle?.[0]?.status || 'Unknown';

  const emailRows = (detail?.emails || []).slice(0, 40);
  const notifRows = (detail?.notifications || []).slice(0, 40);
  const auditRows = (detail?.audits || []).slice(0, 50);

  return (
    <Drawer open={open} onClose={onClose} title={app.full_name || 'Student'}>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--muted)' }}>
        {app.email || '-'} · {app.phone || app.phone_number || '-'}
      </p>
      {canDecide && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 4px' }}>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onChangeClass(app)}>Change Class</Button>
          <Button size="sm" variant={app.needs_admin_review ? 'primary' : 'secondary'} disabled={busy} onClick={() => onToggleFollowUp(app)}>
            {app.needs_admin_review ? '✓ Needs Follow-up' : 'Mark Needs Follow-up'}
          </Button>
        </div>
      )}
      <Section title="Overview">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Kv label="Fellowship" value={app.fellowship_code || app.fellowship || app.subgroup_id || '-'} />
          <Kv label="Group / Subgroup" value={`${displayGroupValue(app)} / ${displaySubgroupValue(app)}`} />
          <Kv label="Assigned Class" value={app.class_option_id || '-'} />
          <Kv label="Teacher" value={cls?.teacher_name || cls?.teacher_id || '-'} />
          <Kv label="Batch" value={app.batch_id || cls?.batch_id || '-'} />
          <Kv label="Moodle Sync" value={moodleStatus} />
        </div>
      </Section>

      <Section title="Milestones">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {milestoneKeys(model).map((k) => (
            <span key={k} style={{ opacity: applicantMilestones.has(k) ? 1 : 0.45 }}>
              <Badge variant={applicantMilestones.has(k) ? 'success' : 'neutral'}>{labels[k] || k}</Badge>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Attendance">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Kv label="Attendance %" value={attendance.pct == null ? '-' : `${attendance.pct}%`} />
          <Kv label="Sessions Attended" value={`${attendance.attended}/${attendance.total}`} />
          <Kv label="Last Attendance" value={fmt(attendance.last)} />
          <Kv label="Missing Sessions" value={String(attendance.missing)} />
        </div>
      </Section>

      {isLoading ? (
        <Section title="History"><Skeleton variant="row" count={3} /></Section>
      ) : (
        <>
          <Section title="Notification History">
            <HistoryRows
              items={notifRows}
              renderLabel={(n) => `${String(n.status || n.event_status || n.provider_status || 'PENDING').toUpperCase()} · ${n.event_type || 'EVENT'}`}
            />
          </Section>
          <Section title="Email History">
            <HistoryRows
              items={emailRows}
              renderLabel={(e) => `${e.subject || e.template_key || 'Email'} · ${String(e.status || 'PENDING').toUpperCase()}`}
            />
          </Section>
          <Section title="Admin Audit Trail">
            <HistoryRows
              items={auditRows}
              renderLabel={(a) => `${a.action || 'ADMIN_ACTION'} · ${a.actor_email || 'staff'}`}
            />
          </Section>
        </>
      )}
    </Drawer>
  );
}
