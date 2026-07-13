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
    supabase.from('audit_logs').select('actor_name, action, entity_type, created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('moodle_sync').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase.from('email_queue').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
  ]);
  const firstError = logsRes.error || failedRes.error || pendingRes.error;
  if (firstError) throw firstError;
  return {
    recentLogs: logsRes.data ?? [],
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
