import { supabase } from '../../../supabase.js';

// ── Constants (mirror applicant-directory.js) ────────────────────────────────

export const FALLBACK_MILESTONE_DEFS = [
  { code: 'BORN_AGAIN', label: 'Born Again' },
  { code: 'FILLED_WITH_SPIRIT', label: 'Filled with the Spirit' },
  { code: 'PARTNERSHIP', label: 'Partnership' },
  { code: 'JOINED_CELL', label: 'Joined Cell' },
  { code: 'SERVING_TEAM_INTEREST', label: 'Serving Team Interest' },
  { code: 'NEEDS_FOLLOW_UP', label: 'Needs Follow-up' },
  { code: 'FOUNDATION_COMPLETED', label: 'Foundation Completed' },
];

export const QUICK_TABS = [
  { id: 'all', label: 'All Applicants' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'at_risk', label: 'At Risk' },
  { id: 'waitlisted', label: 'Waitlisted' },
];

export const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'attention', label: 'Needs Attention' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'completed', label: 'Completed' },
];

export const DECISION_ROLES = ['admin', 'superadmin', 'principal', 'regional_secretary'];

const normCode = (v) => String(v || '').trim().toUpperCase();
export const classIdOf = (row) => String(row?.class_option_id || row?.id || '');
export const ymd = (v) => {
  if (!v) return '';
  try { return new Date(v).toISOString().slice(0, 10); } catch { return ''; }
};

// ── Data loading ─────────────────────────────────────────────────────────────

async function safeLoad(queryFn, fallback = [], label = '') {
  try {
    const result = await queryFn();
    return result ?? fallback;
  } catch (err) {
    console.error(`[safeLoad${label ? ' ' + label : ''}]`, err?.message || err);
    return fallback;
  }
}

// attendance_records is canonical (applicant-keyed); attendance_log is legacy fallback
async function loadAttendance() {
  const { data: rec, error: recErr } = await supabase
    .from('attendance_records')
    .select('applicant_id,class_option_id,batch_id,session_date,class_session,status,created_at')
    .order('created_at', { ascending: false })
    .limit(10000);
  if (!recErr && rec?.length) return rec;
  const { data: log } = await supabase
    .from('attendance_log')
    .select('student_id,class_option_id,batch_id,present,made_up,class_date,class_number,logged_at')
    .order('logged_at', { ascending: false })
    .limit(10000);
  return log || [];
}

// applicant_directory_summaries view — null when it doesn't exist so we fall back
async function loadSummaries() {
  try {
    const { data, error } = await supabase
      .from('applicant_directory_summaries')
      .select('applicant_id,total_sessions,attended_sessions,last_attendance_at,completed_milestones')
      .limit(5000);
    if (error) return null;
    return data || [];
  } catch {
    return null;
  }
}

export async function fetchDirectoryData() {
  const summaryRows = await loadSummaries();
  const useSummaries = Array.isArray(summaryRows);
  const [applicants, classOptions, batches, attendance, milestoneDefs, milestoneStatusRows, duplicateGroups, duplicateNotifications] = await Promise.all([
    safeLoad(async () => (await supabase.from('applicants').select('*').order('created_at', { ascending: false }).limit(3000)).data || [], [], 'applicants'),
    safeLoad(async () => (await supabase.from('class_options').select('*').limit(3000)).data || [], [], 'class_options'),
    safeLoad(async () => (await supabase.from('batches').select('batch_id,batch_name,start_sunday,status,active').limit(500)).data || [], [], 'batches'),
    useSummaries ? Promise.resolve([]) : safeLoad(loadAttendance, [], 'attendance'),
    safeLoad(async () => (await supabase.from('milestone_definitions').select('code,title,label,active').eq('active', true).order('sort_order', { ascending: true })).data || [], [], 'milestone_definitions'),
    useSummaries ? Promise.resolve([]) : safeLoad(async () => (await supabase.from('student_milestone_status').select('applicant_id,milestone_code,completed,updated_at').eq('completed', true).limit(20000)).data || [], [], 'student_milestone_status'),
    safeLoad(async () => (await supabase.from('duplicate_registration_groups').select('*').order('created_at', { ascending: false }).limit(1000)).data || [], [], 'duplicate_registration_groups'),
    safeLoad(async () => (await supabase.from('duplicate_notifications').select('*').order('created_at', { ascending: false }).limit(1000)).data || [], [], 'duplicate_notifications'),
  ]);

  const defs = (milestoneDefs || [])
    .map((m) => ({ code: normCode(m.code), label: String(m.label || m.title || m.code || '').trim() }))
    .filter((m) => m.code);

  return buildDirectoryModel({
    applicants,
    classOptions,
    batches,
    attendance,
    milestoneDefs: defs.length ? defs : FALLBACK_MILESTONE_DEFS,
    milestoneStatusRows: milestoneStatusRows || [],
    summaryRows: summaryRows || null,
    duplicateGroups: duplicateGroups || [],
    duplicateNotifications: duplicateNotifications || [],
  });
}

