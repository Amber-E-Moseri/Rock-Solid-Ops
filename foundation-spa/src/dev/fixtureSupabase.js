// SYNTHETIC FIXTURE CLIENT — development preview only.
//
// Substitutes for src/supabase.js in `vite` dev servers started with
// VITE_PREVIEW_FIXTURES=true (see vite.config.js). It never talks to a network
// endpoint and it refuses every write. All rows are generated below and are
// labelled as synthetic (example.invalid addresses, "Synthetic" names).
//
// URL switch for previewing states: ?fixture=populated (default) | empty | error | loading

if (!import.meta.env.DEV) {
  throw new Error('Synthetic fixture client is development-only and cannot load in a production build.');
}

const SCENARIO = (() => {
  try {
    const value = new URLSearchParams(window.location.search).get('fixture');
    return ['empty', 'error', 'loading'].includes(value) ? value : 'populated';
  } catch {
    return 'populated';
  }
})();

const WRITE_ERROR = { message: 'Synthetic fixture: writes are disabled in preview mode.', code: 'FIXTURE_READ_ONLY' };

function synth(count, make) {
  return Array.from({ length: count }, (_, i) => make(i + 1));
}

// Synthetic conversations for the Messages preview. Sender id 'dev-bypass' is the dev identity.
const SYNTHETIC_CONVERSATIONS = [
  { id: 'syn-conv-1', subject: 'Synthetic class swap', scope: 'INDIVIDUAL', unread_count: 2, updated_at: new Date(Date.UTC(2026, 9, 22, 6, 12)).toISOString(), latest_message: { body: 'Synthetic: can the Thursday class move to 8:30 PM?' } },
  { id: 'syn-conv-2', subject: 'Synthetic attendance reminder', scope: 'GROUP', unread_count: 0, updated_at: new Date(Date.UTC(2026, 9, 20, 9, 0)).toISOString(), latest_message: { body: 'Synthetic: please submit this week’s sessions.' } },
  { id: 'syn-conv-3', subject: 'Synthetic onboarding note', scope: 'INDIVIDUAL', unread_count: 0, updated_at: new Date(Date.UTC(2026, 9, 18, 15, 30)).toISOString(), latest_message: null },
];
const SYNTHETIC_MESSAGES = {
  'syn-conv-1': [
    { id: 'm1', sender_user_id: 'syn-user-2', sender_name: 'Synthetic Teacher 2', sender_role: 'teacher', body: 'Synthetic: can I move Thursday’s class to 8:30 PM?', created_at: new Date(Date.UTC(2026, 9, 22, 6, 10)).toISOString() },
    { id: 'm2', sender_user_id: 'dev-bypass', sender_name: 'Dev Bypass', sender_role: 'admin', body: 'Synthetic: approved — I will update the class editor.', created_at: new Date(Date.UTC(2026, 9, 22, 6, 12)).toISOString() },
  ],
  'syn-conv-2': [
    { id: 'm3', sender_user_id: 'dev-bypass', sender_name: 'Dev Bypass', sender_role: 'admin', body: 'Synthetic: please submit this week’s sessions.', created_at: new Date(Date.UTC(2026, 9, 20, 9, 0)).toISOString() },
  ],
};

// Synthetic class options for the Teacher Home preview.
const TEACHER_CLASSES = [
  { class_option_id: 'syn-class-1', class_name: 'Synthetic Foundation Class A', day: 'Tuesday', class_time: '7:00 PM', fellowship_codes: ['UMANITOBA'], current_enrollment: 18, active: true },
  { class_option_id: 'syn-class-2', class_name: 'Synthetic Foundation Class B', day: 'Thursday', class_time: '8:00 PM', fellowship_codes: ['UWATERLOO'], current_enrollment: 14, active: true },
  { class_option_id: 'syn-class-3', class_name: 'Synthetic Maturity Class', day: 'Saturday', class_time: '10:00 AM', fellowship_codes: ['UCALGARY'], current_enrollment: 11, active: false },
];

// Time inputs need HH:MM; the teacher-portal labels above use 12-hour text.
const to24h = (t) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t));
  if (!m) return t;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};
