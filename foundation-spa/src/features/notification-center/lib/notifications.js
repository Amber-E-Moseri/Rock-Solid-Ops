import { supabase } from '../../../supabase.js';

async function selectSafe(table, query) {
  try {
    const { data, error } = await query(supabase.from(table));
    if (error) {
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('does not exist') || msg.includes('relation') || error?.code === '42P01') return [];
      throw error;
    }
    return data || [];
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('relation') || e?.code === '42P01') return [];
    throw e;
  }
}

const normalizeEmail = (r) => ({
  id: String(r.id), source: 'email_queue', type: 'email',
  status: String(r.status || '').toUpperCase() || 'UNKNOWN',
  recipient: r.recipient_email || '', subject: r.subject || r.template_key || '',
  error: r.error_message || r.last_error || '', created_at: r.created_at || r.updated_at, raw: r,
});

const normalizeScheduled = (r) => ({
  id: String(r.id), source: 'scheduled_notifications',
  type: String(r.event_type || '').toUpperCase().includes('MOODLE') ? 'moodle' : 'notification',
  status: String(r.status || '').toUpperCase() || 'UNKNOWN',
  recipient: r.recipient_email || '', subject: r.template_key || r.event_type || '',
  error: r.error_message || r.last_error || '', created_at: r.created_at || r.updated_at || r.scheduled_for, raw: r,
});

const normalizeFailedSync = (r) => ({
  id: String(r.id), source: 'failed_syncs',
  type: String(r.sync_type || '').toLowerCase().includes('moodle') ? 'moodle' : 'sync',
  status: String(r.status || 'FAILED').toUpperCase(),
  recipient: '', subject: r.source_table || r.sync_type || '',
  error: r.error_message || '', created_at: r.created_at || r.last_retry_at, raw: r,
});

const normalizeMoodle = (r) => ({
  id: String(r.id), source: 'moodle_enrollment_sync', type: 'moodle',
  status: String(r.sync_status || r.status || 'PENDING').toUpperCase(),
  recipient: r.email || r.student_email || '',
  subject: `Applicant ${r.applicant_id || ''} / Student ${r.student_id || ''}`,
  error: r.error_message || r.last_error || '', created_at: r.updated_at || r.last_attempt_at || r.created_at || r.synced_at, raw: r,
});

export async function fetchAllNotifications() {
  const [emails, scheduled, failedSyncs, moodle] = await Promise.all([
    selectSafe('email_queue', (q) => q.select('id,recipient_email,template_key,subject,status,error_message,last_error,created_at,updated_at').order('created_at', { ascending: false }).limit(1000)),
    selectSafe('scheduled_notifications', (q) => q.select('id,recipient_email,event_type,template_key,status,error_message,last_error,created_at,updated_at,scheduled_for').order('created_at', { ascending: false }).limit(1000)),
    selectSafe('failed_syncs', (q) => q.select('id,sync_type,source_table,status,error_message,created_at,last_retry_at').order('created_at', { ascending: false }).limit(600)),
    selectSafe('moodle_enrollment_sync', (q) => q.select('id,applicant_id,student_id,email,sync_status,error_message,last_error,error_code,last_attempt_at,updated_at,created_at,synced_at').order('updated_at', { ascending: false }).limit(600)),
  ]);

  const rows = [
    ...emails.map(normalizeEmail),
    ...scheduled.map(normalizeScheduled),
    ...failedSyncs.map(normalizeFailedSync),
    ...moodle.map(normalizeMoodle),
  ];

  return rows;
}

export function computeSummary(rows) {
  const isFail = (s) => String(s || '').toLowerCase().includes('fail') || String(s || '').toLowerCase().includes('error');
  const isPending = (s) => String(s || '').toLowerCase().includes('pending') || String(s || '').toLowerCase().includes('retry');
  return {
    pendingEmails: rows.filter((r) => r.type === 'email' && isPending(r.status)).length,
    failedEmails: rows.filter((r) => r.type === 'email' && isFail(r.status)).length,
    pendingMoodle: rows.filter((r) => r.type === 'moodle' && isPending(r.status)).length,
    failedMoodle: rows.filter((r) => r.type === 'moodle' && isFail(r.status)).length,
  };
}

export function filterRows(rows, { status, type, search, date }) {
  return rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    if (search) {
      const q = search.toLowerCase();
      const pool = [r.recipient, r.subject, r.error, r.source].map((v) => String(v || '').toLowerCase()).join(' ');
      if (!pool.includes(q)) return false;
    }
    if (date) {
      const d = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
      if (d !== date) return false;
    }
    return true;
  });
}

export async function invokeRetryWorker(action, source, id) {
  const { data, error } = await supabase.functions.invoke('retry-worker', { body: { action, source, id } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Retry worker failed');
  return data;
}

export function statusVariant(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'danger';
  if (s.includes('pending') || s.includes('retry')) return 'warning';
  if (s.includes('sent') || s.includes('resolved') || s.includes('success')) return 'success';
  return 'info';
}

export const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString();
};
