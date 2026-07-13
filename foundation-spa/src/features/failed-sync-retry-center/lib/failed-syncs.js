import { supabase } from '../../../supabase.js';

function isMissingTable(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('relation');
}

function pick(obj, keys, fallback = '-') {
  for (const k of keys) { const v = obj?.[k]; if (v !== null && v !== undefined && v !== '') return v; }
  return fallback;
}

export function fmtDateTime(v) {
  if (!v || v === '-') return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function typeBadge(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('moodle')) return 'Moodle';
  if (t.includes('mailchimp')) return 'Mailchimp';
  if (t.includes('email') || t.includes('notification')) return 'Email';
  return 'Sync';
}

export function statusVariant(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'danger';
  if (s.includes('pending') || s.includes('retry')) return 'warning';
  if (s.includes('resolved') || s.includes('success')) return 'success';
  return 'info';
}

function normalizeJob(source, row, fallbackType) {
  return {
    source,
    id: String(pick(row, ['id', 'queue_id', 'sync_id'], '')),
    type: fallbackType,
    recipient: String(pick(row, ['recipient_email', 'email', 'recipient_name', 'student_id', 'applicant_id'], '-')),
    status: String(pick(row, ['status', 'sync_status'], 'Unknown')),
    error: String(pick(row, ['error_message', 'last_error', 'failure_reason'], '-')),
    failureReason: String(row?.failure_reason || ''),
    traceId: String(row?.trace_id || row?.payload?.trace_id || row?.metadata?.trace_id || row?.details?.trace_id || ''),
    created_at: pick(row, ['created_at', 'occurred_at', 'logged_at'], '-'),
    lastAttemptedAt: pick(row, ['updated_at', 'last_retry_at', 'sent_at'], '-'),
    retryCount: Number(pick(row, ['retry_count', 'attempts', 'sync_attempts'], 0)) || 0,
    raw: row,
  };
}

async function loadSource(table, query, map) {
  try {
    const { data, error } = await query(supabase.from(table));
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return (data || []).map(map);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

export async function fetchFailedJobs() {
  const [failedSyncs, emails, scheduled, moodle] = await Promise.all([
    loadSource('failed_syncs',
      (q) => q.select('*').order('created_at', { ascending: false }).limit(500),
      (r) => normalizeJob('failed_syncs', r, typeBadge(pick(r, ['sync_type', 'source_table', 'provider'], 'sync')))),
    loadSource('email_queue',
      (q) => q.select('*').or('status.ilike.%fail%,status.ilike.%error%').order('updated_at', { ascending: false }).limit(500),
      (r) => normalizeJob('email_queue', r, 'Email')),
    loadSource('scheduled_notifications',
      (q) => q.select('*').or('status.ilike.%fail%,status.ilike.%error%').order('updated_at', { ascending: false }).limit(500),
      (r) => normalizeJob('scheduled_notifications', r, 'Email')),
    loadSource('moodle_enrollment_sync',
      (q) => q.select('*').or('sync_status.ilike.%fail%,sync_status.ilike.%error%,sync_status.ilike.%retry%,status.ilike.%retry%,last_error.not.is.null').order('updated_at', { ascending: false }).limit(500),
      (r) => normalizeJob('moodle_enrollment_sync', r, 'Moodle')),
  ]);

  return [...failedSyncs, ...emails, ...scheduled, ...moodle]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

export function computeKpis(rows) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: rows.length,
    emails: rows.filter((j) => j.source === 'email_queue' || j.source === 'scheduled_notifications').length,
    moodle: rows.filter((j) => String(j.type).toLowerCase() === 'moodle').length,
    mailchimp: rows.filter((j) => String(j.type).toLowerCase() === 'mailchimp').length,
    retriesToday: rows.filter((j) => j.retryCount > 0 && (j.lastAttemptedAt || '').slice(0, 10) === today).length,
  };
}

export function filterJobs(rows, { status, type, dateFrom, dateTo, search }) {
  return rows.filter((r) => {
    if (status) {
      const s = String(r.status || '').toLowerCase();
      if (!s.includes(status.toLowerCase())) return false;
    }
    if (type) {
      const t = String(r.type || '').toLowerCase();
      if (!t.includes(type.toLowerCase())) return false;
    }
    if (dateFrom) {
      const d = r.created_at && r.created_at !== '-' ? new Date(r.created_at).toISOString().slice(0, 10) : '';
      if (d < dateFrom) return false;
    }
    if (dateTo) {
      const d = r.created_at && r.created_at !== '-' ? new Date(r.created_at).toISOString().slice(0, 10) : '';
      if (d > dateTo) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = [r.recipient, r.error, r.traceId, r.type, r.source, r.status].map((v) => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export async function invokeRetryAction(action, source, id) {
  const { data, error } = await supabase.functions.invoke('retry-worker', { body: { action, source, id } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Retry worker failed');
  return data;
}
