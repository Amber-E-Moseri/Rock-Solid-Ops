import { supabase } from '../../../supabase.js';

export const SCENARIO_LABELS = {
  never_started: 'Never Started',
  dropped_off: 'Dropped Off',
  moodle_no_login: 'Moodle No Login',
  final_notice: 'Final Notice Sent',
};

export const SCENARIO_VARIANTS = {
  never_started: 'warning',
  dropped_off: 'danger',
  moodle_no_login: 'info',
  final_notice: 'neutral',
};

export const daysSince = (isoDate) =>
  isoDate ? Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000) : null;

const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');

export async function fetchAtRiskData() {
  const [logsRes, studentsRes, batchesRes] = await Promise.all([
    supabase.from('student_engagement_log').select('*').order('created_at', { ascending: false }).limit(2000),
    supabase.from('students').select('student_id,email,full_name,fellowship_code,class_option_id,teacher_name,batch_id,status,needs_attention_flag,needs_attention_reason').limit(3000),
    supabase.from('batches').select('batch_id,batch_name').order('created_at', { ascending: false }).limit(200),
  ]);

  const students = studentsRes.data || [];
  let logs = logsRes.data || [];
  const batches = batchesRes.data || [];

  const byEmail = new Map(students.map((s) => [String(s.email || '').toLowerCase(), s]));

  // Class labels
  const classIds = [...new Set(students.map((s) => s.class_option_id).filter(Boolean))];
  const classMap = new Map();
  if (classIds.length) {
    const { data: clsRows } = await supabase.from('class_options').select('class_option_id,teacher_name,day,class_time').in('class_option_id', classIds);
    (clsRows || []).forEach((c) => classMap.set(c.class_option_id, c));
  }
  for (const stu of students) {
    const cls = classMap.get(stu.class_option_id);
    stu._class_label = cls ? `${cls.day || ''} ${cls.class_time || ''}`.trim() || stu.class_option_id : stu.class_option_id || '-';
  }

  for (const log of logs) {
    log._name = byEmail.get(String(log.student_email || '').toLowerCase())?.full_name || '';
  }

  // Keep only students flagged at-risk or with un-skipped engagement entries (legacy behavior)
  logs = logs.filter((log) => {
    const stu = byEmail.get(String(log.student_email || '').toLowerCase());
    return stu?.needs_attention_flag || log.action_taken !== 'skipped';
  });

  return { logs, students, batches, byEmail };
}

export function filterLogs(logs, { tab, scenario, batch, search }) {
  const q = (search || '').toLowerCase().trim();
  return logs.filter((log) => {
    if (tab && tab !== 'all' && log.scenario !== tab) return false;
    if (scenario && log.scenario !== scenario) return false;
    if (batch && log.batch_id !== batch) return false;
    if (q && ![log.student_email, log._name].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}

export function summarize(logs, students) {
  return {
    total: logs.length,
    neverStarted: logs.filter((l) => l.scenario === 'never_started').length,
    droppedOff: logs.filter((l) => l.scenario === 'dropped_off').length,
    finalNotice: logs.filter((l) => l.scenario === 'final_notice').length,
    withdrawn: students.filter((s) => s.status === 'Withdrawn').length,
  };
}

// ── Actions (mirror legacy handleAction exactly) ─────────────────────────────

export async function markResponded({ email, batchId, student, actorEmail }) {
  const now = new Date().toISOString();
  await supabase.from('students')
    .update({ status: 'Active', needs_attention_flag: false, needs_attention_reason: null, updated_at: now })
    .eq('email', email);
  await supabase.from('student_engagement_log')
    .update({ action_taken: 'skipped', notes: 'Marked responded by admin' })
    .eq('student_email', email)
    .eq('batch_id', batchId);
  await supabase.from('audit_logs').insert({
    action: 'ENGAGEMENT_MARKED_RESPONDED', entity_type: 'student',
    entity_id: student?.student_id || email, actor_email: actorEmail || null,
    status: 'SUCCESS', details: { email, batch_id: batchId }, created_at: now,
  });
}

export async function withdrawStudent({ email, batchId, student, actorEmail }) {
  const now = new Date().toISOString();
  await supabase.from('students')
    .update({ status: 'Withdrawn', needs_attention_flag: false, updated_at: now })
    .eq('email', email);
  await supabase.from('student_engagement_log')
    .update({ action_taken: 'status_updated', notes: 'Withdrawn by admin' })
    .eq('student_email', email)
    .eq('batch_id', batchId);
  await supabase.from('audit_logs').insert({
    action: 'STUDENT_WITHDRAWN', entity_type: 'student',
    entity_id: student?.student_id || email, actor_email: actorEmail || null,
    status: 'SUCCESS', details: { email, batch_id: batchId }, created_at: now,
  });
}

export async function sendCheckin({ email, scenario, student }) {
  const firstName = String(student?.full_name || email).split(/\s+/)[0];
  const templateKey = scenario === 'dropped_off' ? 'engagement_dropped_off' : 'engagement_never_started';
  const subject = scenario === 'dropped_off'
    ? `We miss you at Rock Solid — ${firstName}`
    : `We saved your spot at Rock Solid — ${firstName}`;
  const { error } = await supabase.from('email_queue').insert({
    recipient_email: email,
    recipient_name: student?.full_name || '',
    template_key: templateKey,
    subject,
    status: 'Pending',
    payload: {
      first_name: firstName,
      full_name: student?.full_name || '',
      class_time: student?._class_label || 'your class',
      teacher_name: student?.teacher_name || 'your teacher',
      moodle_url: 'https://rocksolid.lwcanada.org/',
      last_attended_date: student?._last_att_date ? fmt(student._last_att_date) : 'not yet',
      sessions_missed: '—',
    },
  });
  if (error) throw error;
}
