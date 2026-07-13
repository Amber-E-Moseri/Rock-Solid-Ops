import { supabase } from '../../../supabase.js';

const isMissingTable = (err) =>
  err?.code === '42P01' || String(err?.message || '').toLowerCase().includes('does not exist');

async function withTimeout(label, promiseFactory, ms = 9000) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return await Promise.race([promiseFactory(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function countTable(table, apply, optional = false) {
  try {
    const q0 = supabase.from(table).select('*', { count: 'exact', head: true });
    const q = typeof apply === 'function' ? apply(q0) : q0;
    const { count, error } = await withTimeout(`count ${table}`, () => q);
    if (error) {
      if (optional && isMissingTable(error)) return { count: 0, missing: true };
      throw error;
    }
    return { count: count || 0, missing: false };
  } catch (e) {
    if (optional && isMissingTable(e)) return { count: 0, missing: true };
    throw e;
  }
}

// ── Health checks ───────────────────────────────────────────────────────────

export async function runHealthChecks(supabaseUrl, anonKey) {
  const checks = [];
  const missingTables = new Set();

  const push = (key, title, state, detail) => checks.push({ key, title, state, detail });

  // 1. Session
  try {
    const session = await withTimeout('auth session', () => supabase.auth.getSession());
    const ok = !!session.data?.session;
    push('session', 'Auth / Session', ok ? 'pass' : 'warn', ok ? 'Authenticated session present.' : 'No active session.');
  } catch (e) {
    push('session', 'Auth / Session', 'fail', String(e?.message || e));
  }

  // 2. Supabase connectivity
  try {
    const { error } = await withTimeout('supabase connectivity',
      () => supabase.from('batches').select('batch_id', { head: true, count: 'exact' }).limit(1));
    if (error) throw error;
    push('conn', 'Supabase Connection', 'pass', 'Database reachable and responding.');
  } catch (e) {
    push('conn', 'Supabase Connection', 'fail', String(e?.message || e));
  }

  // 3. Profile visibility
  try {
    const { data: { user } } = await withTimeout('auth user', () => supabase.auth.getUser());
    if (!user) throw new Error('No authenticated user.');

    const { data: profileRow, error: profileErr } = await withTimeout('profiles visibility',
      () => supabase.from('profiles').select('user_id,email,role').eq('user_id', user.id).maybeSingle());

    if (!profileErr && profileRow) {
      push('profiles', 'Profile Visibility (profiles)', 'pass', `Role: ${profileRow.role || 'unknown'} — canonical table present.`);
    } else if (profileErr && isMissingTable(profileErr)) {
      missingTables.add('profiles');
      push('profiles', 'Profile Visibility (profiles)', 'warn', 'profiles table not yet present; using admin_users fallback.');
    } else {
      push('profiles', 'Profile Visibility (profiles)', 'warn', profileErr ? String(profileErr.message) : 'No profiles row found for current user.');
    }
  } catch (e) {
    push('profiles', 'Profile Visibility', 'fail', String(e?.message || e));
  }

  // 4. Table accessibility
  const tableChecks = [
    ['email_queue', 'Queue table access'],
    ['scheduled_notifications', 'Scheduled notifications access'],
    ['audit_logs', 'Audit logs access'],
    ['failed_syncs', 'Failed syncs access'],
    ['moodle_enrollment_sync', 'Moodle enrollment sync access'],
    ['batches', 'Batches access'],
  ];

  for (const [table, label] of tableChecks) {
    try {
      const { error } = await withTimeout(label,
        () => supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1));
      if (error) {
        if (isMissingTable(error)) { missingTables.add(table); push(`tbl-${table}`, label, 'warn', `${table} missing (optional).`); }
        else throw error;
      } else {
        push(`tbl-${table}`, label, 'pass', `${table} readable.`);
      }
    } catch (e) {
      push(`tbl-${table}`, label, 'fail', String(e?.message || e));
    }
  }

  // 5. Edge function probes
  const edgeFunctions = ['retry-worker', 'registration-processor', 'moodle-sync', 'notification-batch-processor', 'notification-dispatcher'];
  if (supabaseUrl && anonKey) {
    for (const fn of edgeFunctions) {
      try {
        const res = await withTimeout(`edge ${fn}`,
          () => fetch(`${supabaseUrl}/functions/v1/${fn}`, {
            method: 'OPTIONS',
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          }), 8000);
        if (res.ok) push(`fn-${fn}`, `Edge Function: ${fn}`, 'pass', `Reachable (HTTP ${res.status}).`);
        else if (res.status === 401 || res.status === 403) push(`fn-${fn}`, `Edge Function: ${fn}`, 'warn', `Reachable but auth-restricted (HTTP ${res.status}).`);
        else push(`fn-${fn}`, `Edge Function: ${fn}`, 'warn', `Responded HTTP ${res.status}.`);
      } catch (e) {
        push(`fn-${fn}`, `Edge Function: ${fn}`, 'fail', String(e?.message || e));
      }
    }
  }

  // 6. Moodle mapping
  try {
    const { count, missing } = await countTable('batch_moodle_courses', (q) => q.eq('active', true), true);
    if (missing) missingTables.add('batch_moodle_courses');
    push('moodle-mapping', 'Moodle Course Mapping', count > 0 ? 'pass' : 'warn',
      count > 0 ? `${count} active mapping(s) available.` : 'No active batch_moodle_courses mappings found.');
  } catch (e) {
    push('moodle-mapping', 'Moodle Course Mapping', 'warn', String(e?.message || e));
  }

  // 7. Moodle API connectivity
  if (supabaseUrl && anonKey) {
    try {
      const res = await withTimeout('moodle-api-test',
        () => fetch(`${supabaseUrl}/functions/v1/moodle-sync`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'test' }),
        }), 10000);
      const data = await res.json().catch(() => ({}));
      if (data.ok) push('moodle-api', 'Moodle API Connectivity', 'pass', `Connected — ${data.sitename || data.siteurl || 'Moodle'}`);
      else if (data.code === 'MOODLE_NOT_CONFIGURED') push('moodle-api', 'Moodle API Connectivity', 'warn', 'MOODLE_URL / MOODLE_TOKEN not configured.');
      else push('moodle-api', 'Moodle API Connectivity', 'fail', `${data.error || data.code || 'Unknown error'}`);
    } catch (e) {
      push('moodle-api', 'Moodle API Connectivity', 'fail', String(e?.message || e));
    }
  }

  return { checks, missingTables: [...missingTables] };
}

