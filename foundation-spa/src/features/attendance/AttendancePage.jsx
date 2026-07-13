import { useState, useMemo, useCallback, useEffect } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, Card, Badge, Button, Skeleton } from '../../components/ui/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchClasses, demoClasses, counts, classStatus, computeKpis, initials } from './lib/attendance.js';

export default function AttendancePage() {
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchClasses();
      if (!data.length) throw new Error('no data');
      setClasses(data);
      setSelId(data[0]?.id ?? null);
    } catch {
      const demo = demoClasses();
      setClasses(demo);
      setSelId(demo[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => computeKpis(classes), [classes]);
  const selected = classes.find(c => c.id === selId) || null;
  const cc = selected ? counts(selected) : null;

  const setStudentStatus = (index, status) => {
    setClasses(prev => prev.map(c => {
      if (c.id !== selId) return c;
      const roster = [...c.roster];
      roster[index] = { ...roster[index], status };
      return { ...c, roster };
    }));
  };

  const markAllPresent = () => {
    setClasses(prev => prev.map(c => {
      if (c.id !== selId) return c;
      return { ...c, roster: c.roster.map(s => ({ ...s, status: s.status || 'present' })) };
    }));
  };

  const submitAttendance = () => {
    if (!selected) return;
    const c = counts(selected);
    if (c.m === c.total) { toast('Mark at least one student first.', 'warning'); return; }
    setClasses(prev => prev.map(cl => cl.id === selId ? { ...cl, submitted: true } : cl));
    toast(`${selected.loc} attendance submitted (${c.p} present, ${c.a} absent).`, 'success');
  };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Attendance"
        subtitle="Track submission across classes and mark the roster. Missing submissions are flagged for follow-up."
        actions={<Button variant="secondary" onClick={() => toast('Export coming soon.', 'info')}><Download size={14} style={{ marginRight: 4 }} /> Export</Button>}
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {[
          { label: 'Submission rate', value: loading ? '—' : kpis.rate },
          { label: 'Classes missing', value: loading ? '—' : kpis.missing, color: kpis.missing > 0 ? 'var(--color-danger)' : undefined },
          { label: 'Flagged · multi-session', value: loading ? '—' : kpis.flagged, color: kpis.flagged > 0 ? 'var(--color-danger)' : undefined },
          { label: 'On-time rate', value: loading ? '—' : kpis.onTime, color: 'var(--color-warning)' },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: k.color || 'var(--text)' }}>{k.value}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 5 }}>{k.label}</div>
          </Card>
        ))}
      </div>

      {loading ? <Skeleton style={{ height: 400 }} /> : (
        <div style={{ display: 'grid', gridTemplateColumns: '380px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
          {/* Class list */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', padding: '0 4px 6px' }}>
              {classes.length} class{classes.length !== 1 ? 'es' : ''} · {today}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {classes.map(c => {
                const st = classStatus(c);
                const ccc = counts(c);
                const pct = c.submitted && ccc.total ? Math.round((ccc.p + ccc.l) / ccc.total * 100) + '%' : '—';
                const flagged = c.flagSessions && c.flagSessions.length > 1;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelId(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
                      background: 'var(--surface)', border: `1px solid ${c.id === selId ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: 8, cursor: 'pointer', position: 'relative',
                      boxShadow: c.id === selId ? '0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent)' : undefined,
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, flexShrink: 0,
                      background: st === 'ok' ? 'var(--success-bg)' : st === 'miss' ? 'var(--danger-bg)' : 'var(--warn-bg)',
                      color: st === 'ok' ? 'var(--color-success)' : st === 'miss' ? 'var(--color-danger)' : 'var(--color-warning)',
                    }}>
                      {st === 'ok' ? '✓' : st === 'miss' ? '!' : '½'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 14, fontWeight: 700, display: 'block' }}>{c.loc}</b>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>{c.time} · {c.teacher}</div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                        <Badge variant="primary">S{c.session}</Badge>
                        {flagged && <Badge variant="danger">🚩 {c.flagSessions.length}</Badge>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{pct}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>
                        {st === 'ok' ? 'Submitted' : st === 'miss' ? 'Missing' : 'In progress'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Roster panel */}
          <Card style={{ overflow: 'hidden', padding: 0 }}>
            {!selected ? (
              <div style={{ padding: 56, textAlign: 'center', color: 'var(--muted)', fontSize: 14, fontWeight: 600 }}>Select a class to view the roster</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 22px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>{selected.loc}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                      {selected.time} · {selected.teacher} · {cc.total} student{cc.total !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <Badge variant="primary">
                        {selected.flagSessions?.length > 1 ? `Sessions ${selected.flagSessions.join(', ')}` : `Session ${selected.session}`}
                      </Badge>
                      {selected.flagSessions?.length > 1 && <Badge variant="danger">🚩 Flagged · multi-session</Badge>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                    {[
                      { n: cc.p, l: 'Present', bg: 'var(--success-bg)', color: 'var(--color-success)' },
                      { n: cc.l, l: 'Late', bg: 'var(--warn-bg)', color: 'var(--color-warning)' },
                      { n: cc.a, l: 'Absent', bg: 'var(--danger-bg)', color: 'var(--color-danger)' },
                    ].map(t => (
                      <div key={t.l} style={{ textAlign: 'center', borderRadius: 8, padding: '7px 14px', minWidth: 64, background: t.bg, color: t.color }}>
                        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{t.n}</div>
                        <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4, opacity: 0.8 }}>{t.l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {selected.roster.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 22px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%', background: 'var(--soft-lav, #ede9fe)', color: 'var(--primary)',
                      fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {initials(s.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13.5, fontWeight: 700 }}>{s.name}</b>
                    </div>
                    <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)' }}>
                      {['present', 'late', 'absent'].map(st => (
                        <button
                          key={st}
                          onClick={() => setStudentStatus(i, st)}
                          style={{
                            fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, border: 0, cursor: 'pointer', padding: '7px 13px',
                            borderRight: st !== 'absent' ? '1px solid var(--border)' : 'none',
                            background: s.status === st
                              ? (st === 'present' ? 'var(--color-success)' : st === 'late' ? 'var(--color-warning)' : 'var(--color-danger)')
                              : 'transparent',
                            color: s.status === st ? '#fff' : 'var(--muted)',
                          }}
                        >
                          {st.charAt(0).toUpperCase() + st.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div style={{
                  padding: '16px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)',
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
                    {selected.submitted ? 'Submitted · you can update and re-submit.' : `${cc.m} of ${cc.total} still unmarked.`}
                  </span>
                  <Button variant="secondary" onClick={markAllPresent} style={{ marginLeft: 'auto' }}>Mark all present</Button>
                  <Button onClick={submitAttendance}>{selected.submitted ? 'Update attendance' : 'Submit attendance'}</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