// Table rows. Each page's queries read only the columns it needs; extend here per screen.
const TABLES = {
  applicants: () => synth(142, (i) => ({
    id: i,
    full_name: `Synthetic Applicant ${String(i).padStart(3, '0')}`,
    email: `applicant${i}@example.invalid`,
    status: i % 7 === 0 ? 'Pending' : i % 5 === 0 ? 'Waitlisted' : 'Assigned',
    created_at: new Date(Date.UTC(2026, 9, 1 + (i % 20))).toISOString(),
  })),
  batches: () => synth(4, (i) => ({
    batch_id: i,
    name: `Synthetic Batch ${i}`,
    status: i <= 2 ? 'Active' : 'Draft',
  })),
  teachers: () => synth(6, (i) => ({
    teacher_id: i,
    full_name: `Synthetic Teacher ${i}`,
    // Teacher 1 is the synthetic identity used by the dev role bypass (dev@localhost).
    email: i === 1 ? 'dev@localhost' : `teacher${i}@example.invalid`,
    status: i <= 4 ? 'Active' : 'Pending',
  })),
  audit_logs: () => [
    { actor_name: 'Synthetic Admin', action: 'approve_teacher', entity_type: 'teacher', created_at: new Date(Date.UTC(2026, 9, 21, 14, 5)).toISOString() },
    { actor_name: 'system', action: 'retry_sync', entity_type: 'moodle_sync', created_at: new Date(Date.UTC(2026, 9, 21, 9, 40)).toISOString() },
    { actor_name: 'Synthetic Admin', action: 'suspend_teacher', entity_type: 'teacher', created_at: new Date(Date.UTC(2026, 9, 20, 17, 12)).toISOString() },
  ],
  moodle_sync: () => synth(3, (i) => ({ id: i, status: 'failed' })),
  // Makeup rows: synthetic students; deadlines chosen so pending, overdue and done all show.
  makeup_queue: () => {
    const student = (i, name, sub) => ({ full_name: name, email: `student${i}@example.invalid`, fellowship_code: 'UMANITOBA', subgroup_id: sub });
    const day = 86400000;
    const now = Date.now();
    return [
      { id: 1, student_id: 301, batch_id: 1, class_missed: 'Synthetic Class A', makeup_type: 'Session', deadline: new Date(now + 9 * day).toISOString(), makeup_completed: false, completed_at: null, created_at: new Date(now - 3 * day).toISOString(), students: student(301, 'Synthetic Student 301', 'CESGA') },
      { id: 2, student_id: 302, batch_id: 1, class_missed: 'Synthetic Class B', makeup_type: 'Video', deadline: new Date(now + 4 * day).toISOString(), makeup_completed: false, completed_at: null, created_at: new Date(now - 6 * day).toISOString(), students: student(302, 'Synthetic Student 302', 'CSGB') },
      { id: 3, student_id: 303, batch_id: 1, class_missed: 'Synthetic Class A', makeup_type: 'Session', deadline: new Date(now - 2 * day).toISOString(), makeup_completed: false, completed_at: null, created_at: new Date(now - 14 * day).toISOString(), students: student(303, 'Synthetic Student 303', 'CESGA') },
      { id: 4, student_id: 304, batch_id: 1, class_missed: 'Synthetic Class C', makeup_type: 'Session', deadline: new Date(now - 5 * day).toISOString(), makeup_completed: false, completed_at: null, created_at: new Date(now - 20 * day).toISOString(), students: student(304, 'Synthetic Student 304', 'WSGA') },
      { id: 5, student_id: 305, batch_id: 1, class_missed: 'Synthetic Class B', makeup_type: 'Video', deadline: new Date(now + 7 * day).toISOString(), makeup_completed: true, completed_at: new Date(now - 1 * day).toISOString(), created_at: new Date(now - 10 * day).toISOString(), students: student(305, 'Synthetic Student 305', 'CSGB') },
    ];
  },
  attention_flags: () => [],
  moodle_enrollment_sync: () => [
    ...synth(18, () => ({ sync_status: 'SYNCED', synced_at: new Date(Date.UTC(2026, 9, 21, 12, 0)).toISOString(), updated_at: new Date(Date.UTC(2026, 9, 21, 12, 0)).toISOString() })),
    ...synth(3, () => ({ sync_status: 'PENDING', synced_at: null, updated_at: null })),
    ...synth(2, () => ({ sync_status: 'FAILED', synced_at: null, updated_at: null })),
    ...synth(1, () => ({ sync_status: 'PROCESSING', synced_at: null, updated_at: null })),
  ],
  duplicate_registration_groups: () => [
    { id: 1, status: 'unresolved', created_at: new Date(Date.UTC(2026, 9, 20)).toISOString(), batch_id: 1 },
    { id: 2, status: 'unresolved', created_at: new Date(Date.UTC(2026, 9, 18)).toISOString(), batch_id: 1 },
  ],
  // Richer rows for the Class Editor preview; the dashboard reads the same ids.
  class_options: () => TEACHER_CLASSES.map((c) => ({
    class_option_id: c.class_option_id,
    class_name: c.class_name,
    day: c.day,
    class_time: to24h(c.class_time),
    teacher_name: 'Synthetic Teacher 1',
    teacher_id: 1,
    max_capacity: 25,
    active: c.active,
    enrollment_open: true,
    fellowship_codes: c.fellowship_codes,
    group_id: 'SYNTHETIC-GROUP',
    label_suffix: null,
    is_online: false,
    enrollment_closes_at: null,
    deleted_at: null,
  })),
  email_queue: () => synth(12, (i) => ({ id: i, status: 'Pending' })),
};

