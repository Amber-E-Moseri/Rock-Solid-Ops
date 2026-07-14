import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTeachers, filterTeachers, performAction, createTeacherDirect, linkTeacherAuth, unlinkTeacherAuth, fetchFellowshipOptions, GROUP_OPTIONS, SUBGROUP_OPTIONS, fmtDate, STATUS_TABS } from './lib/teacherManagement.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button, Modal, ErrorBanner } from '../../components/ui/index.js';

export default function TeacherManagementPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';

  const [tab, setTab] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [subgroup, setSubgroup] = useState('');
  const [actionModal, setActionModal] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [linkModal, setLinkModal] = useState(null);
  const [unlinkModal, setUnlinkModal] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['teacher-mgmt'], queryFn: fetchTeachers, staleTime: 60_000 });
  const teachers = data?.teachers ?? [];
  const classMap = data?.classMap ?? new Map();

  const { data: fellowships } = useQuery({ queryKey: ['teacher-mgmt-fellowships'], queryFn: fetchFellowshipOptions, staleTime: 300_000 });

  const filtered = useMemo(
    () => filterTeachers(teachers, { tab, search, group, subgroup }),
    [teachers, tab, search, group, subgroup],
  );

  const actionMut = useMutation({
    mutationFn: ({ teacherId, action, reason, teacherUserId }) =>
      performAction(teacherId, action, reason, profile?.email, teacherUserId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teacher-mgmt'] }); addToast('Done', 'success'); },
    onError: (e) => addToast(e.message, 'error'),
  });

  function quickAction(teacher, action) {
    if (['activate', 'unsuspend'].includes(action)) {
      if (!window.confirm(`${action === 'activate' ? 'Approve' : 'Reactivate'} ${teacher.full_name}?`)) return;
      actionMut.mutate({ teacherId: teacher.teacher_id, action, reason: '', teacherUserId: teacher.teacher_user_id });
    } else {
      setActionModal({ teacher, action });
    }
  }

  function statusActions(t) {
    if (!isAdmin) return null;
    const s = t.status;
    return (
      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
        {(s === 'PENDING' || s === 'SUSPENDED' || s === 'INACTIVE') && <Button variant="success" size="sm" onClick={() => quickAction(t, 'activate')}>Approve</Button>}
        {s === 'PENDING' && <Button variant="danger" size="sm" onClick={() => quickAction(t, 'reject')}>Reject</Button>}
        {(s === 'ACTIVE' || s === 'INACTIVE') && <Button variant="ghost" size="sm" onClick={() => quickAction(t, 'suspend')}>Suspend</Button>}
        {(s === 'ACTIVE' || s === 'SUSPENDED') && <Button variant="danger" size="sm" onClick={() => quickAction(t, 'inactivate')}>Inactivate</Button>}
        <Button variant="ghost" size="sm" onClick={() => setLinkModal(t)}>{t.teacher_user_id ? 'Relink' : 'Link Auth'}</Button>
        {t.teacher_user_id && <Button variant="ghost" size="sm" onClick={() => setUnlinkModal(t)}>Unlink</Button>}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title="Teacher Management" actions={
        <>
          {isAdmin && <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>Add Teacher</Button>}
          <Button variant="secondary" size="sm" onClick={refetch}>Refresh</Button>
        </>
      } />

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUS_TABS.map((s) => (
          <button key={s} onClick={() => setTab(s)} style={{
            padding: '0.35rem 0.75rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
            fontWeight: tab === s ? 600 : 400, fontSize: '13px',
            background: tab === s ? 'var(--primary)' : 'var(--surface)', color: tab === s ? '#fff' : 'var(--muted)',
          }}>{s}</button>
        ))}
      </div>

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, fellowship…" style={{ flex: '1.2' }} />
        <input className="rso-input" placeholder="Group" value={group} onChange={(e) => setGroup(e.target.value)} />
        <input className="rso-input" placeholder="Subgroup" value={subgroup} onChange={(e) => setSubgroup(e.target.value)} />
      </Toolbar>

      <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '0.5rem' }}>{filtered.length} teachers</p>

      {isLoading ? <Skeleton variant="rows" rows={6} /> : isError ? (
        <ErrorBanner message="Could not load teachers." onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="📭" title="No teachers" subtitle={search ? 'No records matched your search' : 'No teachers in this status'} />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead><tr><th>Name</th><th>Email</th><th>Fellowship</th><th>Subgroup</th><th>Status</th><th>Class</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.teacher_id}>
                  <td style={{ fontWeight: 600 }}>{t.full_name}</td>
                  <td>{t.email}</td>
                  <td>{t.fellowship_code || t.group_id || '—'}</td>
                  <td>{t.subgroup_id || '—'}</td>
                  <td><Badge status={t.status === 'ACTIVE' ? 'active' : t.status === 'PENDING' ? 'pending' : t.status === 'SUSPENDED' ? 'warning' : 'inactive'}>{t.status}</Badge></td>
                  <td style={{ fontSize: '11px', color: 'var(--muted)' }}>{classMap.get(t.teacher_id) || '—'}</td>
                  <td>{fmtDate(t.created_at)}</td>
                  <td>{statusActions(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action reason modal */}
      {actionModal && <ActionReasonModal
        action={actionModal.action}
        teacher={actionModal.teacher}
        onClose={() => setActionModal(null)}
        onConfirm={(reason) => {
          actionMut.mutate({
            teacherId: actionModal.teacher.teacher_id,
            action: actionModal.action,
            reason,
            teacherUserId: actionModal.teacher.teacher_user_id,
          });
          setActionModal(null);
        }}
      />}

      {/* Add teacher modal */}
      {addModal && <AddTeacherModal
        fellowships={fellowships ?? []}
        onClose={() => setAddModal(false)}
        onAdd={async (params) => {
          try {
            const result = await createTeacherDirect(params);
            addToast('Teacher created', 'success');
            refetch();
            return result;
          } catch (e) { addToast(e.message, 'error'); throw e; }
        }}
      />}

      {/* Link modal */}
      {linkModal && <LinkAuthModal
        teacher={linkModal}
        onClose={() => setLinkModal(null)}
        onLink={async (authUserId, allowRelink) => {
          try {
            await linkTeacherAuth(linkModal.teacher_id, authUserId, profile?.email, allowRelink);
            addToast('Linked', 'success');
            setLinkModal(null);
            refetch();
          } catch (e) { addToast(e.message, 'error'); }
        }}
      />}

      {/* Unlink modal */}
      {unlinkModal && <UnlinkModal
        teacher={unlinkModal}
        onClose={() => setUnlinkModal(null)}
        onUnlink={async (reason) => {
          try {
            await unlinkTeacherAuth(unlinkModal.teacher_id, profile?.email, reason);
            addToast('Unlinked', 'success');
            setUnlinkModal(null);
            refetch();
          } catch (e) { addToast(e.message, 'error'); }
        }}
      />}
    </div>
  );
}

