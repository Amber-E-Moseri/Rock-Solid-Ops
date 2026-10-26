import { supabase } from '../../../supabase.js';
import { isMoodleRetryHeld, MOODLE_RETRY_CERTIFIED, MOODLE_RETRY_HOLD_MESSAGE } from '../../../releaseHolds.js';

// ── Scope resolution ────────────────────────────────────────────────────────

export async function resolveScope(profile) {
  const isScoped = !['admin', 'superadmin', 'regional_secretary'].includes(
    String(profile?.role || '').toLowerCase()
  );
  if (!isScoped) return { subgroups: null, scoped: false };

  const { data } = await supabase
    .from('admin_users')
    .select('subgroup_id,group_id,subgroups')
    .eq('auth_user_id', profile.user_id)
    .maybeSingle();

  let subgroups = null;
  if (data?.subgroups?.length) subgroups = data.subgroups;
  else if (data?.subgroup_id) subgroups = [data.subgroup_id];
  else if (data?.group_id) subgroups = [data.group_id];

  return { subgroups, scoped: Boolean(subgroups) };
}

// ── Batch list ──────────────────────────────────────────────────────────────

export async function fetchBatches() {
  const { data } = await supabase
    .from('batches')
    .select('batch_id,name,batch_name,start_date,end_date,active')
    .order('created_at', { ascending: false })
    .limit(30);

  // A failed count read is unknown (null), not zero students.
  let countsByBatch = {};
  let countsFailed = false;
  try {
    const { data: counts, error: countsError } = await supabase
      .from('students')
      .select('batch_id')
      .eq('status', 'Active');
    if (countsError) countsFailed = true;
    (counts || []).forEach((r) => {
      const k = r.batch_id || '';
      countsByBatch[k] = (countsByBatch[k] || 0) + 1;
    });
  } catch {
    countsFailed = true;
  }

  return (data || []).map((b) => ({
    ...b,
    displayName: b.name || b.batch_name || b.batch_id,
    studentCount: countsFailed ? null : (countsByBatch[b.batch_id] || 0),
  }));
}

// ── Dashboard data (all parallel) ───────────────────────────────────────────

export async function fetchDashboardData(batchId, subgroups) {
  const params = { p_batch_id: batchId || null, p_subgroups: subgroups || null };

  const results = await Promise.allSettled([
    fetchRegistrationSummary(params),
    fetchFellowshipBreakdown(params),
    fetchWeeklyTrend(params),
    fetchCapacity(params),
    fetchStaleQueue(params),
    fetchAttendanceHealth(batchId),
    fetchMilestoneSummary(batchId),
    fetchMoodleSyncHealth(),
    fetchRegistrationFunnel(batchId),
    fetchDuplicateSummary(batchId),
    fetchTeacherKpis(batchId),
    fetchEscalationSummary(subgroups),
    fetchRecentRegistrations(),
    fetchActivityFeed(),
  ]);

  const value = (i) => results[i].status === 'fulfilled' ? results[i].value : null;

  return {
    registration: value(0),
    fellowship: value(1),
    weeklyTrend: value(2),
    capacity: value(3),
    staleQueue: value(4),
    attendance: value(5),
    milestones: value(6),
    moodleSync: value(7),
    funnel: value(8),
    duplicates: value(9),
    teacherKpis: value(10),
    escalation: value(11),
    recentRegistrations: value(12),
    activityFeed: value(13),
    fetchedAt: new Date().toISOString(),
  };
}

// ── Individual fetchers ─────────────────────────────────────────────────────

async function fetchRegistrationSummary(params) {
  const { data, error } = await supabase.rpc('get_registration_summary', params);
  if (error) return null;
  const rows = data || [];
  const byStatus = Object.fromEntries(rows.map((r) => [r.reg_status, Number(r.cnt)]));
  return {
    rows,
    enrolled: byStatus.ASSIGNED ?? byStatus.ENROLLED ?? 0,
    waitlisted: byStatus.WAITLISTED ?? 0,
    pendingReview: byStatus.REVIEW ?? 0,
    duplicates: byStatus.DUPLICATE ?? 0,
  };
}

