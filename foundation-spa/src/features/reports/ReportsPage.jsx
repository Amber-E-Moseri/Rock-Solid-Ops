import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBatches, fetchScopeOptions, fetchArchive, generateReport, fmtDate, uniqueGroups, uniqueSubgroups } from './lib/reports.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Toolbar, Skeleton, EmptyState, Button, Modal, Card } from '../../components/ui/index.js';

export default function ReportsPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const role = profile?.role;
  const isPastor = role === 'pastor';
  const isHighRole = role === 'superadmin' || role === 'admin';

  const [workspace, setWorkspace] = useState('reports');

  const batches = useQuery({ queryKey: ['report-batches'], queryFn: fetchBatches, staleTime: 5 * 60_000 });
  const scopeData = useQuery({ queryKey: ['report-scope'], queryFn: fetchScopeOptions, staleTime: 5 * 60_000 });
  const archive = useQuery({ queryKey: ['report-archive'], queryFn: fetchArchive, staleTime: 60_000 });

  const [reportType, setReportType] = useState('weekly');
  const [scope, setScope] = useState(isPastor ? 'group' : 'regional');
  const [scopeValue, setScopeValue] = useState('');
  const [batchId, setBatchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [recipients, setRecipients] = useState(profile?.email || '');
  const [sendEmail, setSendEmail] = useState(true);
  const [saveArchive, setSaveArchive] = useState(true);
  const [allPastors, setAllPastors] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [resendModal, setResendModal] = useState(null);
  const [resendEmails, setResendEmails] = useState('');

  const qc = useQueryClient();
  const genMut = useMutation({
    mutationFn: generateReport,
    onSuccess: (data) => {
      if (data?.report_html) setPreviewHtml(data.report_html);
      addToast(data?.emails_queued ? `Report sent to ${data.emails_queued} recipient(s)` : 'Report generated', 'success');
      qc.invalidateQueries({ queryKey: ['report-archive'] });
    },
    onError: (e) => addToast(e.message, 'error'),
  });

  const groups = useMemo(() => uniqueGroups(scopeData.data ?? []), [scopeData.data]);
  const subgroups = useMemo(() => uniqueSubgroups(scopeData.data ?? []), [scopeData.data]);

  function handleGenerate() {
    const payload = {
      report_type: reportType, scope, scope_value: scopeValue || undefined,
      batch_id: batchId || undefined,
      send_email: sendEmail, save_archive: saveArchive,
      recipients: recipients.split('\n').map((s) => s.trim()).filter(Boolean),
      requestor_email: profile?.email,
    };
    if (reportType === 'custom') { payload.date_from = dateFrom; payload.date_to = dateTo; }
    if (reportType === 'pastor_digest' && allPastors) payload.send_to_all_pastors = true;
    genMut.mutate(payload);
  }

  function handleResend(row) {
    const payload = {
      report_type: row.report_type, scope: row.scope, scope_value: row.scope_value,
      date_from: row.date_from, date_to: row.date_to, batch_id: row.batch_id,
      recipients: resendEmails.split('\n').map((s) => s.trim()).filter(Boolean),
      send_email: true, save_archive: false, requestor_email: profile?.email,
    };
    genMut.mutate(payload, { onSuccess: () => { setResendModal(null); addToast('Re-sent', 'success'); } });
  }

  return (
    <div className="page-content">
      <PageHeader title="Reports" subtitle="Generate reports and exports from one workspace." />

      {/* Workspace toggle */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem' }}>
        <Button variant={workspace === 'reports' ? 'primary' : 'secondary'} size="sm" onClick={() => setWorkspace('reports')}>Reports</Button>
        <Button variant={workspace === 'exports' ? 'primary' : 'secondary'} size="sm" onClick={() => setWorkspace('exports')}>Data Exports</Button>
      </div>

      {workspace === 'exports' ? (
        <div className="card" style={{ padding: '1rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            Data Exports have been moved to their own page.{' '}
            <a href="/staff/data-exports" style={{ color: 'var(--primary)' }}>Open Data Exports →</a>
          </p>
        </div>
      ) : (
        <>
          {/* Generate form */}
          <Card icon="📊" title="Generate Report">
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <label className="rso-field"><span>Report Type</span>
                <select className="rso-select" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom Range</option>
                  {(isHighRole || isPastor) && <option value="pastor_digest">Pastor Digest</option>}
                </select>
              </label>

              {reportType === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <label className="rso-field"><span>From</span><input className="rso-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
                  <label className="rso-field"><span>To</span><input className="rso-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
                </div>
              )}

              {!isPastor && (
                <label className="rso-field"><span>Scope</span>
                  <select className="rso-select" value={scope} onChange={(e) => { setScope(e.target.value); setScopeValue(''); }}>
                    <option value="regional">Regional / All</option>
                    <option value="group">By Group</option>
                    <option value="subgroup">By Subgroup</option>
                  </select>
                </label>
              )}

              {scope === 'group' && (
                <label className="rso-field"><span>Group</span>
                  <select className="rso-select" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
                    <option value="">Select group…</option>
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              )}
              {scope === 'subgroup' && (
                <label className="rso-field"><span>Subgroup</span>
                  <select className="rso-select" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
                    <option value="">Select subgroup…</option>
                    {subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}

              {reportType === 'pastor_digest' && isHighRole && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)' }}>
                  <input type="checkbox" checked={allPastors} onChange={(e) => setAllPastors(e.target.checked)} />
                  Send individual digest to all pastors
                </label>
              )}

              <label className="rso-field"><span>Batch</span>
                <select className="rso-select" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  <option value="">Auto (active batch)</option>
                  {(batches.data ?? []).map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>)}
                </select>
              </label>

              <label className="rso-field"><span>Recipients (one per line)</span>
                <textarea className="rso-input" rows={3} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="Defaults to all admins if left blank" />
              </label>

              <div style={{ display: 'flex', gap: '1rem', fontSize: 'var(--fs-sm)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Send email
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={saveArchive} onChange={(e) => setSaveArchive(e.target.checked)} /> Save to archive
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button variant="primary" onClick={handleGenerate} disabled={genMut.isPending}>
                  {genMut.isPending ? 'Generating…' : 'Generate Report'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Preview */}
          {previewHtml && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>Preview</h3>
                <Button variant="secondary" size="sm" onClick={() => {
                  const w = window.open('', '_blank');
                  if (w) { w.document.write(previewHtml); w.document.close(); w.print(); }
                }}>Download as PDF</Button>
              </div>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <iframe srcDoc={previewHtml} title="Report preview" style={{ width: '100%', minHeight: 600, border: 'none' }} />
              </div>
            </div>
          )}

          {/* Archive */}
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: '0.75rem' }}>Archive</h3>
            {archive.isLoading ? <Skeleton variant="rows" rows={3} /> : (archive.data ?? []).length === 0 ? (
              <EmptyState icon="📂" title="No archived reports" />
            ) : (
              <div className="rso-table-wrap">
                <table className="rso-table">
                  <thead>
                    <tr><th>Type</th><th>Scope</th><th>Date Range</th><th>Batch</th><th>By</th><th>Recipients</th><th>Created</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {(archive.data ?? []).map((row) => (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 600 }}>{row.report_type}</td>
                        <td>{row.scope}{row.scope_value ? `/${row.scope_value}` : ''}</td>
                        <td>{fmtDate(row.date_from)} — {fmtDate(row.date_to)}</td>
                        <td className="mono">{row.batch_id || '—'}</td>
                        <td>{row.generated_by || '—'}</td>
                        <td>{Array.isArray(row.recipients) ? row.recipients.length : '—'}</td>
                        <td>{fmtDate(row.created_at)}</td>
                        <td style={{ display: 'flex', gap: '0.25rem' }}>
                          {row.body_html && (
                            <Button variant="ghost" size="sm" onClick={() => setPreviewHtml(row.body_html)}>View</Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => { setResendModal(row); setResendEmails(profile?.email || ''); }}>Re-send</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Re-send modal */}
      {resendModal && (
        <Modal title="Re-send Report" onClose={() => setResendModal(null)} footer={
          <>
            <Button variant="ghost" onClick={() => setResendModal(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => handleResend(resendModal)} disabled={genMut.isPending}>
              {genMut.isPending ? 'Sending…' : 'Send'}
            </Button>
          </>
        }>
          <label className="rso-field"><span>Recipient Email(s) — one per line</span>
            <textarea className="rso-input" rows={4} value={resendEmails} onChange={(e) => setResendEmails(e.target.value)} />
          </label>
        </Modal>
      )}
    </div>
  );
}
