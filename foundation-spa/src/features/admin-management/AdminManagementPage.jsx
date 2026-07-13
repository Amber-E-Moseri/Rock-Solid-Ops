import { useState, useMemo, useCallback } from 'react';
import { useStaff, useTeachers, useToggleStaffActive, useSaveStaff, useToggleTeacherActive, useSaveTeacher, useLinkTeacher, useUnlinkTeacher, useCreateStaffDirect } from './hooks/useAdminManagement.js';
import { isStaffActive, isTeacherActive, isTeacherLinked } from './lib/adminManagement.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button, Modal } from '../../components/ui/index.js';

const VALID_ROLES_SUPERADMIN = ['pending', 'teacher', 'principal', 'admin', 'superadmin', 'subgroup_admin', 'pastor'];
const VALID_ROLES_ADMIN = ['teacher', 'principal'];

// Roles each caller tier may CREATE via the server-enforced create-staff-direct action.
// Mirrors the boundary enforced in the edge function (docs/migration-log.md 2026-07-13):
// superadmin -> any role; admin -> teacher only. `pending` is never a creation target.
const CREATE_ROLES_SUPERADMIN = ['teacher', 'principal', 'subgroup_admin', 'pastor', 'regional_secretary', 'admin', 'superadmin'];
const CREATE_ROLES_ADMIN = ['teacher'];

function tabsForRole(role) {
  if (role === 'superadmin' || role === 'admin') return ['staff', 'teachers'];
  if (role === 'principal') return ['teachers'];
  return [];
}