// Synthetic RPC results for the Operational Dashboard preview. Shapes mirror the
// fields read in features/dashboards/lib/dashboard.js. Every value is invented.
const RPC_FIXTURES = {
  get_registration_summary: () => [
    { reg_status: 'ASSIGNED', cnt: 89 },
    { reg_status: 'WAITLISTED', cnt: 23 },
    { reg_status: 'REVIEW', cnt: 30 },
    { reg_status: 'DUPLICATE', cnt: 4 },
  ],
  get_fellowship_breakdown: () => [
    { fellowship: 'UMANITOBA', cnt: 41 },
    { fellowship: 'UWATERLOO', cnt: 33 },
    { fellowship: 'UCALGARY', cnt: 22 },
    { fellowship: 'UBC', cnt: 15 },
  ],
  get_registrations_by_week: () => synth(12, (i) => ({
    week_start: new Date(Date.UTC(2026, 7, 3 + (i - 1) * 7)).toISOString().slice(0, 10),
    cnt: 6 + ((i * 7) % 11),
  })),
  get_capacity_summary: () => [
    { class_option_id: 'syn-class-1', day: 'Tuesday', class_time: '7:00 PM', fellowship: 'UMANITOBA', enrolled_count: 18, max_capacity: 20 },
    { class_option_id: 'syn-class-2', day: 'Thursday', class_time: '8:00 PM', fellowship: 'UWATERLOO', enrolled_count: 14, max_capacity: 20 },
    { class_option_id: 'syn-class-3', day: 'Saturday', class_time: '10:00 AM', fellowship: 'UCALGARY', enrolled_count: 11, max_capacity: 12 },
  ],
  get_stale_queue_items: () => [{ cnt: 3 }],
  get_attendance_health: () => [{
    submission_rate_pct: 72.4,
    total_submitted_records: 118,
    total_expected_sessions: 163,
    classes_zero_submissions: 1,
    classes_missing_2w: 2,
    missing_classes: [
      { teacher_name: 'Synthetic Teacher 2', class_label: 'Thursday 8:00 PM — UWATERLOO', last_submitted: new Date(Date.UTC(2026, 9, 10)).toISOString(), sessions_missing: 3 },
      { teacher_name: 'Synthetic Teacher 3', class_label: 'Saturday 10:00 AM — UCALGARY', last_submitted: null, sessions_missing: 4 },
    ],
    calculated_at: new Date(Date.UTC(2026, 9, 22, 8, 0)).toISOString(),
  }],
  get_milestone_summary: () => [{
    total_active_students: 142,
    students_all_complete: 38,
    students_zero_complete: 17,
    avg_completion_pct: 46.5,
    milestones_breakdown: [
      { milestone_name: 'Foundation class', completion_pct: 81.0 },
      { milestone_name: 'Water baptism', completion_pct: 64.2 },
      { milestone_name: 'Cell placement', completion_pct: 37.9 },
      { milestone_name: 'Maturity class', completion_pct: 18.3 },
    ],
    calculated_at: new Date(Date.UTC(2026, 9, 22, 8, 0)).toISOString(),
  }],
  get_registration_funnel: () => [{ registered_count: 142, reviewed_count: 112, assigned_count: 89, waitlisted_count: 23, duplicate_count: 4 }],
  get_active_certified_teachers_count: () => [{ count: 6 }],
  get_currently_teaching_count: () => [{ count: 4 }],
  get_escalation_details: () => [],
  get_student_attention_flags: () => [
    { flag_type: 'inactive_no_attendance', applicant_id: 201, full_name: 'Synthetic Student 201', email: 'student201@example.invalid', fellowship_code: 'UMANITOBA', teacher_name: 'Synthetic Teacher 1', detail: 'No attendance in 14 days', severity: 'critical' },
    { flag_type: 'repeat_absence_3_plus', applicant_id: 202, full_name: 'Synthetic Student 202', email: 'student202@example.invalid', fellowship_code: 'UWATERLOO', teacher_name: 'Synthetic Teacher 2', detail: 'Three consecutive absences', severity: 'critical' },
    { flag_type: 'moodle_synced_no_login', applicant_id: 203, full_name: 'Synthetic Student 203', email: 'student203@example.invalid', fellowship_code: 'UCALGARY', teacher_name: 'Synthetic Teacher 3', detail: 'Synced to Moodle but never signed in', severity: 'warning' },
  ],
  get_teacher_attention_flags: () => [
    { flag_type: 'missing_attendance', teacher_id: 2, full_name: 'Synthetic Teacher 2', email: 'teacher2@example.invalid', class_count: 2, detail: 'Two sessions without attendance', severity: 'warning' },
    { flag_type: 'missing_attendance', teacher_id: 3, full_name: 'Synthetic Teacher 3', email: 'teacher3@example.invalid', class_count: 1, detail: 'Session overdue by one week', severity: 'critical' },
  ],
  get_system_attention_flags: () => [
    { flag_type: 'moodle_sync_failed', count: 3, detail: 'Moodle enrollment sync failures', severity: 'critical' },
    { flag_type: 'email_queue_backlog', count: 12, detail: 'Emails waiting in the queue', severity: 'warning' },
  ],
};