async function fetchFellowshipBreakdown(params) {
  const { data, error } = await supabase.rpc('get_fellowship_breakdown', params);
  if (error) return null;
  return data || [];
}

async function fetchWeeklyTrend(params) {
  const { data, error } = await supabase.rpc('get_registrations_by_week', params);
  if (error) return null;
  return (data || []).slice(-12);
}

async function fetchCapacity(params) {
  const { data, error } = await supabase.rpc('get_capacity_summary', params);
  if (error) return null;
  const rows = data || [];
  const classOptionIds = [...new Set(rows.map((r) => r.class_option_id).filter(Boolean))];
  let teacherByClass = {};
  if (classOptionIds.length) {
    const { data: classMeta } = await supabase
      .from('class_options')
      .select('class_option_id,teacher_name')
      .in('class_option_id', classOptionIds);
    (classMeta || []).forEach((m) => { teacherByClass[m.class_option_id] = String(m.teacher_name || '').trim(); });
  }
  return rows.map((r) => ({
    ...r,
    teacher_name: String(teacherByClass[r.class_option_id] || r.teacher_name || r.teacher || '').trim() || 'Unassigned',
    classLabel: `${r.day || '-'} ${r.class_time || '-'} — ${r.fellowship || '-'}`,
    enrolled: Number(r.enrolled_count || 0),
    max: Number(r.max_capacity || 0),
  }));
}

async function fetchStaleQueue(params) {
  const { data, error } = await supabase.rpc('get_stale_queue_items', params);
  // A failed query is unknown (null), not a count of zero.
  if (error) return null;
  return { count: Number(data?.[0]?.cnt || 0) };
}

async function fetchAttendanceHealth(batchId) {
  const { data, error } = await supabase.rpc('get_attendance_health', { p_batch_id: batchId || null });
  if (error) return null;
  const row = data?.[0] || {};
  return {
    rate: Number(row.submission_rate_pct || 0),
    submitted: Number(row.total_submitted_records || 0),
    expected: Number(row.total_expected_sessions || 0),
    zeroClasses: Number(row.classes_zero_submissions || 0),
    staleClasses: Number(row.classes_missing_2w || 0),
    missingClasses: Array.isArray(row.missing_classes) ? row.missing_classes : [],
    calculatedAt: row.calculated_at,
  };
}

async function fetchMilestoneSummary(batchId) {
  const { data, error } = await supabase.rpc('get_milestone_summary', { p_batch_id: batchId || null });
  if (error) return null;
  const row = data?.[0] || {};
  const total = Number(row.total_active_students || 0);
  const full = Number(row.students_all_complete || 0);
  return {
    total,
    fullyComplete: full,
    zeroComplete: Number(row.students_zero_complete || 0),
    avgPct: Number(row.avg_completion_pct || 0),
    completionPct: total > 0 ? (full * 100 / total) : 0,
    breakdown: Array.isArray(row.milestones_breakdown) ? row.milestones_breakdown : [],
    calculatedAt: row.calculated_at,
  };
}

async function fetchMoodleSyncHealth() {
  const { data, error } = await supabase.from('moodle_enrollment_sync').select('sync_status,synced_at,updated_at');
  if (error) return null;
  const counts = { SYNCED: 0, PENDING: 0, FAILED: 0, PROCESSING: 0 };
  let lastSuccess = null;
  (data || []).forEach((r) => {
    const s = String(r.sync_status || '').toUpperCase();
    if (counts[s] != null) counts[s]++;
    if (s === 'SYNCED' && r.synced_at && (!lastSuccess || new Date(r.synced_at) > new Date(lastSuccess)))
      lastSuccess = r.synced_at;
  });
  return { counts, lastSuccess };
}