// Per-applicant drawer detail (lazy)
export async function fetchApplicantDetail(applicantId) {
  const [notifRows, emailRows, auditRows, moodleRows] = await Promise.all([
    supabase.from('notification_events').select('*').eq('applicant_id', applicantId).order('created_at', { ascending: false }).limit(50),
    supabase.from('email_queue').select('*').eq('student_id', applicantId).order('created_at', { ascending: false }).limit(50),
    supabase.from('audit_logs').select('*').eq('entity_id', applicantId).order('created_at', { ascending: false }).limit(50),
    supabase.from('moodle_sync').select('*').eq('applicant_id', applicantId).limit(20),
  ]);
  return {
    notifications: notifRows.data ?? [],
    emails: emailRows.data ?? [],
    audits: auditRows.data ?? [],
    moodle: moodleRows.data ?? [],
  };
}

// ── Model construction: indexes + caches, all precomputed once per load ──────

export function buildDirectoryModel(raw) {
  const model = { ...raw };

  // Summaries by applicant id
  model.applicantSummaries = new Map((raw.summaryRows || []).map((r) => [String(r.applicant_id), r]));

  // Milestones by applicant
  const milestonesByApplicant = new Map();
  if (model.applicantSummaries.size) {
    model.applicantSummaries.forEach((row, applicantId) => {
      const codes = (row.completed_milestones || []).map(normCode).filter(Boolean);
      if (codes.length) milestonesByApplicant.set(applicantId, new Set(codes));
    });
  } else {
    (raw.milestoneStatusRows || []).forEach((row) => {
      const applicantId = String(row.applicant_id || '').trim();
      const code = normCode(row.milestone_code);
      if (!applicantId || !code || row.completed !== true) return;
      if (!milestonesByApplicant.has(applicantId)) milestonesByApplicant.set(applicantId, new Set());
      milestonesByApplicant.get(applicantId).add(code);
    });
  }
  model.milestonesByApplicant = milestonesByApplicant;

  // Attendance index by id + email
  const byId = new Map();
  const byEmail = new Map();
  (raw.attendance || []).forEach((r, i) => {
    const rid = String(r.applicant_id || r.student_id || r.registration_id || '');
    const remail = String(r.email || r.student_email || '').toLowerCase();
    if (rid) { if (!byId.has(rid)) byId.set(rid, []); byId.get(rid).push([i, r]); }
    if (remail) { if (!byEmail.has(remail)) byEmail.set(remail, []); byEmail.get(remail).push([i, r]); }
  });
  model.attendanceIndex = { byId, byEmail };

  // Duplicate groups by id
  model.duplicatesByGroup = new Map((raw.duplicateGroups || []).map((g) => [String(g.id), g]));

  // Class options by id
  model.classById = new Map((raw.classOptions || []).map((c) => [classIdOf(c), c]));

  return model;
}

// ── Per-applicant computed helpers (all take the model) ─────────────────────

export const milestoneKeys = (model) => model.milestoneDefs.map((m) => normCode(m.code)).filter(Boolean);
export const milestoneLabels = (model) => {
  const out = {};
  model.milestoneDefs.forEach((m) => { out[normCode(m.code)] = m.label || m.code; });
  return out;
};
export const getApplicantMilestones = (model, app) => [...(model.milestonesByApplicant.get(String(app.id || '')) || new Set())];
export const getClassInfo = (model, id) => model.classById.get(String(id || '')) || null;

