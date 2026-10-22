import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { ATTENDANCE_SUBMIT_CERTIFIED, ATTENDANCE_SUBMIT_HOLD_MESSAGE } from '../../releaseHolds.js';
import {
  lookupTeacher, getClassOptions, loadRoster, searchPerson, getMilestones,
  submitAttendance, submitOutcomes, fetchAttendanceHistory, SESSIONS, initials,
} from './lib/teacherAttendance.js';
import { Button, Skeleton, EmptyState, Badge, Modal, SearchInput } from '../../components/ui/index.js';

const STEPS = ['Teacher', 'Class', 'Action', 'Session', 'Attendance'];
function stepIdx(step) { return { teacher: 0, class: 1, action: 2, session: 3, attendance: 4, review: 4, saved: 4, outcomes: 4 }[step] ?? 0; }

export default function TeacherAttendancePage() {
  const { profile } = useAuth();
  const addToast = useToast();

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
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [milestoneError, setMilestoneError] = useState(null);
  // Client-side save guards. The server is the source of truth; these only stop
  // this page from sending the same roster twice.
  const savingRef = useRef(false);
  const submittedRef = useRef(false);
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
    submittedRef.current = false;
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
    // Held: no roster write until attendance submission is certified (releaseHolds.js).
    if (!ATTENDANCE_SUBMIT_CERTIFIED) return;
    // Ignore repeat presses while a save is in flight, and never resend a roster the
    // server has already confirmed.
    if (savingRef.current || submittedRef.current) return;
    savingRef.current = true;
    setLoading(true);
    try {
      const rosterMembers = roster.filter((r) => !r.isGuest);
      const guestMembers = roster.filter((r) => r.isGuest && attendance[r.id]);
      const records = rosterMembers.map((r) => ({
        personId: r.id, studentId: r.studentId, applicantId: r.applicantId,
        personType: r.personType, fullName: r.fullName, email: r.email,
        fellowshipCode: r.fellowshipCode, sourceClassOptionId: r.sourceClassOptionId,
        sourceSession: r.sourceSession,
        attendanceStatus: attendance[r.id] ? 'Present' : 'Absent',
        source: r.source,
      }));
      const guestRecords = guestMembers.map((r) => ({
        guestName: r.fullName,
        guestPhone: r.phone || '',
      }));
      await submitAttendance({
        teacherId: selectedTeacher.teacherId, teacherName: selectedTeacher.fullName,
        classOptionId: selectedClass.classOptionId, classSession: sessions.join(','),
        classDate, records, guestRecords,
      });
      // Confirmed by the server. Enter the saved state before anything else, so no
      // later failure can bring the Submit button back.
      submittedRef.current = true;
      setStep('saved');
    } catch (e) {
      notifySafely(e.message, 'error');
      return;
    } finally {
      savingRef.current = false;
      setLoading(false);
    }
    notifySafely('Attendance submitted', 'success');
    await loadOutcomes();
  }

  // Secondary read after a confirmed save. A failure is shown inline with a retry;
  // it never repeats the attendance write.
  async function loadOutcomes() {
    setOutcomesLoading(true);
    setMilestoneError(null);
    try {
      const ms = await getMilestones(sessions);
      if (ms.length > 0) {
        setMilestones(ms);
        setOutcomes({});
        setStep('outcomes');
      } else {
        resetToClassSelect();
      }
    } catch (e) {
      setMilestoneError(e.message || 'Could not load outcome questions.');
    } finally {
      setOutcomesLoading(false);
    }
  }

  // A toast is informational. A failing toast must not change the save outcome.
  function notifySafely(message, type) {
    try { addToast(message, type); } catch (err) { console.warn('[attendance] toast failed', err); }
  }

  async function handleOutcomes(submitted) {
    // Held: no outcome write until attendance submission is certified (releaseHolds.js).
    if (!ATTENDANCE_SUBMIT_CERTIFIED) return;
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
    submittedRef.current = false;
    setMilestoneError(null);
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
    <div className="rso-tp-stack">
      <ol className="rso-tp-stepper" aria-label="Attendance steps">
        {STEPS.map((label, i) => {
          const state = stepIdx(step) === i ? 'is-current' : stepIdx(step) > i ? 'is-done' : '';
          return (
            <li key={label} className={`rso-tp-step ${state}`.trim()}
              aria-current={stepIdx(step) === i ? 'step' : undefined}>{label}</li>
          );
        })}
      </ol>

      {loading && <Skeleton variant="rows" rows={3} />}

      {/* Step 1 — Teacher */}
      {step === 'teacher' && !loading && (
        <div>
          <h2 className="rso-tp-heading">Find Teacher</h2>
          <div className="rso-tp-row">
            <input className="rso-input rso-tp-row-grow" aria-label="Search teachers" placeholder="Search by name or email…" value={teacherQuery}
              onChange={(e) => setTeacherQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doTeacherSearch(teacherQuery)} />
            <Button variant="primary" onClick={() => doTeacherSearch(teacherQuery)}>Search</Button>
          </div>
          <div className="rso-tp-stack-tight">
            {teacherResults.map((t) => (
              <button key={t.teacherId} type="button" className="rso-card rso-tp-pick"
                aria-pressed={selectedTeacher?.teacherId === t.teacherId}
                onClick={() => setSelectedTeacher(t)}>
                <span className="rso-tp-avatar" aria-hidden="true">{initials(t.fullName)}</span>
                <span>
                  <span className="rso-tp-name rso-tp-line">{t.fullName}</span>
                  <span className="rso-tp-meta rso-tp-line">{t.email} · {t.subGroupLabel}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="rso-tp-actions">
            <Button variant="primary" disabled={!selectedTeacher} onClick={goToClasses}>Continue</Button>
          </div>
        </div>
      )}

      {/* Step 2 — Class */}
      {step === 'class' && !loading && (
        <div>
          <h2 className="rso-tp-heading">Select Class</h2>
          <div className="rso-tp-stack-tight">
            {classOptions.map((c) => (
              <button key={c.classOptionId} type="button" className="rso-card rso-tp-pick rso-tp-pick-spread"
                aria-pressed={selectedClass?.classOptionId === c.classOptionId}
                onClick={() => setSelectedClass(c)}>
                <span>
                  <span className="rso-tp-name rso-tp-line">{c.classOptionId}</span>
                  <span className="rso-tp-meta rso-tp-line">{c.day} · {c.time} · Batch {c.batch || c.batchId || c.batch_id}</span>
                </span>
                <Badge variant="info">{c.enrolledCount} enrolled</Badge>
              </button>
            ))}
            {classOptions.length === 0 && <EmptyState icon="📭" title="No active classes" subtitle="This teacher has no active class options." />}
          </div>
          <div className="rso-tp-actions">
            <Button variant="ghost" onClick={() => setStep('teacher')}>Back</Button>
            <Button variant="primary" disabled={!selectedClass} onClick={() => setStep('action')}>Continue</Button>
          </div>
        </div>
      )}

      {/* Step 3 — Action */}
      {step === 'action' && !loading && (
        <div>
          <h2 className="rso-tp-heading">Choose Action</h2>
          <div className="rso-tp-grid-2">
            <button type="button" className="rso-card rso-tp-choice" onClick={() => setStep('session')}>
              <span className="rso-tp-choice-icon rso-tp-line" aria-hidden="true">✅</span>
              <span className="rso-tp-name rso-tp-line">Mark Attendance</span>
            </button>
            <button type="button" className="rso-card rso-tp-choice" disabled>
              <span className="rso-tp-choice-icon rso-tp-line" aria-hidden="true">📊</span>
              <span className="rso-tp-name rso-tp-line">View Student Progress</span>
              <span className="rso-tp-meta rso-tp-line">Coming soon</span>
            </button>
          </div>
          <div className="rso-tp-actions">
            <Button variant="ghost" onClick={() => setStep('class')}>Back</Button>
          </div>
        </div>
      )}

      {/* Step 4 — Session */}
      {step === 'session' && !loading && (
        <div>
          <h2 className="rso-tp-heading">Select Session & Date</h2>
          <div className="rso-tp-session-chips">
            {SESSIONS.map((s) => (
              <button key={s} type="button" className="rso-tp-toggle" aria-pressed={sessions.includes(s)}
                onClick={() => toggleSession(s)}>{sessions.includes(s) ? '✓ ' : ''}{s}</button>
            ))}
          </div>
          <label className="rso-field rso-tp-date">
            <span>Class Date</span>
            <input className="rso-input" type="date" value={classDate} onChange={(e) => setClassDate(e.target.value)} />
          </label>
          {selectedClass && (
            <div className="rso-tp-caption-tight">
              <Button variant="ghost" size="sm" onClick={showHistory}>
                {history ? 'Hide History' : 'View Session History'}
              </Button>
            </div>
          )}
          {history && (
            <div className="rso-tp-history">
              {history.map((h, i) => (
                <div key={i} className="rso-tp-history-row">
                  <span>{h.date} — {h.session}</span>
                  <span className="rso-tp-ok">✓ {h.present}</span>
                  <span className="rso-tp-bad">✗ {h.absent}</span>
                </div>
              ))}
            </div>
          )}
          {alreadySubmitted && (
            <div className="rso-tp-warning">
              ⚠️ Attendance has already been submitted for this session.
            </div>
          )}
          <div className="rso-tp-actions">
            <Button variant="ghost" onClick={() => setStep('action')}>Back</Button>
            <Button variant="primary" disabled={sessions.length === 0} onClick={loadRosterData}>Load Roster</Button>
          </div>
        </div>
      )}

      {/* Step 5 — Attendance */}
      {step === 'attendance' && !loading && (
        <div>
          <div className="rso-tp-caption">
            {selectedTeacher?.fullName} · {selectedClass?.classOptionId} · {sessions.join(' + ')} · {classDate}
          </div>
          <div className="rso-tp-row rso-tp-tools">
            <Button variant="success" size="sm" onClick={() => { const a = {}; roster.forEach((r) => a[r.id] = true); setAttendance(a); }}>All Present</Button>
            <Button variant="danger" size="sm" onClick={() => setAttendance({})}>All Absent</Button>
            <div className="rso-tp-row-grow">
              <SearchInput value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} placeholder="Search roster…" />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAddModalOpen(true)}>+ Add Person</Button>
          </div>
          <div className="rso-tp-stack-xs">
            {filteredRoster.map((r) => (
              <button key={r.id} type="button" className="rso-card rso-tp-row-btn"
                aria-pressed={!!attendance[r.id]}
                data-present={!!attendance[r.id]}
                onClick={() => setAttendance((a) => ({ ...a, [r.id]: !a[r.id] }))}>
                <span className="rso-tp-name-row">
                  <span className="rso-tp-name">{r.fullName}</span>
                  {r.isGuest
                    ? <Badge variant="neutral">Guest</Badge>
                    : <span className="rso-tp-meta">{r.personType}</span>}
                </span>
                <Badge variant={attendance[r.id] ? 'success' : 'danger'}>{attendance[r.id] ? 'Present' : 'Absent'}</Badge>
              </button>
            ))}
          </div>
          <div className="rso-tp-tally">
            <span className="rso-tp-ok">Present: {present}</span>
            <span className="rso-tp-bad">Absent: {absent}</span>
            <span className="rso-tp-total">Total: {roster.length}</span>
          </div>
          <div className="rso-tp-actions">
            <Button variant="ghost" onClick={() => setStep('session')}>Back</Button>
            <Button variant="primary" onClick={() => setStep('review')}>Review →</Button>
          </div>
        </div>
      )}

      {/* Review */}
      {step === 'review' && !loading && (
        <div>
          <h2 className="rso-tp-heading">Review & Submit</h2>
          <div className="rso-card rso-tp-review">
            <p><strong>Class:</strong> {selectedClass?.classOptionId}</p>
            <p><strong>Session:</strong> {sessions.join(' + ')}</p>
            <p><strong>Date:</strong> {classDate}</p>
            <p className="rso-tp-review-totals">
              <span className="rso-tp-ok">Present: {present}</span> ·{' '}
              <span className="rso-tp-bad">Absent: {absent}</span> ·{' '}
              <span className="rso-tp-name">Total: {roster.length}</span>
            </p>
          </div>
          <div className="rso-tp-actions">
            <Button variant="ghost" onClick={() => setStep('attendance')}>Back</Button>
            {!ATTENDANCE_SUBMIT_CERTIFIED && <p role="status" style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{ATTENDANCE_SUBMIT_HOLD_MESSAGE}</p>}
            <Button variant="primary" onClick={handleSubmit} disabled={loading || !ATTENDANCE_SUBMIT_CERTIFIED}>Submit</Button>
          </div>
        </div>
      )}

      {/* Saved: the server confirmed the attendance. Outcome questions load from here. */}
      {step === 'saved' && (
        <div>
          <h2 className="rso-tp-heading">Attendance saved</h2>
          <p className="rso-tp-caption">
            {selectedClass?.classOptionId} · {sessions.join(' + ')} · {classDate} — Present: {present}, Absent: {absent}
          </p>
          {outcomesLoading ? (
            <Skeleton variant="rows" rows={2} />
          ) : milestoneError ? (
            <>
              <div className="rso-tp-warning" role="status">
                Attendance is saved. The outcome questions could not be loaded: {milestoneError}
              </div>
              <div className="rso-tp-actions">
                <Button variant="ghost" onClick={resetToClassSelect}>Done</Button>
                <Button variant="primary" onClick={loadOutcomes}>Retry loading outcomes</Button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Outcomes */}
      {step === 'outcomes' && !loading && (
        <div>
          <h2 className="rso-tp-heading">Session Outcomes</h2>
          <p className="rso-tp-caption">Mark milestone outcomes for present students.</p>
          {roster.filter((r) => attendance[r.id]).map((person) => (
            <div key={person.id} className="rso-card rso-tp-outcome-card">
              <div className="rso-tp-outcome-name">{person.fullName}</div>
              {milestones.map((m) => (
                <div key={m.milestoneId} className="rso-tp-outcome-row">
                  <span className="rso-tp-outcome-q">{m.question}</span>
                  <select className="rso-select rso-tp-outcome-select"
                    aria-label={`${person.fullName}: ${m.question}`}
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
          <div className="rso-tp-actions">
            <Button variant="ghost" onClick={() => handleOutcomes(false)} disabled={!ATTENDANCE_SUBMIT_CERTIFIED}>Skip / Flag Follow-up</Button>
            <Button variant="primary" onClick={() => handleOutcomes(true)} disabled={!ATTENDANCE_SUBMIT_CERTIFIED}>Submit Outcomes</Button>
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
  const [tab, setTab] = useState('search'); // 'search' | 'guest'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  async function doSearch() {
    if (!query || query.length < 2) return;
    setSearching(true);
    try {
      const r = await searchPerson(query, classOptionId, teacherId, sessions);
      setResults(r);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSearching(false); }
  }

  return (
    <Modal title="Add Person" open onClose={onClose}>
      <div className="rso-tp-modal-tabs">
        <button type="button" className="rso-tp-toggle rso-tp-toggle-sm" aria-pressed={tab === 'search'}
          onClick={() => setTab('search')}>Search Roster</button>
        <button type="button" className="rso-tp-toggle rso-tp-toggle-sm" aria-pressed={tab === 'guest'}
          onClick={() => setTab('guest')}>Guest (visiting)</button>
      </div>

      {tab === 'search' && (
        <>
          <div className="rso-tp-row rso-tp-search-row">
            <input className="rso-input rso-tp-row-grow" aria-label="Search roster" placeholder="Search by name or email…" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
            <Button variant="primary" size="sm" onClick={doSearch} disabled={searching}>Search</Button>
          </div>
          <div className="rso-tp-stack-tight">
            {results.map((r) => (
              <button key={r.id} type="button" className="rso-card rso-tp-row-btn rso-tp-row-btn-plain rso-tp-result"
                onClick={() => onAdd({ ...r, source: 'Search' })}>
                <span className="rso-tp-name">{r.fullName}</span>
                <span className="rso-tp-meta-inline">{r.email} · {r.personType}</span>
              </button>
            ))}
          </div>
          {results.length === 0 && query.length >= 2 && !searching && (
            <p className="rso-tp-no-match">
              No roster match. Use "Guest" tab to record a visiting student's attendance.
            </p>
          )}
        </>
      )}

      {tab === 'guest' && (
        <div className="rso-tp-modal-stack">
          <p className="rso-tp-caption">
            Record that a visiting student attended. Only their name is saved — no account details.
          </p>
          <input className="rso-input" aria-label="Guest full name" placeholder="Full Name *" value={guestName}
            onChange={(e) => setGuestName(e.target.value)} />
          <input className="rso-input" aria-label="Guest phone" placeholder="Phone (optional)" value={guestPhone}
            onChange={(e) => setGuestPhone(e.target.value)} />
          <Button variant="primary" size="sm" disabled={!guestName.trim()} onClick={() => onAdd({
            id: `GUEST-${Date.now()}`,
            fullName: guestName.trim(),
            phone: guestPhone.trim(),
            isGuest: true,
            personType: 'Guest',
            source: 'Guest',
          })}>Mark as Present</Button>
        </div>
      )}
    </Modal>
  );
}