async function fetchRegistrationFunnel(batchId) {
  const { data, error } = await supabase.rpc('get_registration_funnel', { p_batch_id: batchId || null });
  if (error) return null;
  const row = data?.[0] || {};
  return [
    { label: 'Registered', count: Number(row.registered_count || 0) },
    { label: 'Reviewed', count: Number(row.reviewed_count || 0) },
    { label: 'Assigned', count: Number(row.assigned_count || 0) },
    { label: 'Waitlisted', count: Number(row.waitlisted_count || 0) },
    { label: 'Duplicate', count: Number(row.duplicate_count || 0) },
  ];
}

async function fetchDuplicateSummary(batchId) {
  let query = supabase
    .from('duplicate_registration_groups')
    .select('id,created_at,status')
    .eq('status', 'unresolved')
    .order('created_at', { ascending: false })
    .limit(200);
  if (batchId) query = query.eq('batch_id', batchId);
  const { data, error } = await query;
  // A failed query is unknown (count null), not a count of zero.
  if (error) return { count: null, newestDate: null };
  const rows = data || [];
  return { count: rows.length, newestDate: rows[0]?.created_at || null };
}

// "Active" teachers follow the lifecycle column, teachers.status = 'ACTIVE', the same definition as the admin
// portal and teacher management. The tracked schema has no verified certification field, so no "certified"
// count is produced. A failed query is unknown (null), not zero.
async function fetchTeacherKpis(batchId) {
  const [active, teaching] = await Promise.all([
    supabase.from('teachers').select('teacher_id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.rpc('get_currently_teaching_count', { p_batch_id: batchId || null }),
  ]);
  return {
    activeTeachers: active.error ? null : (active.count ?? 0),
    currentlyTeaching: teaching.error ? null : Number(teaching.data?.[0]?.count ?? teaching.data ?? 0),
  };
}

async function fetchEscalationSummary(subgroups) {
  const { data, error } = await supabase.rpc('get_escalation_details', { p_subgroups: subgroups || null, p_limit: 50 });
  if (error) return null;
  return data || [];
}

async function fetchRecentRegistrations() {
  const { data, error } = await supabase
    .from('applicants')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return data || [];
}

async function fetchActivityFeed() {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('created_at,action,actor_email,entity_type,entity_id')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return [];
  return data || [];
}

// ── Retry action ────────────────────────────────────────────────────────────

export async function retryAllFailedMoodleSyncs() {
  // Held: the retry-worker route refuses Moodle retries until certification. Refuse before any request.
  const source = 'moodle_enrollment_sync';
  if (isMoodleRetryHeld('retry', source, MOODLE_RETRY_CERTIFIED)) throw new Error(MOODLE_RETRY_HOLD_MESSAGE);
  const { data: failedRows, error } = await supabase
    .from('moodle_enrollment_sync')
    .select('id')
    .in('sync_status', ['FAILED', 'RETRYING'])
    .limit(100);
  if (error) throw error;
  let failed = 0;
  // The authorized route is retry-worker. supabase.functions.invoke sends the admin session JWT, and
  // retry-worker enforces the admin check and the server-side Moodle hold. The browser holds no service key.
  for (const row of (failedRows || [])) {
    const { data, error: invokeError } = await supabase.functions.invoke('retry-worker', {
      body: { action: 'retry', source, id: String(row.id) },
    });
    if (invokeError || !data?.ok) failed += 1;
  }
  if (failed > 0) throw new Error(`${failed} Moodle sync retr${failed === 1 ? 'y' : 'ies'} failed`);
}

// ── CSV export ──────────────────────────────────────────────────────────────

export function exportCapacityCsv(rows) {
  const header = ['Class', 'Teacher', 'Enrolled'];
  const body = (rows || []).map((r) => [r.classLabel, r.teacher_name, r.enrolled]);
  const lines = [header, ...body].map((arr) =>
    arr.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'students_by_class.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Formatters ──────────────────────────────────────────────────────────────

export const fmtDate = (v) => {
  if (!v) return '-';
  const s = String(v);
  const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtTime = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString();
};

export const relativeMinutes = (iso) => {
  if (!iso) return '-';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
};

export const isRegionalSecretary = (role) =>
  String(role || '').toLowerCase() === 'regional_secretary';
