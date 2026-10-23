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

// Synthetic class options for the Teacher Home preview.
const TEACHER_CLASSES = [
  { class_option_id: 'syn-class-1', class_name: 'Synthetic Foundation Class A', day: 'Tuesday', class_time: '7:00 PM', fellowship_codes: ['UMANITOBA'], current_enrollment: 18, active: true },
  { class_option_id: 'syn-class-2', class_name: 'Synthetic Foundation Class B', day: 'Thursday', class_time: '8:00 PM', fellowship_codes: ['UWATERLOO'], current_enrollment: 14, active: true },
  { class_option_id: 'syn-class-3', class_name: 'Synthetic Maturity Class', day: 'Saturday', class_time: '10:00 AM', fellowship_codes: ['UCALGARY'], current_enrollment: 11, active: false },
];

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
  class_options: () => TEACHER_CLASSES.map((c) => ({ class_option_id: c.class_option_id, teacher_name: 'Synthetic Teacher 1' })),
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
