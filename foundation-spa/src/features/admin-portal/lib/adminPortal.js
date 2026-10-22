import { supabase } from '../../../supabase.js';

export async function fetchPortalStats() {
  const [enrolled, batches, pending, teachers] = await Promise.all([
    supabase.from('applicants').select('id', { count: 'exact', head: true }).not('status', 'in', '(Withdrawn,Rejected)'),
    supabase.from('batches').select('batch_id', { count: 'exact', head: true }).in('status', ['Active', 'Open']),
    supabase.from('applicants').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('teachers').select('teacher_id', { count: 'exact', head: true }).eq('status', 'Active'),
  ]);
  const firstError = enrolled.error || batches.error || pending.error || teachers.error;
  if (firstError) throw firstError;
  return {
    enrolled: enrolled.count ?? 0,
    activeBatches: batches.count ?? 0,
    pending: pending.count ?? 0,
    teachers: teachers.count ?? 0,
  };
}

export async function fetchActivityFeed() {
  const [logsRes, failedRes, pendingRes] = await Promise.all([
    // audit_logs has actor_email (not actor_name); the staff dashboard and audit log read it the same way.
    supabase.from('audit_logs').select('actor_email, action, entity_type, created_at').order('created_at', { ascending: false }).limit(5),
    // Live Moodle state is moodle_enrollment_sync.sync_status; moodle_sync is a legacy table with no status column.
    supabase.from('moodle_enrollment_sync').select('*', { count: 'exact', head: true }).eq('sync_status', 'FAILED'),
    supabase.from('email_queue').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
  ]);
  const firstError = logsRes.error || failedRes.error || pendingRes.error;
  if (firstError) throw firstError;
  return {
    // The card reads actor_name; map it from the actor_email column that exists.
    recentLogs: (logsRes.data ?? []).map((row) => ({ ...row, actor_name: row.actor_email ?? null })),
    failedMoodle: failedRes.count ?? 0,
    pendingEmails: pendingRes.count ?? 0,
  };
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