// Scenario overrides: "empty" returns no rows everywhere; "error" fails every read.
function rowsFor(table) {
  if (SCENARIO === 'empty') return [];
  const make = TABLES[table];
  return make ? make() : [];
}

// Applies the equality, inequality and membership filters the pages use. Anything
// else is ignored, which is acceptable for a visual preview and is noted in docs.
function applyFilters(rows, filters) {
  return filters.reduce((acc, f) => {
    switch (f.op) {
      case 'eq': return acc.filter((r) => r[f.col] === f.val);
      case 'neq': return acc.filter((r) => r[f.col] !== f.val);
      case 'in': return acc.filter((r) => f.val.includes(r[f.col]));
      case 'not_in': return acc.filter((r) => !f.val.includes(r[f.col]));
      default: return acc;
    }
  }, rows);
}

function parseList(raw) {
  return String(raw).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
}

function query(table) {
  const state = { filters: [], single: false, head: false, limit: null, error: null, mode: 'read' };

  const resolve = () => {
    if (state.mode !== 'read') return { data: null, error: WRITE_ERROR, count: null };
    if (SCENARIO === 'error') {
      return { data: null, error: { message: 'Synthetic fixture: simulated read failure.', code: 'FIXTURE_ERROR' }, count: null };
    }
    let rows = applyFilters(rowsFor(table), state.filters);
    const count = rows.length;
    if (state.limit != null) rows = rows.slice(0, state.limit);
    if (state.head) return { data: null, error: null, count };
    if (state.single) {
      return rows.length ? { data: rows[0], error: null, count } : { data: null, error: { message: 'No rows (synthetic)', code: 'PGRST116' }, count };
    }
    return { data: rows, error: null, count };
  };

  if (SCENARIO === 'loading') {
    // Never settles, so pages show their loading state.
    const pending = new Promise(() => {});
    const builder = new Proxy({}, { get: (_, prop) => (prop === 'then' ? pending.then.bind(pending) : () => builder) });
    return builder;
  }

  const builder = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (onFulfilled, onRejected) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
      if (prop === 'catch') return (fn) => Promise.resolve(resolve()).catch(fn);
      if (prop === 'finally') return (fn) => Promise.resolve(resolve()).finally(fn);
      switch (prop) {
        case 'eq': return (col, val) => { state.filters.push({ op: 'eq', col, val }); return builder; };
        case 'neq': return (col, val) => { state.filters.push({ op: 'neq', col, val }); return builder; };
        case 'in': return (col, vals) => { state.filters.push({ op: 'in', col, val: vals }); return builder; };
        case 'not': return (col, op, raw) => {
          if (op === 'in') state.filters.push({ op: 'not_in', col, val: parseList(raw) });
          return builder;
        };
        case 'limit': return (n) => { state.limit = n; return builder; };
        case 'single':
        case 'maybeSingle': return () => { state.single = true; return builder; };
        case 'select': return (_cols, opts) => { if (opts?.head) state.head = true; return builder; };
        case 'insert':
        case 'update':
        case 'upsert':
        case 'delete': return () => { state.mode = 'write'; return builder; };
        default: return () => builder; // order, range, gte, lte, is, ilike, or, match, etc.
      }
    },
  });
  return builder;
}

