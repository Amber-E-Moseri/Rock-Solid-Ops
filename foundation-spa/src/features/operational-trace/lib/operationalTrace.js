import { supabase } from '../../../supabase.js';

export const EVENT_STYLES = {
  registration: { icon: '✏️', color: '#4C2A92', label: 'Registration' },
  assignment:   { icon: '✅', color: '#16a34a', label: 'Assignment' },
  email:        { icon: '📧', color: '#7c3aed', label: 'Email' },
  moodle:       { icon: '🔄', color: '#0891b2', label: 'Moodle Sync' },
  error:        { icon: '⚠️', color: '#C8102E', label: 'Error' },
  manual:       { icon: '👤', color: '#6b7280', label: 'Manual Action' },
  attendance:   { icon: '📊', color: '#d97706', label: 'Attendance' },
  milestone:    { icon: '🏆', color: '#ca8a04', label: 'Milestone' },
  notification: { icon: '🔔', color: '#0ea5e9', label: 'Notification' },
};

export const FILTER_CHIPS = [
  { key: 'all',        label: 'All',        types: [] },
  { key: 'emails',     label: 'Emails',     types: ['email', 'notification'] },
  { key: 'moodle',     label: 'Moodle',     types: ['moodle'] },
  { key: 'attendance', label: 'Attendance',  types: ['attendance'] },
  { key: 'milestones', label: 'Milestones',  types: ['milestone'] },
  { key: 'errors',     label: 'Errors',      types: ['error'] },
  { key: 'manual',     label: 'Manual',      types: ['manual'] },
];

async function safeSource(label, fn) {
  try { return await fn(); } catch (e) { return { error: label, message: e.message }; }
}

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

async function resolveLookup(lookup) {
  if (isEmail(lookup)) {
    const { data } = await supabase.from('applicants')
      .select('id,email,first_name,last_name,registration_status,class_option_id,created_at,updated_at,batch_id')
      .ilike('email', lookup).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return { applicant: data, email: lookup };
  }
  const { data: byId } = await supabase.from('applicants')
    .select('id,email,first_name,last_name,registration_status,class_option_id,created_at,updated_at,batch_id')
    .eq('id', lookup).maybeSingle();
  if (byId) return { applicant: byId, email: byId.email };

  const { data: eqRow } = await supabase.from('email_queue')
    .select('recipient_email').eq('id', lookup).maybeSingle();
  if (eqRow?.recipient_email) return { applicant: null, email: eqRow.recipient_email };
  return { applicant: null, email: null };
}

