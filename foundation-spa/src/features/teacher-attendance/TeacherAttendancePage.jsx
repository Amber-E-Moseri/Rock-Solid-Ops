import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  lookupTeacher, getClassOptions, loadRoster, searchPerson, getMilestones,
  submitAttendance, submitOutcomes, fetchAttendanceHistory, SESSIONS, initials,
} from './lib/teacherAttendance.js';
import { PageHeader, Button, Skeleton, EmptyState, Badge, Modal, SearchInput } from '../../components/ui/index.js';

const STEPS = ['Teacher', 'Class', 'Action', 'Session', 'Attendance'];
function stepIdx(step) { return { teacher: 0, class: 1, action: 2, session: 3, attendance: 4, review: 4, outcomes: 4 }[step] ?? 0; }

export default function TeacherAttendancePage() {
  const { profile } = useAuth();
  const { addToast } = useToast();

  const [step, setStep] = useState('teacher');
  const [loading, setLoading] = useState(false);

  // Step 1 — teacher
  const [teacherQuery, setTeacherQuery] = useState('');
  const [teacherResults, setTeacherResults] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState(null);

  // Step 2 — class
  const [classOptions, setClassOptions] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);

  // Step 4 — session
  const [sessions, setSessions] = useState([]);
  const [classDate, setClassDate] = useState(new Date().toISOString().slice(0, 10));
  const [history, setHistory] = useState(null);

  // Step 5 — roster
  const [roster, setRoster] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [rosterSearch, setRosterSearch] = useState('');
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Step outcomes
  const [milestones, setMilestones] = useState([]);
  const [outcomes, setOutcomes] = useState({});

  // Auto-search on mount if teacher email known
  useEffect(() => {
    if (profile?.email && profile.role !== 'superadmin' && profile.role !== 'admin') {
      setTeacherQuery(profile.email);
      doTeacherSearch(profile.email);
    }
  }, [profile?.email]);

  async function doTeacherSearch(q) {
    if (!q || q.length < 2) return;
    setLoading(true);
    try {
      const results = await lookupTeacher(q);
      setTeacherResults(results);
      if (results.length === 1) setSelectedTeacher(results[0]);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function goToClasses() {
    if (!selectedTeacher) return;
    setLoading(true);
    try {
      const opts = await getClassOptions(selectedTeacher.teacherId);
      setClassOptions(opts);
      setStep('class');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function loadRosterData() {
    if (!selectedTeacher || !selectedClass || sessions.length === 0) return;
    setLoading(true);
    try {
      const result = await loadRoster(selectedTeacher.teacherId, selectedClass.classOptionId, sessions);
      setRoster(result.roster ?? []);
      setAlreadySubmitted(!!result.alreadySubmitted);
      const att = {};
      for (const r of result.roster ?? []) att[r.id] = true;
      setAttendance(att);
      setStep('attendance');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const records = roster.map((r) => ({
        personId: r.id, studentId: r.studentId, applicantId: r.applicantId,
        personType: r.personType, fullName: r.fullName, email: r.email,
        fellowshipCode: r.fellowshipCode, sourceClassOptionId: r.sourceClassOptionId,
        sourceSession: r.sourceSession,
        attendanceStatus: attendance[r.id] ? 'Present' : 'Absent',
        source: r.source,
      }));
      await submitAttendance({
        teacherId: selectedTeacher.teacherId, teacherName: selectedTeacher.fullName,
        classOptionId: selectedClass.classOptionId, classSession: sessions.join(','),
        classDate, records,
      });
      addToast('Attendance submitted', 'success');

      const ms = await getMilestones(sessions);
      if (ms.length > 0) {
        setMilestones(ms);
        setOutcomes({});
        setStep('outcomes');
      } else {
        resetToClassSelect();
      }
    } catch (e) { addToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function handleOutcomes(submitted) {
    setLoading(true);
    try {
      const presentIds = roster.filter((r) => attendance[r.id]);
      const entries = [];
      for (const person of presentIds) {
        for (const m of milestones) {
          entries.push({
            studentId: person.studentId, personType: person.personType,
            fullName: person.fullName, email: person.email,
            milestoneId: m.milestoneId, question: m.question,
            outcomeResult: outcomes[`${person.id}::${m.milestoneId}`] || '',
          });
        }
      }
      await submitOutcomes({
        teacherId: selectedTeacher.teacherId, teacherName: selectedTeacher.fullName,
        classOptionId: selectedClass.classOptionId, classSession: sessions.join(','),
        classDate, submitted, entries,
      });
      addToast(submitted ? 'Outcomes submitted' : 'Flagged for follow-up', 'success');
      resetToClassSelect();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  function resetToClassSelect() {
    setSessions([]); setRoster([]); setAttendance({}); setMilestones([]); setOutcomes({});
    setSelectedClass(null); setStep('class');
  }

  function toggleSession(s) {
    setSessions((prev) => {
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      if (prev.length >= 2) return prev;
      return [...prev, s];
    });
  }

  const present = useMemo(() => roster.filter((r) => attendance[r.id]).length, [roster, attendance]);
  const absent = roster.length - present;

  const filteredRoster = useMemo(() => {
    if (!rosterSearch) return roster;
    const q = rosterSearch.toLowerCase();
    return roster.filter((r) => (r.fullName || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q));
  }, [roster, rosterSearch]);

  async function showHistory() {
    if (history) { setHistory(null); return; }
    try {
      const h = await fetchAttendanceHistory(selectedClass.classOptionId);
      setHistory(h);
    } catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Stepper */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {STEPS.map((label, i) => (
          <div key={label} style={{
            padding: '0.3rem 0.75rem', borderRadius: 'var(--r-sm)', fontSize: '11px', fontWeight: 600,
            background: stepIdx(step) === i ? 'var(--primary)' : stepIdx(step) > i ? 'var(--color-success)' : 'var(--surface)',
            color: stepIdx(step) >= i ? '#fff' : 'var(--muted)',
          }}>{label}</div>
        ))}
      </div>

      {loading && <Skeleton variant="rows" rows={3} />}

      {/* Step 1 — Teacher */}
      {step === 'teacher' && !loading && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '0.75rem' }}>Find Teacher</h2>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input className="rso-input" style={{ flex: 1 }} placeholder="Search by name or email…" value={teacherQuery}
              onChange={(e) => setTeacherQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doTeacherSearch(teacherQuery)} />
            <Button variant="primary" onClick={() => doTeacherSearch(teacherQuery)}>Search</Button>
          </div>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {teacherResults.map((t) => (
              <div key={t.teacherId} className="rso-card" onClick={() => setSelectedTeacher(t)}
                style={{ padding: '0.75rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  border: selectedTeacher?.teacherId === t.teacherId ? '2px solid var(--primary)' : '2px solid transparent' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '11px' }}>
                  {initials(t.fullName)}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.fullName}</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{t.email} · {t.subGroupLabel}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '1rem' }}>
            <Button variant="primary" disabled={!selectedTeacher} onClick={goToClasses}>Continue</Button>
          </div>
        </div>
      )}

      {/* Step 2 — Class */}
      {step === 'class' && !loading && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '0.75rem' }}>Select Class</h2>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {classOptions.map((c) => (
              <div key={c.classOptionId} className="rso-card" onClick={() => setSelectedClass(c)}
                style={{ padding: '0.75rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: selectedClass?.classOptionId === c.classOptionId ? '2px solid var(--primary)' : '2px solid transparent' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{c.classOptionId}</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{c.day} · {c.time} · Batch {c.batch || c.batchId || c.batch_id}</div>
                </div>
                <Badge variant="info">{c.enrolledCount} enrolled</Badge>
              </div>
            ))}
            {classOptions.length === 0 && <EmptyState icon="📭" title="No active classes" subtitle="This teacher has no active class options." />}
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <Button variant="ghost" onClick={() => setStep('teacher')}>Back</Button>
            <Button variant="primary" disabled={!selectedClass} onClick={() => setStep('action')}>Continue</Button>
          </div>
        </div>
      )}

      {/* Step 3 — Action */}
      {step === 'action' && !loading && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '0.75rem' }}>Choose Action</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="rso-card" onClick={() => setStep('session')} style={{ padding: '2rem', textAlign: 'center', cursor: 'pointer' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
              <div style={{ fontWeight: 700 }}>Mark Attendance</div>
            </div>
            <div className="rso-card" style={{ padding: '2rem', textAlign: 'center', cursor: 'pointer', opacity: 0.6 }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
              <div style={{ fontWeight: 700 }}>View Student Progress</div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Coming soon</div>
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}><Button variant="ghost" onClick={() => setStep('class')}>Back</Button></div>
        </div>
      )}

      {/* Step 4 — Session */}
      {step === 'session' && !loading && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '0.75rem' }}>Select Session & Date</h2>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {SESSIONS.map((s) => (
              <button key={s} onClick={() => toggleSession(s)} style={{
                padding: '0.4rem 0.75rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                fontWeight: sessions.includes(s) ? 700 : 400, fontSize: '13px',
                background: sessions.includes(s) ? 'var(--primary)' : 'var(--surface)',
                color: sessions.includes(s) ? '#fff' : 'var(--text)',
              }}>{sessions.includes(s) ? '✓ ' : ''}{s}</button>
            ))}
          </div>
          <label className="rso-field" style={{ maxWidth: 220 }}>
            <span>Class Date</span>
            <input className="rso-input" type="date" value={classDate} onChange={(e) => setClassDate(e.target.value)} />
          </label>
          {selectedClass && (
            <Button variant="ghost" size="sm" onClick={showHistory} style={{ marginTop: '0.5rem' }}>
              {history ? 'Hide History' : 'View Session History'}
            </Button>
          )}
          {history && (
            <div style={{ marginTop: '0.75rem' }}>
              {history.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: '1rem', fontSize: '13px', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{h.date} — {h.session}</span>
                  <span style={{ color: 'var(--color-success)' }}>✓ {h.present}</span>
                  <span style={{ color: 'var(--color-danger)' }}>✗ {h.absent}</span>
                </div>
              ))}
            </div>
          )}
          {alreadySubmitted && (
            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--color-warning-bg)', borderRadius: 'var(--r-sm)', fontSize: '13px', color: 'var(--color-warning-fg)' }}>
              ⚠️ Attendance has already been submitted for this session.
            </div>
          )}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <Button variant="ghost" onClick={() => setStep('action')}>Back</Button>
            <Button variant="primary" disabled={sessions.length === 0} onClick={loadRosterData}>Load Roster</Button>
          </div>
        </div>
      )}

      {/* Step 5 — Attendance */}
      {step === 'attendance' && !loading && (
        <div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '0.75rem' }}>
            {selectedTeacher?.fullName} · {selectedClass?.classOptionId} · {sessions.join(' + ')} · {classDate}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="success" size="sm" onClick={() => { const a = {}; roster.forEach((r) => a[r.id] = true); setAttendance(a); }}>All Present</Button>
            <Button variant="danger" size="sm" onClick={() => setAttendance({})}>All Absent</Button>
            <SearchInput value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} placeholder="Search roster…" style={{ flex: 1, minWidth: 160 }} />
            <Button variant="ghost" size="sm" onClick={() => setAddModalOpen(true)}>+ Add Person</Button>
          </div>
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            {filteredRoster.map((r) => (
              <div key={r.id} onClick={() => setAttendance((a) => ({ ...a, [r.id]: !a[r.id] }))}
                className="rso-card" style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderLeft: `3px solid ${attendance[r.id] ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{r.fullName}</span>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '0.5rem' }}>{r.personType}</span>
                </div>
                <Badge variant={attendance[r.id] ? 'success' : 'danger'}>{attendance[r.id] ? 'Present' : 'Absent'}</Badge>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '13px', fontWeight: 600 }}>
            <span style={{ color: 'var(--color-success)' }}>Present: {present}</span>
            <span style={{ color: 'var(--color-danger)' }}>Absent: {absent}</span>
            <span style={{ color: 'var(--primary)' }}>Total: {roster.length}</span>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <Button variant="ghost" onClick={() => setStep('session')}>Back</Button>
            <Button variant="primary" onClick={() => setStep('review')}>Review →</Button>
          </div>
        </div>
      )}

      {/* Review */}
      {step === 'review' && !loading && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '0.75rem' }}>Review & Submit</h2>
          <div className="rso-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <p><strong>Class:</strong> {selectedClass?.classOptionId}</p>
            <p><strong>Session:</strong> {sessions.join(' + ')}</p>
            <p><strong>Date:</strong> {classDate}</p>
            <p style={{ marginTop: '0.5rem' }}>
              <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>Present: {present}</span> ·{' '}
              <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>Absent: {absent}</span> ·{' '}
              <span style={{ fontWeight: 600 }}>Total: {roster.length}</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="ghost" onClick={() => setStep('attendance')}>Back</Button>
            <Button variant="primary" onClick={handleSubmit}>Submit</Button>
          </div>
        </div>
      )}

      {/* Outcomes */}
      {step === 'outcomes' && !loading && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '0.75rem' }}>Session Outcomes</h2>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '1rem' }}>Mark milestone outcomes for present students.</p>
          {roster.filter((r) => attendance[r.id]).map((person) => (
            <div key={person.id} className="rso-card" style={{ padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{person.fullName}</div>
              {milestones.map((m) => (
                <div key={m.milestoneId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '13px' }}>
                  <span style={{ flex: 1 }}>{m.question}</span>
                  <select className="rso-select" style={{ width: 120 }}
                    value={outcomes[`${person.id}::${m.milestoneId}`] || ''}
                    onChange={(e) => setOutcomes((o) => ({ ...o, [`${person.id}::${m.milestoneId}`]: e.target.value }))}>
                    <option value="">Not marked</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <Button variant="ghost" onClick={() => handleOutcomes(false)}>Skip / Flag Follow-up</Button>
            <Button variant="primary" onClick={() => handleOutcomes(true)}>Submit Outcomes</Button>
          </div>
        </div>
      )}

      {/* Add Person Modal */}
      {addModalOpen && (
        <AddPersonModal
          classOptionId={selectedClass?.classOptionId}
          teacherId={selectedTeacher?.teacherId}
          sessions={sessions}
          onClose={() => setAddModalOpen(false)}
          onAdd={(person) => {
            setRoster((prev) => [...prev, person]);
            setAttendance((a) => ({ ...a, [person.id]: true }));
            setAddModalOpen(false);
          }}
          addToast={addToast}
        />
      )}
    </div>
  );
}

function AddPersonModal({ classOptionId, teacherId, sessions, onClose, onAdd, addToast }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [enrollForm, setEnrollForm] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });

  async function doSearch() {
    if (!query || query.length < 2) return;
    setSearching(true);
    try {
      const r = await searchPerson(query, classOptionId, teacherId, sessions);
      setResults(r);
      setEnrollForm(r.length === 0);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSearching(false); }
  }

  return (
    <Modal title="Add Person" onClose={onClose}>
      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
        <input className="rso-input" style={{ flex: 1 }} placeholder="Search by name or email…" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
        <Button variant="primary" size="sm" onClick={doSearch} disabled={searching}>Search</Button>
      </div>
      {results.map((r) => (
        <div key={r.id} className="rso-card" onClick={() => onAdd({ ...r, source: 'Search' })}
          style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', marginBottom: '0.25rem' }}>
          <span style={{ fontWeight: 600 }}>{r.fullName}</span>
          <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '0.5rem' }}>{r.email} · {r.personType}</span>
        </div>
      ))}
      {enrollForm && (
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
          <p style={{ fontSize: '13px', color: 'var(--muted)' }}>No results. Enroll a new person:</p>
          <input className="rso-input" placeholder="Full Name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          <input className="rso-input" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <input className="rso-input" placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <Button variant="primary" size="sm" disabled={!form.full_name || !form.email} onClick={() => onAdd({
            id: `ENROLL-${Date.now()}`, fullName: form.full_name, email: form.email,
            personType: 'Student', source: 'Teacher Enrolled',
          })}>Enroll & Add Present</Button>
        </div>
      )}
    </Modal>
  );
}