function ActionReasonModal({ action, teacher, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const minLen = ['suspend', 'deactivate'].includes(action) ? 10 : 5;
  const titles = { reject: 'Reject Teacher', suspend: 'Suspend Teacher', inactivate: 'Inactivate Teacher', deactivate: 'Deactivate Teacher' };
  return (
    <Modal open title={titles[action] || action} onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => onConfirm(reason)} disabled={reason.length < minLen}>Confirm</Button>
      </>
    }>
      <p style={{ fontSize: '13px', marginBottom: '0.5rem' }}>
        {action === 'reject' ? 'Reject' : action === 'suspend' ? 'Suspend' : 'Deactivate'} <strong>{teacher.full_name}</strong>?
      </p>
      <textarea className="rso-input" rows={3} placeholder={`Reason (min ${minLen} characters)`} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function AddTeacherModal({ fellowships, onClose, onAdd }) {
  const [form, setForm] = useState({ full_name: '', email: '', temp_password: '', phone: '', group_id: '', subgroup_id: '', fellowship_code: '', notes: '' });
  const [showPw, setShowPw] = useState(false);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSubmit() {
    setSaving(true);
    try {
      const r = await onAdd(form);
      setResult(r);
    } catch {} finally { setSaving(false); }
  }

  return (
    <Modal open title="Add Teacher" onClose={onClose} footer={
      result ? <Button variant="ghost" onClick={onClose}>Close</Button> : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving || !form.full_name || !form.email.includes('@') || form.temp_password.length < 8}>
            {saving ? 'Creating…' : 'Create Teacher'}
          </Button>
        </>
      )
    }>
      {result ? (
        <div>
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Teacher created successfully</p>
          <p style={{ fontSize: '13px' }}>Email: {form.email}</p>
          <pre style={{ fontSize: '11px', background: 'var(--surface)', padding: '0.5rem', borderRadius: 'var(--r-sm)', marginTop: '0.5rem' }}>Password: {form.temp_password}</pre>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label className="rso-field"><span>Full Name *</span><input className="rso-input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required /></label>
          <label className="rso-field"><span>Email *</span><input className="rso-input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></label>
          <label className="rso-field"><span>Temporary Password *</span>
            <div style={{ position: 'relative' }}>
              <input className="rso-input" type={showPw ? 'text' : 'password'} value={form.temp_password} onChange={(e) => set('temp_password', e.target.value)} minLength={8} />
              <button onClick={() => setShowPw((p) => !p)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px' }}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <label className="rso-field"><span>Phone</span><input className="rso-input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="rso-field"><span>Group ID</span>
            <select className="rso-input" value={form.group_id} onChange={(e) => set('group_id', e.target.value)}>
              <option value="">—</option>
              {GROUP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="rso-field"><span>Subgroup ID</span>
            <select className="rso-input" value={form.subgroup_id} onChange={(e) => set('subgroup_id', e.target.value)}>
              <option value="">—</option>
              {SUBGROUP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="rso-field"><span>Fellowship Code</span>
            <select className="rso-input" value={form.fellowship_code} onChange={(e) => set('fellowship_code', e.target.value)}>
              <option value="">—</option>
              {fellowships.map((f) => <option key={f.fellowship_code} value={f.fellowship_code}>{f.fellowship_code}{f.campus_name ? ` — ${f.campus_name}` : ''}</option>)}
            </select>
          </label>
          <label className="rso-field" style={{ gridColumn: '1 / -1' }}><span>Notes</span><textarea className="rso-input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        </div>
      )}
    </Modal>
  );
}

function LinkAuthModal({ teacher, onClose, onLink }) {
  const [authUserId, setAuthUserId] = useState('');
  const [allowRelink, setAllowRelink] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open title="Link Teacher to Auth User" onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { setSaving(true); try { await onLink(authUserId, allowRelink); } finally { setSaving(false); } }} disabled={saving || !authUserId}>
          {saving ? 'Linking…' : 'Link'}
        </Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <label className="rso-field"><span>Teacher ID</span><input className="rso-input" value={teacher.teacher_id} disabled /></label>
        <label className="rso-field"><span>Teacher Email</span><input className="rso-input" value={teacher.email} disabled /></label>
        <label className="rso-field"><span>Auth User ID (UUID)</span><input className="rso-input" value={authUserId} onChange={(e) => setAuthUserId(e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '13px' }}>
          <input type="checkbox" checked={allowRelink} onChange={(e) => setAllowRelink(e.target.checked)} /> Allow relink
        </label>
      </div>
    </Modal>
  );
}

function UnlinkModal({ teacher, onClose, onUnlink }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal open title="Unlink Teacher from Auth" onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={async () => { setSaving(true); try { await onUnlink(reason); } finally { setSaving(false); } }} disabled={saving}>
          {saving ? 'Unlinking…' : 'Unlink'}
        </Button>
      </>
    }>
      <p style={{ fontSize: '13px', marginBottom: '0.5rem' }}>Unlink <strong>{teacher.full_name}</strong> ({teacher.email}) from their auth account?</p>
      <textarea className="rso-input" rows={2} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