export async function fetchTrace(lookup) {
  const { applicant, email } = await resolveLookup(lookup.trim());
  const applicantId = applicant?.id;
  const events = [];
  const errors = [];

  const sources = [];

  if (email) {
    sources.push(safeSource('email_queue', async () => {
      const { data } = await supabase.from('email_queue')
        .select('id,template_key,recipient_email,subject,status,sent_at,error_message,created_at,updated_at,metadata,payload')
        .ilike('recipient_email', email).order('created_at', { ascending: false }).limit(500);
      for (const r of data ?? []) {
        events.push({
          type: r.status === 'FAILED' ? 'error' : 'email', ts: r.created_at,
          description: `${r.template_key || 'Email'}: ${r.subject || '(no subject)'}`,
          details: r, traceId: r.id, source: 'email_queue', status: r.status,
        });
      }
    }));
  }

  sources.push(safeSource('moodle_enrollment_sync', async () => {
    const filter = email ? `email.ilike.${email}` : `id.eq.${lookup}`;
    const { data } = await supabase.from('moodle_enrollment_sync')
      .select('id,email,sync_status,error_message,moodle_course_id,batch_id,class_option_id,synced_at,created_at,updated_at')
      .or(filter).order('updated_at', { ascending: false }).limit(500);
    for (const r of data ?? []) {
      const isErr = ['FAILED', 'RETRYING', 'PERMANENTLY_FAILED'].includes(r.sync_status);
      events.push({
        type: isErr ? 'error' : 'moodle', ts: r.updated_at || r.created_at,
        description: `Moodle sync: ${r.sync_status}${r.moodle_course_id ? ` (course ${r.moodle_course_id})` : ''}`,
        details: r, traceId: r.id, source: 'moodle_enrollment_sync', status: r.sync_status,
      });
    }
  }));

  if (email) {
    const { data: stuRows } = await supabase.from('students')
      .select('student_id,email,class_option_id,full_name').ilike('email', email).limit(20);
    const studentIds = (stuRows ?? []).map((s) => s.student_id).filter(Boolean);

    if (studentIds.length > 0) {
      sources.push(safeSource('attendance_log', async () => {
        const { data } = await supabase.from('attendance_log')
          .select('attendance_id,student_id,class_option_id,class_number,class_date,present,made_up,submission_date,logged_at,submitted_by_teacher')
          .in('student_id', studentIds).order('class_date', { ascending: false }).limit(500);
        for (const r of data ?? []) {
          events.push({
            type: 'attendance', ts: r.class_date || r.logged_at,
            description: `Class ${r.class_number || '?'}: ${r.present ? 'Present' : 'Absent'}${r.made_up ? ' (made up)' : ''}`,
            details: r, traceId: r.attendance_id, source: 'attendance_log', status: r.present ? 'PRESENT' : 'ABSENT',
          });
        }
      }));

      sources.push(safeSource('class_roster', async () => {
        const { data } = await supabase.from('class_roster')
          .select('id,student_id,class_option_id,batch_id,status,enrolled_at,created_at,updated_at')
          .in('student_id', studentIds).order('created_at', { ascending: false }).limit(500);
        for (const r of data ?? []) {
          events.push({
            type: 'assignment', ts: r.created_at,
            description: `Class roster: ${r.status} — ${r.class_option_id}`,
            details: r, traceId: r.id, source: 'class_roster', status: r.status,
          });
        }
      }));
    }

    sources.push(safeSource('scheduled_notifications', async () => {
      const { data } = await supabase.from('scheduled_notifications')
        .select('id,event_type,recipient_email,status,scheduled_for,sent_at,updated_at,payload,dedupe_key,created_at')
        .ilike('recipient_email', email).order('created_at', { ascending: false }).limit(500);
      for (const r of data ?? []) {
        events.push({
          type: 'notification', ts: r.created_at,
          description: `${r.event_type || 'Notification'}: ${r.status}`,
          details: r, traceId: r.id, source: 'scheduled_notifications', status: r.status,
        });
      }
    }));
  }

  if (applicantId) {
    sources.push(safeSource('student_milestone_status', async () => {
      const { data } = await supabase.from('student_milestone_status')
        .select('id,applicant_id,milestone_code,completed,updated_at,created_at,updated_by')
        .eq('applicant_id', applicantId).order('updated_at', { ascending: false }).limit(500);
      for (const r of data ?? []) {
        if (r.completed) {
          events.push({
            type: 'milestone', ts: r.updated_at || r.created_at,
            description: `Milestone: ${r.milestone_code}`,
            details: r, traceId: r.id, source: 'student_milestone_status', status: 'COMPLETED',
          });
        }
      }
    }));

    sources.push(safeSource('audit_logs', async () => {
      const { data } = await supabase.from('audit_logs')
        .select('id,created_at,action,actor_email,entity_type,entity_id,status,details')
        .eq('entity_id', applicantId).order('created_at', { ascending: false }).limit(500);
      for (const r of data ?? []) {
        events.push({
          type: 'manual', ts: r.created_at,
          description: `${r.action} (${r.entity_type})`,
          details: r, traceId: r.id, actor: r.actor_email, source: 'audit_logs', status: r.status,
        });
      }
    }));
  }

  const results = await Promise.all(sources);
  for (const r of results) {
    if (r && r.error) errors.push(r);
  }

  events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return { applicant, events, errors };
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function absTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

export function exportTraceJson(applicant, events) {
  const blob = new Blob([JSON.stringify({ context: applicant, events }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'operational-trace.json');
}

export function exportTraceCsv(events) {
  const headers = ['timestamp', 'event_type', 'description', 'status', 'source', 'actor', 'trace_id'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(','), ...events.map((e) => [e.ts, e.type, e.description, e.status, e.source, e.actor, e.traceId].map(esc).join(','))];
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), 'operational-trace.csv');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