// Minimal stand-in for the Supabase client surface the app touches.
const noopResult = () => Promise.resolve({ data: null, error: null });
const authSession = { session: null, user: null };

export const supabase = {
  from: (table) => query(table),
  rpc: (name) => {
    const result = (() => {
      if (SCENARIO === 'error') return { data: null, error: { message: 'Synthetic fixture: simulated RPC failure.', code: 'FIXTURE_ERROR' } };
      if (SCENARIO === 'empty') return { data: [], error: null };
      const make = RPC_FIXTURES[name];
      return make ? { data: make(), error: null } : { data: null, error: { message: 'Synthetic fixture: no RPC fixture for ' + name + '.' } };
    })();
    return { then: (fn, err) => Promise.resolve(result).then(fn, err) };
  },
  auth: {
    getSession: async () => ({ data: authSession, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: null, error: WRITE_ERROR }),
    signOut: noopResult,
    resetPasswordForEmail: async () => ({ data: null, error: WRITE_ERROR }),
    updateUser: async () => ({ data: null, error: WRITE_ERROR }),
    exchangeCodeForSession: async () => ({ data: null, error: WRITE_ERROR }),
  },
  functions: {
    // Read-only fixtures for the edge functions previewed pages call. Anything else
    // reports that no fixture exists rather than pretending to succeed.
    invoke: async (functionName, { body } = {}) => {
      if (functionName === 'teacher-portal-api' && body?.action === 'getTeacherActiveClassOptions') {
        if (SCENARIO === 'empty') return { data: [], error: null };
        if (SCENARIO === 'error') return { data: null, error: { message: 'Synthetic fixture: simulated function failure.' } };
        return { data: TEACHER_CLASSES, error: null };
      }
      if (functionName === 'messaging-api') {
        if (SCENARIO === 'empty') return { data: { ok: true, data: [] }, error: null };
        if (SCENARIO === 'error') return { data: null, error: { message: 'Synthetic fixture: simulated messaging failure.' } };
        const action = body?.action;
        if (action === 'listConversations') return { data: { ok: true, data: SYNTHETIC_CONVERSATIONS }, error: null };
        if (action === 'listMessages') {
          const conv = body?.params?.conversationId;
          return { data: { ok: true, data: { messages: SYNTHETIC_MESSAGES[String(conv)] || [] } }, error: null };
        }
        if (action === 'getRecipientOptions') return { data: { ok: true, data: { recipients: [] } }, error: null };
        if (action === 'markRead') return { data: { ok: true, data: {} }, error: null };
        return { data: { ok: false, error: 'Synthetic fixture: messaging writes are disabled in preview mode.' }, error: null };
      }
      return { data: null, error: { message: 'Synthetic fixture: no preview fixture for ' + functionName + '.' } };
    },
  },
  storage: { from: () => ({ upload: async () => ({ data: null, error: WRITE_ERROR }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: noopResult,
};

// Visible marker so synthetic previews cannot be mistaken for live data.
try {
  const banner = document.createElement('div');
  banner.setAttribute('data-synthetic-fixtures', 'true');
  banner.textContent = `SYNTHETIC FIXTURE DATA · ${SCENARIO.toUpperCase()} · NOT LIVE`;
  banner.style.cssText = 'position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:9999;background:#F4BE41;color:#171327;font:700 11px/1 Manrope,sans-serif;letter-spacing:.06em;padding:6px 10px;border-radius:999px;box-shadow:0 2px 8px rgba(23,19,39,.2);pointer-events:none;';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));
  if (document.readyState !== 'loading') document.body.appendChild(banner);
} catch {
  // Non-DOM environments (tests) simply skip the banner.
}
