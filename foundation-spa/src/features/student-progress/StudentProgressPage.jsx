import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, Card, Badge, Button, Skeleton, SearchInput } from '../../components/ui/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  searchTeachers, getTeacherClassOptions, getProgressGrid, updateStudentMilestone,
  normFaith, faithBadgeVariant, computeChecks, computeProgressPct, filterStudents, computeStats, buildCsv,
  CLASS_COLUMNS,
} from './lib/studentProgress.js';

export default function StudentProgressPage() {
  const toast = useToast();

  const [teacherQuery, setTeacherQuery] = useState('');
  const [teacherOptions, setTeacherOptions] = useState([]);
  const [showDrop, setShowDrop] = useState(false);
  const [teacher, setTeacher] = useState(null);
  const [classOptions, setClassOptions] = useState([]);
  const [classOptionId, setClassOptionId] = useState('');
  const [classesLoading, setClassesLoading] = useState(false);

  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState('');
  const [milestones, setMilestones] = useState([]);
  const [classCols, setClassCols] = useState(CLASS_COLUMNS);
  const [students, setStudents] = useState([]);
  const [view, setView] = useState('classes');
  const [search, setSearch] = useState('');
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [gridLoaded, setGridLoaded] = useState(false);
  const [msg, setMsg] = useState('');

  const searchTimer = useRef(null);
  const gridRef = useRef(null);

  const onTeacherInput = useCallback((value) => {
    setTeacherQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setShowDrop(false);
    if (value.trim().length < 2) return;
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchTeachers(value.trim());
        setTeacherOptions(results);
        setShowDrop(true);
      } catch (e) {
        console.error(e);
      }
    }, 220);
  }, []);

  const pickTeacher = useCallback(async (t) => {
    setTeacher(t);
    setTeacherQuery(t.fullName || '');
    setShowDrop(false);
    setClassesLoading(true);
    setClassOptions([]);
    setClassOptionId('');
    try {
      const options = await getTeacherClassOptions(t.teacherId);
      setClassOptions(options);
      setClassOptionId(options[0]?.classOptionId || '');
    } catch (e) {
      toast(String(e?.message || e), 'error');
    } finally {
      setClassesLoading(false);
    }
  }, [toast]);

  const loadGrid = useCallback(async () => {
    if (!teacher || !classOptionId) {
      setGridError('Please select a teacher and class.');
      return;
    }
    setGridError('');
    setGridLoading(true);
    setGridLoaded(true);
    setMsg('');
    try {
      const grid = await getProgressGrid(teacher.teacherId, classOptionId);
      setMilestones(grid.milestones);
      setClassCols(grid.classes);
      setStudents(grid.students);
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setGridLoading(false);
    }
  }, [teacher, classOptionId]);

  useEffect(() => {
    if (gridLoaded && !gridLoading && gridRef.current) {
      gridRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [gridLoaded, gridLoading]);

  const filtered = useMemo(
    () => filterStudents(students, { search, atRiskOnly, classCols }),
    [students, search, atRiskOnly, classCols],
  );

  const activeCols = view === 'classes' ? classCols : milestones;
  const stats = useMemo(() => computeStats(filtered, view, milestones, classCols), [filtered, view, milestones, classCols]);

  const handleToggleMilestone = useCallback(async (student, milestone) => {
    if (view !== 'milestones') return;
    const prev = !!(student.milestones || {})[milestone.code];
    const next = !prev;
    setStudents((prevStudents) => prevStudents.map((s) => (
      s.studentId === student.studentId
        ? { ...s, milestones: { ...s.milestones, [milestone.code]: next } }
        : s
    )));
    setMsg('');
    try {
      await updateStudentMilestone(student.studentId, milestone.code, next);
    } catch (e) {
      setStudents((prevStudents) => prevStudents.map((s) => (
        s.studentId === student.studentId
          ? { ...s, milestones: { ...s.milestones, [milestone.code]: prev } }
          : s
      )));
      setMsg(String(e?.message || 'Could not save milestone update'));
    }
  }, [view]);

  const handleExport = useCallback(() => {
    const csv = buildCsv(filtered, view, milestones, classCols);
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `student-progress-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }, [filtered, view, milestones, classCols]);

  return (
    <div className="rso-stack">
      <PageHeader title="Student Progress" subtitle="Class attendance and milestone grid — read-only attendance view from student records." />

      <Card>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Teacher &amp; Class</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 200, position: 'relative' }}>
            <label style={fieldLabel}>Teacher</label>
            <SearchInput
              placeholder="Search by name or ID…"
              value={teacherQuery}
              onChange={(e) => onTeacherInput(e.target.value)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
            />
            {showDrop && (
              <div style={dropStyle}>
                {teacherOptions.length === 0 ? (
                  <div style={{ padding: '10px 13px', fontSize: 13, color: 'var(--muted)' }}>No matches</div>
                ) : teacherOptions.map((t) => (
                  <div
                    key={t.teacherId}
                    style={dropItemStyle}
                    onMouseDown={() => pickTeacher(t)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.fullName}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.email || ''} {t.subGroupLabel || ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={fieldLabel}>Class</label>
            <select
              value={classOptionId}
              onChange={(e) => setClassOptionId(e.target.value)}
              disabled={!teacher || classesLoading}
              className="rso-select"
              style={{ width: '100%' }}
            >
              {!teacher ? (
                <option value="">— select teacher first —</option>
              ) : classesLoading ? (
                <option value="">Loading…</option>
              ) : classOptions.length === 0 ? (
                <option value="">No assigned classes yet</option>
              ) : classOptions.map((c) => (
                <option key={c.classOptionId} value={c.classOptionId}>
                  {c.campus || c.fellowship || c.classOptionId} | {c.day} {c.time}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Button onClick={loadGrid} disabled={!teacher || !classOptionId}>Load Students</Button>
          </div>
        </div>
        {gridError && (
          <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'var(--danger-bg, #fef2f2)', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600 }}>
            {gridError}
          </div>
        )}
      </Card>

      {gridLoaded && (
        <div ref={gridRef}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 3, gap: 2 }}>
              <button onClick={() => setView('classes')} style={toggleBtnStyle(view === 'classes')}>Classes</button>
              <button onClick={() => setView('milestones')} style={toggleBtnStyle(view === 'milestones')}>Milestones</button>
            </div>
            <SearchInput placeholder="Filter students…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220 }} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={() => setAtRiskOnly((v) => !v)}
                style={atRiskChipStyle(atRiskOnly)}
              >At Risk Only</button>
              <Button size="sm" variant="secondary" onClick={handleExport}>
                <Download size={12} style={{ marginRight: 4 }} /> Export CSV
              </Button>
            </div>
          </div>

          {view === 'classes' && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Attendance is recorded via the Attendance portal
            </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            {stats.total} students <span style={{ margin: '0 8px', opacity: 0.6 }}>|</span>
            {stats.overallPct}% {view === 'classes' ? 'attendance' : 'milestones'}
            {activeCols.map((col, i) => (
              <span key={view === 'classes' ? col : col.code}>
                <span style={{ margin: '0 8px', opacity: 0.6 }}>|</span>
                {stats.perColumn[i]} {view === 'classes' ? col : (col.label || col.code)}
              </span>
            ))}
          </div>

          {gridLoading ? (
            <Skeleton style={{ height: 300 }} />
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>No students found.</div>
          ) : (
            <div className="rso-table-wrap">
              <table className="rso-table" style={{ minWidth: 700 + activeCols.length * 52 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Student</th>
                    {view === 'classes'
                      ? classCols.map((c) => <th key={c} style={{ textAlign: 'center' }}>{c}</th>)
                      : milestones.map((m) => <th key={m.code} style={{ textAlign: 'center' }}>{m.label || m.code}</th>)}
                    <th style={{ textAlign: 'left', minWidth: 100 }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const checks = computeChecks(s, view, milestones, classCols);
                    const pct = computeProgressPct(checks);
                    return (
                      <tr key={s.studentId}>
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{s.fullName || '-'}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.studentId || ''}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                            <Badge variant={faithBadgeVariant('born', s.bornAgain)}>Born Again: {normFaith(s.bornAgain)}</Badge>
                            <Badge variant={faithBadgeVariant('tongues', s.speaksInTongues)}>Tongues: {normFaith(s.speaksInTongues)}</Badge>
                            <Badge variant={faithBadgeVariant('water', s.waterBaptized)}>Baptized: {normFaith(s.waterBaptized)}</Badge>
                          </div>
                        </td>
                        {checks.map((on, idx) => (
                          <td key={idx} style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              disabled={view === 'classes'}
                              onClick={() => view === 'milestones' && handleToggleMilestone(s, milestones[idx])}
                              style={cbStyle(on, view === 'classes')}
                              aria-label={view === 'classes' ? 'Attendance status' : 'Toggle milestone'}
                            >
                              {on && (
                                <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                                  <path d="M1 4L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                          </td>
                        ))}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 60, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: 'var(--primary)' }} />
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 800, minWidth: 32, textAlign: 'right' }}>{pct}%</div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Mobile cards (fallback for <640px; tappable milestone chips) */}
          {!gridLoading && filtered.length > 0 && (
            <div className="rso-table-cards">
              {filtered.map((s) => {
                const checks = computeChecks(s, view, milestones, classCols);
                const pct = computeProgressPct(checks);
                return (
                  <div key={s.studentId} className="rso-table-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{s.fullName || '-'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.studentId || ''}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>{pct}%</div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                      <Badge variant={faithBadgeVariant('born', s.bornAgain)}>Born Again: {normFaith(s.bornAgain)}</Badge>
                      <Badge variant={faithBadgeVariant('tongues', s.speaksInTongues)}>Tongues: {normFaith(s.speaksInTongues)}</Badge>
                      <Badge variant={faithBadgeVariant('water', s.waterBaptized)}>Baptized: {normFaith(s.waterBaptized)}</Badge>
                    </div>
                    <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--border)', overflow: 'hidden', margin: '10px 0' }}>
                      <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: 'var(--primary)' }} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {checks.map((on, idx) => (
                        <button
                          key={idx}
                          type="button"
                          disabled={view === 'classes'}
                          onClick={() => view === 'milestones' && handleToggleMilestone(s, milestones[idx])}
                          style={chipToggleStyle(on, view === 'classes')}
                        >
                          <span style={cbStyle(on, view === 'classes')} aria-hidden="true">
                            {on && (
                              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                                <path d="M1 4L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          {view === 'classes' ? activeCols[idx] : (milestones[idx]?.label || milestones[idx]?.code)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {msg && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'var(--danger-bg, #fef2f2)', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600 }}>
              {msg}
            </div>
          )}
        </Card>
        </div>
      )}
    </div>
  );
}

const fieldLabel = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', display: 'block', marginBottom: 4 };

const dropStyle = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
  boxShadow: '0 8px 28px rgba(0,0,0,.14)', zIndex: 50, maxHeight: 240, overflowY: 'auto',
};
const dropItemStyle = { padding: '10px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

function toggleBtnStyle(active) {
  return {
    border: 'none', borderRadius: 9, padding: '7px 16px', fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--primary)' : 'var(--muted)',
    boxShadow: active ? '0 1px 4px rgba(76,42,146,.14)' : 'none',
  };
}

function atRiskChipStyle(active) {
  return {
    border: `1px solid ${active ? 'var(--color-danger)' : 'var(--border)'}`, borderRadius: 999,
    padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    background: active ? 'var(--color-danger)' : 'var(--surface-2)',
    color: active ? '#fff' : 'var(--muted)',
  };
}

function chipToggleStyle(checked, disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    minHeight: 40, padding: '6px 12px 6px 8px', borderRadius: 10,
    border: `1px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
    background: 'var(--surface)', color: 'var(--text)',
    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
  };
}

function cbStyle(checked, disabled) {
  return {
    width: 20, height: 20, borderRadius: 5, border: `2px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
    background: checked ? 'var(--primary)' : 'var(--surface)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer', flexShrink: 0,
  };
}
