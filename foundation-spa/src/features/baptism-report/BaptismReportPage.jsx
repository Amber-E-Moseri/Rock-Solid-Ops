import { useState, useMemo, useCallback, useEffect } from 'react';
import { PageHeader, Card, Badge, Button, Skeleton, SearchInput } from '../../components/ui/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchBaptismData, asFaith, faithVariant, faithLabel, filterApplicants,
  computeKpis, getFilterOptions, buildCsv,
} from './lib/baptismReport.js';

export default function BaptismReportPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ fellowship: '', batch: '', water: '', born: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchBaptismData());
    } catch (e) {
      toast(e.message || 'Failed to load report', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => data ? filterApplicants(data.applicants, filters, data.classBatchMap) : [],
    [data, filters],
  );

  const kpis = useMemo(() => computeKpis(filtered), [filtered]);
  const fellowshipOpts = useMemo(() => data ? getFilterOptions(data.applicants, data.fellowshipMap) : [], [data]);

  const setFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));

  const handleExport = () => {
    if (!data) return;
    const csv = buildCsv(filtered, data.fellowshipMap, data.classMap);
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `baptism-faith-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title="Baptism & Faith Report" subtitle="Track faith profile responses by fellowship and batch." />

      {/* Filters */}
      <Card>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div>
            <label style={labelStyle}>Fellowship / Group</label>
            <select className="rso-select" value={filters.fellowship} onChange={e => setFilter('fellowship', e.target.value)} style={{ width: '100%' }}>
              <option value="">All</option>
              {fellowshipOpts.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Batch</label>
            <select className="rso-select" value={filters.batch} onChange={e => setFilter('batch', e.target.value)} style={{ width: '100%' }}>
              <option value="">All Active Batches</option>
              {(data?.batches || []).map(b => <option key={b.batch_id} value={String(b.batch_id)}>{b.batch_name || b.batch_id}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Water Baptized</label>
            <select className="rso-select" value={filters.water} onChange={e => setFilter('water', e.target.value)} style={{ width: '100%' }}>
              <option value="">All</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
              <option value="I'm not sure">Not Sure</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Born Again</label>
            <select className="rso-select" value={filters.born} onChange={e => setFilter('born', e.target.value)} style={{ width: '100%' }}>
              <option value="">All</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
              <option value="I'm not sure">Not Sure</option>
            </select>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {[
          { label: 'Total Students Shown', value: kpis.total },
          { label: 'Need Baptism', value: kpis.needBaptism },
          { label: 'Not Yet Born Again', value: kpis.notBorn },
          { label: 'Speak In Tongues', value: kpis.tongues },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{k.label}</div>
            <div style={{ marginTop: 6, fontSize: 26, fontWeight: 800, color: 'var(--primary)' }}>{loading ? '—' : k.value}</div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Button onClick={handleExport}>Download CSV</Button>
        </div>

        {loading ? <Skeleton style={{ height: 300 }} /> : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No records match current filters.</div>
        ) : (
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Fellowship</th>
                  <th>Class</th>
                  <th>Born Again</th>
                  <th>Speaks in Tongues</th>
                  <th>Water Baptized</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const fellowshipCode = String(a.fellowship_code || '');
                  const fellowship = data.fellowshipMap.get(fellowshipCode) || fellowshipCode || '-';
                  const classOptionId = String(a.class_option_id || '');
                  const classInfo = data.classMap.get(classOptionId);
                  const classLabel = classInfo
                    ? `${classOptionId} · ${classInfo.day || ''} ${classInfo.class_time || ''}`.trim()
                    : (classOptionId || '-');
                  return (
                    <tr key={a.id}>
                      <td>{a.full_name || '-'}</td>
                      <td>{a.email || '-'}</td>
                      <td>{fellowship}</td>
                      <td>{classLabel}</td>
                      <td><Badge variant={faithVariant(a.born_again)}>{faithLabel(a.born_again)}</Badge></td>
                      <td><Badge variant={faithVariant(a.speaks_in_tongues)}>{faithLabel(a.speaks_in_tongues)}</Badge></td>
                      <td><Badge variant={faithVariant(a.water_baptized)}>{faithLabel(a.water_baptized)}</Badge></td>
                      <td>{a.registration_status || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const labelStyle = { fontSize: 12, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 };