function getAttendanceRows(model, app) {
  const idRows = model.attendanceIndex.byId.get(String(app.id || '')) || [];
  const emailRows = model.attendanceIndex.byEmail.get(String(app.email || '').toLowerCase()) || [];
  if (!idRows.length && !emailRows.length) return [];
  if (!emailRows.length) return idRows.map(([, r]) => r);
  if (!idRows.length) return emailRows.map(([, r]) => r);
  const merged = new Map();
  idRows.forEach(([i, r]) => merged.set(i, r));
  emailRows.forEach(([i, r]) => merged.set(i, r));
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

export function getAttendanceSummary(model, app) {
  const agg = model.applicantSummaries.get(String(app.id || ''));
  if (agg) {
    const total = Number(agg.total_sessions || 0);
    const attended = Number(agg.attended_sessions || 0);
    if (!total) return { pct: null, attended: 0, total: 0, last: agg.last_attendance_at || null, missing: 0 };
    return { pct: Math.round((attended / total) * 100), attended, total, last: agg.last_attendance_at || null, missing: Math.max(0, total - attended) };
  }
  const rows = getAttendanceRows(model, app);
  if (!rows.length) return { pct: null, attended: 0, total: 0, last: null, missing: 0 };
  const attended = rows.filter((r) => r.present === true || String(r.present).toLowerCase() === 'yes' || String(r.status).toLowerCase() === 'present').length;
  const total = rows.length;
  const last = rows.map((r) => r.created_at || r.date || r.session_date || r.class_date || r.logged_at).filter(Boolean).sort().at(-1) || null;
  return { pct: total ? Math.round((attended / total) * 100) : 0, attended, total, last, missing: Math.max(0, total - attended) };
}

export function summarizeApplicant(model, app, cache) {
  const key = String(app.id || '');
  if (cache && key && cache.has(key)) return cache.get(key);
  const milestones = getApplicantMilestones(model, app);
  const attendance = getAttendanceSummary(model, app);
  const totalKeys = milestoneKeys(model).length;
  const summary = {
    milestoneCount: milestones.length,
    attendancePct: attendance.pct,
    attendance,
    completed: milestones.length >= totalKeys && totalKeys > 0,
    needsFollowUp: Boolean(app.needs_follow_up || app.needs_admin_review),
    duplicate: Number(app.duplicate_count || 0) > 1,
    lastActivity: [app.updated_at, app.created_at, attendance.last].filter(Boolean).sort().at(-1) || null,
  };
  if (cache && key) cache.set(key, summary);
  return summary;
}

export function classifyRowStatus(app, summary) {
  if (summary.duplicate) return { label: 'Duplicate', cls: 'duplicate' };
  if (summary.needsFollowUp) return { label: 'Needs Attention', cls: 'attention' };
  if (summary.completed) return { label: 'Completed', cls: 'completed' };
  if (app.class_option_id) return { label: 'Assigned', cls: 'assigned' };
  return { label: 'Unassigned', cls: 'unassigned' };
}

export function milestoneStatus(model, summary) {
  const total = milestoneKeys(model).length;
  const done = Number(summary?.milestoneCount || 0);
  if (done <= 0) return { label: 'Not Started', cls: 'unassigned', counter: `0/${total}` };
  if (done >= total) return { label: 'Complete', cls: 'completed', counter: `${total}/${total}` };
  return { label: 'In Progress', cls: 'assigned', counter: `${done}/${total}` };
}

export function getDuplicateBadgeMeta(model, app) {
  const duplicateStatus = String(app?.duplicate_status || 'UNIQUE').toUpperCase();
  const group = app.duplicate_group_id ? model.duplicatesByGroup.get(String(app.duplicate_group_id)) || null : null;
  const groupStatus = String(group?.status || '').toLowerCase();
  const groupMembers = app.duplicate_group_id
    ? model.applicants.filter((a) => String(a.duplicate_group_id) === String(app.duplicate_group_id)).length
    : 0;
  const groupCount = Number(group?.duplicate_count || 0) || groupMembers;
  const unresolved = duplicateStatus === 'CONFIRMED' && groupStatus !== 'resolved';
  const resolved = duplicateStatus === 'RESOLVED' || groupStatus === 'resolved';
  if (duplicateStatus === 'UNIQUE' && !group) {
    return { pillClass: 'unassigned', label: '—', meta: '', showWarning: false, groupId: '' };
  }
  return {
    pillClass: resolved ? 'completed' : unresolved ? 'duplicate' : 'attention',
    label: resolved ? 'Resolved' : duplicateStatus,
    meta: groupCount > 0 ? `${groupCount} in group` : 'Duplicate group',
    showWarning: unresolved,
    groupId: group?.id ? String(group.id) : '',
  };
}

// ── Filtering (mirrors applicant-directory-filters.js) ───────────────────────

export function filterApplicants(model, { quickTab, mode, filters, advFilters }, cache) {
  const f = filters;
  return model.applicants.filter((app) => {
    const qt = quickTab || 'all';
    if (qt === 'needs_review' && !app.needs_admin_review) return false;
    if (qt === 'at_risk') {
      const att = getAttendanceSummary(model, app);
      if (att.pct == null || att.pct >= 75) return false;
    }
    if (qt === 'waitlisted') {
      if (String(app.registration_status || app.status || '').toUpperCase() !== 'WAITLISTED') return false;
    }

    if (mode === 'review') {
      const regStatus = String(app.registration_status || app.status || '').toUpperCase();
      const needsReview = Boolean(app.needs_admin_review || app.retry_assignment || app.review_required);
      const inQueue = regStatus === 'REVIEW' || regStatus === 'PENDING' || needsReview || (!app.class_option_id && regStatus !== 'DUPLICATE' && regStatus !== 'INACTIVE');
      if (!inQueue) return false;
    }

    const summary = summarizeApplicant(model, app, cache);
    const fellowship = String(app.fellowship_code || app.fellowship || app.subgroup_id || '');
    const batch = String(app.batch_id || getClassInfo(model, app.class_option_id)?.batch_id || '');

    const q = (f.search || '').trim().toLowerCase();
    if (q) {
      const pool = [app.full_name, app.email, app.phone, app.phone_number].map((v) => String(v || '').toLowerCase()).join(' ');
      if (!pool.includes(q)) return false;
    }
    if (f.fellowship && fellowship !== f.fellowship) return false;
    if (f.subgroup && String(app.subgroup_id || '') !== String(f.subgroup)) return false;
    if (f.classOption && String(app.class_option_id || '') !== String(f.classOption)) return false;
    if (f.batch && batch !== String(f.batch)) return false;
    if (f.assignment === 'assigned' && !app.class_option_id) return false;
    if (f.assignment === 'unassigned' && app.class_option_id) return false;

    const duplicateStatus = String(app.duplicate_status || 'UNIQUE').toUpperCase();
    const group = app.duplicate_group_id ? model.duplicatesByGroup.get(String(app.duplicate_group_id)) : null;
    const groupStatus = String(group?.status || '').toLowerCase();
    if (f.duplicate === 'duplicate_only' && duplicateStatus === 'UNIQUE' && !app.duplicate_group_id) return false;
    if (f.duplicate === 'unresolved_only' && !(duplicateStatus === 'CONFIRMED' && groupStatus !== 'resolved')) return false;
    if (f.duplicate === 'unassigned_only' && app.class_option_id) return false;

    if (f.milestone) {
      const ms = getApplicantMilestones(model, app);
      if (!ms.includes(String(f.milestone || '').toUpperCase())) return false;
    }
    if (f.attendance === 'high' && (summary.attendancePct == null || summary.attendancePct < 75)) return false;
    if (f.attendance === 'low' && (summary.attendancePct == null || summary.attendancePct >= 75)) return false;
    if (f.attendance === 'none' && summary.attendancePct != null) return false;
    if (f.status && classifyRowStatus(app, summary).cls !== f.status) return false;
    if (f.date && ymd(app.created_at) !== f.date) return false;

    const af = advFilters;
    if (af?.active) {
      if (af.dateFrom && ymd(app.created_at) < af.dateFrom) return false;
      if (af.dateTo && ymd(app.created_at) > af.dateTo) return false;
      if (af.attStatus) {
        const att = getAttendanceSummary(model, app);
        if (af.attStatus === 'never' && att.total > 0) return false;
        if (af.attStatus === 'active' && (att.pct == null || att.pct < 75)) return false;
        if (af.attStatus === 'atrisk' && (att.pct == null || att.pct >= 75)) return false;
      }
    }
    return true;
  });
}

// Filter dropdown option sources
export function buildFilterOptions(model) {
  return {
    fellowships: [...new Set(model.applicants.map((a) => a.fellowship_code || a.fellowship || a.subgroup_id).filter(Boolean))].sort(),
    subgroups: [...new Set(model.applicants.map((a) => a.subgroup_id).filter(Boolean))].sort(),
    classes: model.classOptions.map((c) => classIdOf(c)).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    batches: [...new Set(model.applicants.map((a) => a.batch_id).concat(model.classOptions.map((c) => c.batch_id)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))),
  };
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

export function computeKpis(model, rows, cache) {
  const total = rows.length;
  const assigned = rows.filter((a) => Boolean(a.class_option_id)).length;
  const duplicates = rows.filter((a) => String(a.duplicate_status || '').toUpperCase() === 'CONFIRMED').length;
  const needsAttention = rows.filter((a) => summarizeApplicant(model, a, cache).needsFollowUp).length;
  const pendingNotifications = (model.duplicateNotifications || []).filter((n) => String(n.notification_status).toLowerCase() === 'pending').length;
  return { total, assigned, unassigned: total - assigned, duplicates, needsAttention, pendingNotifications };
}

// ── CSV export (mirrors applicant-directory-actions.js exportData) ───────────

export function exportApplicantsCsv(rows) {
  if (!rows.length) return;
  const cols = ['full_name', 'email', 'phone', 'fellowship_code', 'class_option_id', 'batch_id', 'status', 'registration_status', 'created_at'];
  const csv = [cols.join(','), ...rows.map((a) => cols.map((c) => `"${String(a[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `applicants-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Group/subgroup display helpers ───────────────────────────────────────────

export const displayGroupValue = (app) => (String(app?.fellowship_code || '').toUpperCase() === 'REGIONAL' && !app?.group_id ? 'Regional' : (app?.group_id || '-'));
export const displaySubgroupValue = (app) => (String(app?.fellowship_code || '').toUpperCase() === 'REGIONAL' && !app?.subgroup_id ? 'Regional' : (app?.subgroup_id || '-'));

// ── Review mode helpers (mirror applicant-directory.js) ──────────────────────

export function classCapacityInfo(model, classOptionId) {
  const cls = getClassInfo(model, classOptionId);
  const current = model.applicants.filter((a) => String(a.class_option_id || '') === String(classOptionId || '')).length;
  const max = Number(cls?.capacity || cls?.max_capacity || cls?.class_capacity || 0) || 0;
  return { current, max, full: max > 0 && current >= max };
}

export function relativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Date.now() - date.getTime());
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Today';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function reviewStatusClass(app) {
  const status = String(app.duplicate_status || app.registration_status || app.status || 'PENDING').toUpperCase();
  if (status === 'DUPLICATE') return 'duplicate';
  if (status === 'REVIEW') return 'attention';
  if (status === 'ASSIGNED' || app.class_option_id) return 'assigned';
  return 'unassigned';
}

const preferredClassTime = (app) => app?.preferred_class_time || app?.class_time || app?.class_label || app?.availability || app?.availability_status || '';

export function reviewComparisonGroup(model, app) {
  const email = String(app?.email || '').toLowerCase().trim();
  if (!email) return [app].filter(Boolean);
  const matches = model.applicants.filter((row) => String(row.email || '').toLowerCase().trim() === email);
  if (matches.length) {
    return [...matches].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
  return [app].filter(Boolean);
}

export function reviewFieldRows(model, primary, secondary) {
  const formatClassSchedule = (app) => {
    const cls = getClassInfo(model, app?.class_option_id);
    const schedule = [cls?.day, cls?.class_time].filter(Boolean).join(' ');
    return preferredClassTime(app) || schedule || app?.class_option_id || 'Unassigned';
  };
  const rows = [
    ['Email', primary?.email || '-', secondary?.email || '-'],
    ['Phone', primary?.phone || primary?.phone_number || '-', secondary?.phone || secondary?.phone_number || '-'],
    ['Fellowship', primary?.fellowship_code || primary?.fellowship || primary?.subgroup_id || '-', secondary?.fellowship_code || secondary?.fellowship || secondary?.subgroup_id || '-'],
    ['Campus', primary?.group_id || displayGroupValue(primary) || '-', secondary?.group_id || displayGroupValue(secondary) || '-'],
    ['Batch', primary?.batch_id || '-', secondary?.batch_id || '-'],
    ['Class Time', formatClassSchedule(primary), formatClassSchedule(secondary)],
  ];
  return rows.map(([label, left, right]) => ({ label, left, right, diff: String(left) !== String(right) }));
}

export function activeClassOptions(model, excludeClassId) {
  return model.classOptions
    .filter((c) => c.active !== false && classIdOf(c) !== String(excludeClassId || ''))
    .sort((a, b) => classIdOf(a).localeCompare(classIdOf(b)));
}
