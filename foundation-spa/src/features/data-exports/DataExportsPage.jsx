import { useState, useMemo } from 'react';
import { useDataExports } from './hooks/useDataExports.js';
import { filterApplicants, exportFaithMilestones, exportFullBatch } from './lib/dataExports.js';
import { useAuth } from '../../hooks/useAuth.js';
import {
  PageHeader, Toolbar, Skeleton, EmptyState, Card, Button,
} from '../../components/ui/index.js';

function roleLevel(role) {
  const r = String(role ?? '').toLowerCase();
  if (r === 'admin' || r === 'superadmin') return 3;
  if (['principal', 'subgroup_admin', 'pastor'].includes(r)) return 2;
  if (r === 'teacher' || r === 'regional_secretary') return 1;
  return 0;
}

export default function DataExportsPage() {
  const { profile } = useAuth();
  const level = roleLevel(profile?.role);
  const isTeacher = profile?.role === 'teacher';

  const { data, isLoading } = useDataExports();

  const [filters, setFilters] = useState({ classId: '', fellowshipCode: '', batchId: '', status: '' });
  const patch = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const filtered = useMemo(
    () => data ? filterApplicants(data.applicants, filters, data.classToBatch) : [],
    [data, filters],
  );

  const fellowshipLabel = (code) => {
    const f = data?.fellowships.find((x) => x.fellowship_code === code);
    return f?.campus_name || code;
  };

  return (
    <div className="page-content">
      <PageHeader title="Data Exports" subtitle={`${filtered.length} matching records`} />

      {isLoading ? (
        <Skeleton variant="rows" rows={4} />
      ) : !data ? (
        <EmptyState icon="📊" title="No data available" />
      ) : (
        <>
          <Toolbar>
            <select className="rso-select" value={filters.classId} onChange={(e) => patch('classId', e.target.value)} disabled={isTeacher}>
              <option value="">All classes</option>
              {data.slots.map((s) => (
                <option key={s.class_option_id} value={s.class_option_id}>{s.class_option_id}</option>
              ))}
            </select>
            <select className="rso-select" value={filters.fellowshipCode} onChange={(e) => patch('fellowshipCode', e.target.value)} disabled={isTeacher}>
              <option value="">All fellowships</option>
              {data.fellowships.map((f) => (
                <option key={f.fellowship_code} value={f.fellowship_code}>{f.campus_name || f.fellowship_code}</option>
              ))}
            </select>
            <select className="rso-select" value={filters.batchId} onChange={(e) => patch('batchId', e.target.value)} disabled={isTeacher}>
              <option value="">All batches</option>
              {data.batches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>
              ))}
            </select>
            <select className="rso-select" value={filters.status} onChange={(e) => patch('status', e.target.value)}>
              <option value="">All statuses</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="WAITLISTED">WAITLISTED</option>
              <option value="ENROLLED">ENROLLED</option>
            </select>
          </Toolbar>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
            {level >= 2 && (
              <Card
                icon="🙏"
                title="Faith Milestones by Class"
                subtitle="Student milestone completion for a specific class"
              >
                {filters.classId ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => exportFaithMilestones(data.students, data.milestoneByStudent, filters.classId)}
                  >
                    Download CSV
                  </Button>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Select a class first.</p>
                )}
              </Card>
            )}

            {level >= 3 && (
              <Card
                icon="📦"
                title="Full Batch Export"
                subtitle="Complete batch data with milestones and attendance"
              >
                {filters.batchId ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => exportFullBatch(filtered, data, filters.batchId)}
                  >
                    Download CSV
                  </Button>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Select a batch first.</p>
                )}
              </Card>
            )}
          </div>

          {filtered.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: '0.75rem' }}>
                Matching Applicants ({filtered.length})
              </h3>
              <div className="rso-table-wrap">
                <table className="rso-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Fellowship</th>
                      <th>Class</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 100).map((a) => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.full_name}</td>
                        <td>{a.email}</td>
                        <td>{fellowshipLabel(a.fellowship_code)}</td>
                        <td className="mono">{a.class_option_id || '—'}</td>
                        <td><span className={`chip chip-${(a.registration_status || '').toLowerCase()}`}>{a.registration_status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > 100 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginTop: '0.5rem' }}>
                  Showing first 100 of {filtered.length} records. Use filters to narrow results, then export.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