export default function AdminManagementPage() {
  const { profile, user } = useAuth();
  const { addToast } = useToast();
  const role = profile?.role;
  const tabs = tabsForRole(role);
  const canManageStaff = role === 'admin' || role === 'superadmin';

  const [tab, setTab] = useState(tabs[0] || 'staff');
  const [search, setSearch] = useState('');
  const [editModal, setEditModal] = useState(null); // { type: 'staff'|'teacher', row: obj|null }
  const [createStaffOpen, setCreateStaffOpen] = useState(false);
  const [linkModal, setLinkModal] = useState(null); // teacher row

  const staff = useStaff();
  const teachers = useTeachers();
  const toggleStaff = useToggleStaffActive();
  const saveStaffMut = useSaveStaff();
  const toggleTeacher = useToggleTeacherActive();
  const saveTeacherMut = useSaveTeacher();
  const linkMut = useLinkTeacher();
  const unlinkMut = useUnlinkTeacher();
  const createStaffMut = useCreateStaffDirect();

  const filteredStaff = useMemo(() => {
    if (!staff.data) return [];
    const q = search.toLowerCase();
    return staff.data.rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
  }, [staff.data, search]);

  const filteredTeachers = useMemo(() => {
    if (!teachers.data) return [];
    const q = search.toLowerCase();
    return teachers.data.rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
  }, [teachers.data, search]);

  const isSelf = useCallback((row) => {
    const uid = user?.id;
    return uid && (row.id === uid || row.user_id === uid);
  }, [user]);

  async function handleToggleStaff(row) {
    if (isSelf(row)) return addToast('Cannot deactivate yourself', 'error');
    try {
      await toggleStaff.mutateAsync({ row, idKey: staff.data.idKey, next: !isStaffActive(row) });
      addToast('Updated', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }

  async function handleToggleTeacher(row) {
    try {
      await toggleTeacher.mutateAsync({ row, meta: teachers.data, next: !isTeacherActive(row) });
      addToast('Updated', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }

  async function handleUnlink(row) {
    const tid = row[teachers.data.idKey];
    try {
      await unlinkMut.mutateAsync({ teacherId: tid });
      addToast('Unlinked', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }

  if (tabs.length === 0) {
    return <EmptyState icon="🚫" title="Access Denied" subtitle="You don't have permission to view this page." />;
  }

  const isLoading = tab === 'staff' ? staff.isLoading : teachers.isLoading;

  return (
    <div className="page-content">
      <PageHeader
        title="Admin Management"
        subtitle={`${profile?.full_name || profile?.email} — ${role}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => { staff.refetch(); teachers.refetch(); }}>Refresh</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => (tab === 'staff' ? setCreateStaffOpen(true) : setEditModal({ type: 'teacher', row: null }))}
            >
              {tab === 'staff' ? 'Add Staff' : 'Add'}
            </Button>
          </>
        }
      />

      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch(''); }}
              style={{
                padding: '0.4rem 1rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                fontWeight: tab === t ? 600 : 400, fontSize: 'var(--fs-sm)',
                background: tab === t ? 'var(--primary)' : 'var(--surface)',
                color: tab === t ? '#fff' : 'var(--text-muted)',
              }}
            >
              {t === 'staff' ? 'Staff' : 'Teachers'}
            </button>
          ))}
        </div>
      )}

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" />
        {search && <Button variant="ghost" size="sm" onClick={() => setSearch('')}>Clear</Button>}
      </Toolbar>

      {isLoading ? <Skeleton variant="rows" rows={6} /> : tab === 'staff' ? (
        filteredStaff.length === 0 ? <EmptyState icon="📭" title="No staff" subtitle={search ? 'No records matched your search' : 'Add a record to get started'} /> : (
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredStaff.map((r) => {
                  const active = isStaffActive(r);
                  const elevated = ['superadmin', 'admin', 'pastor', 'principal', 'subgroup_admin'].includes(r.role);
                  return (
                    <tr key={r[staff.data.idKey] || r.id}>
                      <td style={{ fontWeight: 600 }}>{r.full_name || '—'}</td>
                      <td>{r.email}</td>
                      <td><Badge variant={elevated ? 'info' : 'neutral'}>{r.role}</Badge></td>
                      <td><Badge variant={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge></td>
                      <td style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {canManageStaff && <Button variant="ghost" size="sm" onClick={() => setEditModal({ type: 'staff', row: r })}>Edit Role</Button>}
                        {canManageStaff && (
                          <Button variant={active ? 'danger' : 'ghost'} size="sm" onClick={() => handleToggleStaff(r)} disabled={isSelf(r)}>
                            {active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        filteredTeachers.length === 0 ? <EmptyState icon="📭" title="No teachers" subtitle={search ? 'No records matched your search' : 'Add a record to get started'} /> : (
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead><tr><th>Name</th><th>Email</th><th>Group</th><th>Subgroup</th><th>Active</th><th>Auth</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredTeachers.map((r) => {
                  const active = isTeacherActive(r);
                  const linked = isTeacherLinked(r);
                  const tid = r[teachers.data.idKey];
                  return (
                    <tr key={tid}>
                      <td style={{ fontWeight: 600 }}>{r[teachers.data.nameKey] || r.full_name || '—'}</td>
                      <td>{r.email}</td>
                      <td>{r.group_id || '—'}</td>
                      <td>{r.subgroup_id || '—'}</td>
                      <td><Badge variant={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge></td>
                      <td><Badge variant={linked ? 'info' : 'warning'}>{linked ? 'Linked' : 'Unlinked'}</Badge></td>
                      <td style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        <Button variant="ghost" size="sm" onClick={() => setEditModal({ type: 'teacher', row: r })}>Edit</Button>
                        <Button variant={active ? 'danger' : 'ghost'} size="sm" onClick={() => handleToggleTeacher(r)}>
                          {active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setLinkModal(r)}>
                          {linked ? 'Relink' : 'Link Auth'}
                        </Button>
                        {linked && <Button variant="ghost" size="sm" onClick={() => handleUnlink(r)}>Unlink</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Create Staff Modal (server-enforced auth user creation) */}
      {createStaffOpen && (
        <CreateStaffModal
          roleOptions={role === 'superadmin' ? CREATE_ROLES_SUPERADMIN : CREATE_ROLES_ADMIN}
          onClose={() => setCreateStaffOpen(false)}
          onCreate={(values) => createStaffMut.mutateAsync(values)}
          onError={(msg) => addToast(msg, 'error')}
          creating={createStaffMut.isPending}
        />
      )}

      {/* Edit Staff Modal */}
      {editModal?.type === 'staff' && (
        <StaffModal
          row={editModal.row}
          idKey={staff.data?.idKey}
          roleOptions={role === 'superadmin' ? VALID_ROLES_SUPERADMIN : VALID_ROLES_ADMIN}
          isSelf={editModal.row && isSelf(editModal.row)}
          onClose={() => setEditModal(null)}
          onSave={async (values) => {
            try {
              await saveStaffMut.mutateAsync({ row: editModal.row, idKey: staff.data?.idKey, values });
              addToast('Saved', 'success');
              setEditModal(null);
            } catch (e) { addToast(e.message, 'error'); }
          }}
          saving={saveStaffMut.isPending}
        />
      )}

      {/* Edit Teacher Modal */}
      {editModal?.type === 'teacher' && (
        <TeacherModal
          row={editModal.row}
          meta={teachers.data}
          onClose={() => setEditModal(null)}
          onSave={async (values) => {
            try {
              await saveTeacherMut.mutateAsync({ row: editModal.row, meta: teachers.data, values });
              addToast('Saved', 'success');
              setEditModal(null);
            } catch (e) { addToast(e.message, 'error'); }
          }}
          saving={saveTeacherMut.isPending}
        />
      )}

      {/* Link Teacher Modal */}
      {linkModal && (
        <LinkModal
          row={linkModal}
          meta={teachers.data}
          onClose={() => setLinkModal(null)}
          onLink={async (authUserId, allowRelink) => {
            try {
              await linkMut.mutateAsync({ teacherId: linkModal[teachers.data.idKey], authUserId, allowRelink });
              addToast('Linked', 'success');
              setLinkModal(null);
            } catch (e) { addToast(e.message, 'error'); }
          }}
          saving={linkMut.isPending}
        />
      )}
    </div>
  );
}

function StaffModal({ row, roleOptions, isSelf, onClose, onSave, saving }) {
  const [values, setValues] = useState({
    email: row?.email || '',
    full_name: row?.full_name || '',
    role: row?.role || 'teacher',
    active: isStaffActive(row || {}) ? 'true' : 'false',
  });
  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));
  return (
    <Modal open title={row ? 'Edit Staff Account' : 'Add Staff Profile'} onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(values)} disabled={saving || !values.email || !values.full_name}>{saving ? 'Saving…' : 'Save'}</Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <label className="rso-field"><span>Email</span><input className="rso-input" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} disabled={!!row} required /></label>
        <label className="rso-field"><span>Full Name</span><input className="rso-input" value={values.full_name} onChange={(e) => set('full_name', e.target.value)} required /></label>
        <label className="rso-field"><span>Role</span>
          <select className="rso-select" value={values.role} onChange={(e) => set('role', e.target.value)}>
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="rso-field"><span>Active</span>
          <select className="rso-select" value={values.active} onChange={(e) => set('active', e.target.value)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        {!row && <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>To create a brand-new staff account, use “Add Staff” — it provisions the login for you. This form only edits an existing profile.</p>}
        {isSelf && <p style={{ fontSize: 'var(--fs-xs)', color: '#b91c1c' }}>You cannot demote or deactivate yourself.</p>}
      </div>
    </Modal>
  );
}

function TeacherModal({ row, meta, onClose, onSave, saving }) {
  const nameKey = meta?.nameKey || 'full_name';
  const [values, setValues] = useState({
    full_name: row?.[nameKey] || row?.full_name || '',
    email: row?.email || '',
    phone: row?.phone || '',
    group_id: row?.group_id || '',
    subgroup_id: row?.subgroup_id || '',
    active: row ? (isTeacherActive(row) ? 'true' : 'false') : 'true',
  });
  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));
  return (
    <Modal open title={row ? 'Edit Teacher' : 'Add Teacher'} onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(values)} disabled={saving || !values.full_name || !values.email || !values.group_id}>{saving ? 'Saving…' : 'Save'}</Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <label className="rso-field"><span>Full Name</span><input className="rso-input" value={values.full_name} onChange={(e) => set('full_name', e.target.value)} required /></label>
        <label className="rso-field"><span>Email</span><input className="rso-input" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} required /></label>
        <label className="rso-field"><span>Phone</span><input className="rso-input" value={values.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <label className="rso-field"><span>Group ID</span><input className="rso-input" value={values.group_id} onChange={(e) => set('group_id', e.target.value)} required /></label>
        <label className="rso-field"><span>Subgroup ID</span><input className="rso-input" value={values.subgroup_id} onChange={(e) => set('subgroup_id', e.target.value)} /></label>
        <label className="rso-field"><span>Active</span>
          <select className="rso-select" value={values.active} onChange={(e) => set('active', e.target.value)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}

function LinkModal({ row, meta, onClose, onLink, saving }) {
  const [authUserId, setAuthUserId] = useState('');
  const [allowRelink, setAllowRelink] = useState(false);
  return (
    <Modal open title="Link Teacher to Auth User" onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onLink(authUserId, allowRelink)} disabled={saving || !authUserId}>{saving ? 'Linking…' : 'Link'}</Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <label className="rso-field"><span>Teacher ID</span><input className="rso-input" value={row[meta.idKey]} disabled /></label>
        <label className="rso-field"><span>Teacher Email</span><input className="rso-input" value={row.email} disabled /></label>
        <label className="rso-field"><span>Auth User ID (UUID)</span><input className="rso-input" value={authUserId} onChange={(e) => setAuthUserId(e.target.value)} placeholder="Supabase Auth user UUID" required /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={allowRelink} onChange={(e) => setAllowRelink(e.target.checked)} />
          Allow relink (override existing link)
        </label>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Email-only auto-linking is disabled. You must provide the Supabase Auth user UUID.</p>
      </div>
    </Modal>
  );
}

function CreateStaffModal({ roleOptions, onClose, onCreate, onError, creating }) {
  const [values, setValues] = useState({
    full_name: '',
    email: '',
    temp_password: '',
    role: roleOptions[0] || 'teacher',
    notes: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState(null); // { email, temp_password, role }
  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));

  const emailValid = values.email.includes('@');
  const passwordValid = values.temp_password.length >= 8 && values.temp_password.length <= 72;
  const canSubmit = !creating && values.full_name.trim() && emailValid && passwordValid && values.role;

  async function submit() {
    try {
      const res = await onCreate({
        full_name: values.full_name.trim(),
        email: values.email.trim().toLowerCase(),
        temp_password: values.temp_password,
        role: values.role,
        notes: values.notes.trim() || null,
      });
      setResult({
        email: res?.email || values.email.trim().toLowerCase(),
        temp_password: res?.temp_password || values.temp_password,
        role: res?.role || values.role,
      });
    } catch (e) {
      onError?.(e.message || 'Failed to create staff user');
    }
  }

  return (
    <Modal
      open
      title="Add Staff / Admin"
      onClose={onClose}
      footer={result ? (
        <Button variant="primary" onClick={onClose}>Done</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>{creating ? 'Creating…' : 'Create User'}</Button>
        </>
      )}
    >
      {result ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
            Account created as <strong>{result.role}</strong>. Share these credentials with the user — the temporary password is shown only once here.
          </p>
          <label className="rso-field"><span>Email</span><input className="rso-input" value={result.email} readOnly /></label>
          <label className="rso-field"><span>Temporary Password</span><input className="rso-input" value={result.temp_password} readOnly /></label>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <label className="rso-field"><span>Full Name</span><input className="rso-input" value={values.full_name} onChange={(e) => set('full_name', e.target.value)} required /></label>
          <label className="rso-field"><span>Email</span><input className="rso-input" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} required /></label>
          <label className="rso-field"><span>Temporary Password</span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input className="rso-input" type={showPassword ? 'text' : 'password'} value={values.temp_password} onChange={(e) => set('temp_password', e.target.value)} style={{ flex: 1 }} required />
              <Button variant="ghost" size="sm" onClick={() => setShowPassword((s) => !s)}>{showPassword ? 'Hide' : 'Show'}</Button>
            </div>
            {values.temp_password && !passwordValid && <span style={{ fontSize: 'var(--fs-xs)', color: '#b91c1c' }}>Must be 8–72 characters.</span>}
          </label>
          <label className="rso-field"><span>Role</span>
            <select className="rso-select" value={values.role} onChange={(e) => set('role', e.target.value)}>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="rso-field"><span>Notes (optional)</span><input className="rso-input" value={values.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Creates the Supabase Auth login and profile directly. Only roles you are permitted to assign are listed; the server re-checks this.</p>
        </div>
      )}
    </Modal>
  );
}
