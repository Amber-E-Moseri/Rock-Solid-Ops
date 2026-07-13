import { useState, useMemo } from 'react';
import { useRoleAuditData, useChangeRole, useSetActive } from './hooks/useRoleAudit.js';
import { computeRoleKpis, filterProfiles, ALL_ROLES } from './lib/roleAudit.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, KpiGrid, Kpi, Toolbar, SearchInput, Skeleton, EmptyState, Button,
} from '../../components/ui/index.js';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'admin', label: 'Admins' },
  { key: 'teacher', label: 'Teachers' },
  { key: 'pastor', label: 'Pastors' },
  { key: 'pending', label: 'Pending' },
  { key: 'inactive', label: 'Inactive' },
];

const ROLE_CHIP_CLASS = {
  superadmin: 'role-superadmin',
  admin: 'role-admin',
  pastor: 'role-pastor',
  principal: 'role-principal',
  teacher: 'role-teacher',
  subgroup_admin: 'role-subgroup_admin',
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function RoleAuditPage() {
  const { profile } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';
  const { addToast } = useToast();

  const { data, isLoading, refetch } = useRoleAuditData();
  const changeRole = useChangeRole();
  const setActive = useSetActive();

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const profiles = data?.profiles ?? [];
  const teacherEmails = data?.teacherEmails ?? new Set();
  const classCounts = data?.classCounts ?? {};

  const kpis = useMemo(() => computeRoleKpis(profiles), [profiles]);
  const filtered = useMemo(() => filterProfiles(profiles, { tab, search }), [profiles, tab, search]);

  async function handleRoleChange(uid, newRole) {
    try {
      await changeRole.mutateAsync({ uid, newRole });
      addToast('Role updated', 'success');
    } catch (e) {
      addToast(`Failed: ${e.message}`, 'error');
    }
  }

  async function handleSetActive(uid, active) {
    try {
      await setActive.mutateAsync({ uid, active });
      addToast(active ? 'User activated' : 'User deactivated', 'success');
    } catch (e) {
      addToast(`Failed: ${e.message}`, 'error');
    }
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Role Audit"
        subtitle={`${filtered.length} user${filtered.length !== 1 ? 's' : ''}`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => refetch()}>Refresh</Button>
        }
      />

      <KpiGrid>
        <Kpi label="Total Users" value={kpis.total} />
        <Kpi label="Admins" value={kpis.admins} />
        <Kpi label="Teachers" value={kpis.teachers} />
        <Kpi label="Pastors" value={kpis.pastors} />
        <Kpi label="Pending" value={kpis.pending} />
        <Kpi label="Inactive" value={kpis.inactive} />
      </KpiGrid>

      <div className="tab-bar" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-btn${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
            style={{
              padding: '0.35rem 0.9rem',
              borderRadius: 'var(--r-sm)',
              border: 'none',
              background: tab === t.key ? 'var(--color-primary)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--text-muted)',
              fontWeight: tab === t.key ? 600 : 400,
              cursor: 'pointer',
              fontSize: 'var(--fs-sm)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
        />
      </Toolbar>

      {isLoading ? (
        <Skeleton variant="rows" rows={10} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="👥" title="No users found" subtitle="Try a different tab or search term." />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Joined</th>
                <th>Updated</th>
                <th>Teacher Record</th>
                <th>Linked Classes</th>
                {isSuperadmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const emailKey = String(p.email ?? '').toLowerCase();
                const hasTeacherRecord = teacherEmails.has(emailKey);
                const classCount = classCounts[emailKey] || 0;
                const inactive = p.is_active === false;
                return (
                  <tr key={p.id} style={{ opacity: inactive ? 0.55 : 1 }}>
                    <td style={{ fontWeight: 600 }}>{p.full_name || '—'}</td>
                    <td>{p.email}</td>
                    <td>
                      {isSuperadmin ? (
                        <select
                          className="rso-select"
                          value={p.role ?? ''}
                          onChange={(e) => handleRoleChange(p.id, e.target.value)}
                          style={{ fontSize: 'var(--fs-xs)', padding: '0.2rem 0.4rem' }}
                        >
                          {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className={`chip ${ROLE_CHIP_CLASS[p.role] || 'chip-draft'}`}>{p.role}</span>
                      )}
                    </td>
                    <td>{inactive ? 'No' : 'Yes'}</td>
                    <td className="mono">{fmtDate(p.created_at)}</td>
                    <td className="mono">{fmtDate(p.updated_at)}</td>
                    <td>{hasTeacherRecord ? 'Yes' : '—'}</td>
                    <td>{classCount > 0 ? classCount : '—'}</td>
                    {isSuperadmin && (
                      <td>
                        <Button
                          variant={inactive ? 'success' : 'danger'}
                          size="sm"
                          onClick={() => handleSetActive(p.id, !inactive)}
                          disabled={setActive.isPending}
                        >
                          {inactive ? 'Activate' : 'Deactivate'}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