// ── Queue metrics ───────────────────────────────────────────────────────────

export async function fetchQueueMetrics() {
  const results = await Promise.allSettled([
    countTable('email_queue', (q) => q.or('status.ilike.%pending%,status.ilike.%queued%'), true),
    countTable('email_queue', (q) => q.or('status.ilike.%fail%,status.ilike.%error%'), true),
    countTable('scheduled_notifications', (q) => q.or('status.ilike.%pending%,status.ilike.%queued%'), true),
    countTable('failed_syncs', (q) => q.or('status.ilike.%fail%,status.ilike.%error%'), true),
    countTable('moodle_enrollment_sync', (q) => q.in('sync_status', ['PENDING', 'RETRYING', 'FAILED']), true),
    countTable('batches', (q) => q.eq('active', true), true),
  ]);

  const v = (i) => results[i].status === 'fulfilled' ? results[i].value.count : 0;
  const queuedEmail = v(0), failedEmail = v(1), scheduled = v(2), failedSync = v(3), moodleBacklog = v(4), activeBatch = v(5);
  const retryBacklog = failedSync + failedEmail + moodleBacklog;

  return {
    queuedEmail, failedEmail, scheduled, failedSync, moodleBacklog, activeBatch, retryBacklog,
    queues: [
      { name: 'Moodle retries', depth: retryBacklog, warnAt: 3, badAt: 10 },
      { name: 'Email outbound', depth: queuedEmail, warnAt: 5, badAt: 20 },
      { name: 'Failed emails', depth: failedEmail, warnAt: 1, badAt: 5 },
      { name: 'Notifications', depth: scheduled, warnAt: 20, badAt: 100 },
    ],
  };
}

// ── Recent failures ─────────────────────────────────────────────────────────

export async function fetchRecentFailures() {
  const out = [];

  const load = async (table, apply, mapper) => {
    try {
      const q0 = supabase.from(table).select('*').limit(20);
      const q = apply ? apply(q0) : q0;
      const { data, error } = await withTimeout(`recent ${table}`, () => q);
      if (error && isMissingTable(error)) return;
      if (error) throw error;
      (data || []).forEach((row) => out.push(mapper(row, table)));
    } catch (e) {
      if (isMissingTable(e)) return;
    }
  };

  await Promise.all([
    load('failed_syncs', (q) => q.order('created_at', { ascending: false }),
      (r, t) => ({ source: t, status: String(r.status || 'FAILED'), target: String(r.source_table || r.sync_type || '-'), error: String(r.error_message || '-'), createdAt: r.created_at, updatedAt: r.last_retry_at || r.updated_at })),
    load('email_queue', (q) => q.or('status.ilike.%fail%,status.ilike.%error%').order('updated_at', { ascending: false }),
      (r, t) => ({ source: t, status: String(r.status || 'FAILED'), target: String(r.recipient_email || '-'), error: String(r.error_message || r.last_error || '-'), createdAt: r.created_at, updatedAt: r.updated_at })),
    load('scheduled_notifications', (q) => q.or('status.ilike.%fail%,status.ilike.%error%').order('updated_at', { ascending: false }),
      (r, t) => ({ source: t, status: String(r.status || 'FAILED'), target: String(r.recipient_email || r.event_type || '-'), error: String(r.error_message || r.last_error || '-'), createdAt: r.created_at, updatedAt: r.updated_at })),
    load('moodle_enrollment_sync', (q) => q.or('sync_status.ilike.%fail%,sync_status.ilike.%error%,last_error.not.is.null').order('updated_at', { ascending: false }),
      (r, t) => ({ source: t, status: String(r.sync_status || 'FAILED'), target: String(r.email || r.student_id || '-'), error: String(r.last_error || '-'), createdAt: r.created_at, updatedAt: r.updated_at })),
  ]);

  return out.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)).slice(0, 60);
}

export const fmtDateTime = (v) => {
  if (!v || v === '-') return '-';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString();
};
