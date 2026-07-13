import { supabase } from '../../../supabase.js';

const PAGE_SIZE = 25;

function classifyCategory(action) {
  const a = String(action || '').toUpperCase();
  if (a.includes('ATTEND')) return 'attendance';
  if (a.includes('BATCH') || a.includes('CLASS')) return 'batch';
  if (a.includes('REGISTR') || a.includes('ENROLL')) return 'registration';
  if (a.includes('ROLE') || a.includes('PERM') || a.includes('AUTH')) return 'roles';
  if (a.includes('SYNC') || a.includes('MOODLE') || a.includes('MAILCHIMP')) return 'sync';
  if (a.includes('EMAIL') || a.includes('CAMPAIGN') || a.includes('MESSAGE') || a.includes('NOTIFY') || a.includes('COMM')) return 'comms';
  return 'admin';
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return null;
}

function resolveStatus(row) {
  const raw = String(pick(row, 'status', 'result', 'outcome') || 'success').toLowerCase();
  if (raw.includes('error') || raw.includes('fail')) return 'error';
  if (raw.includes('pending') || raw.includes('wait')) return 'pending';
  if (raw.includes('success') || raw.includes('ok')) return 'success';
  return 'neutral';
}

export function normalizeRow(row) {
  return {
    id: row.id,
    actor: pick(row, 'actor_email', 'actor', 'changed_by', 'created_by', 'user_email') || 'system',
    action: pick(row, 'action', 'event', 'type') || '',
    entityId: pick(row, 'entity_id', 'target_id', 'resource_id') || '',
    entityType: row.entity_type || '',
    category: classifyCategory(pick(row, 'action', 'event', 'type')),
    timestamp: pick(row, 'created_at', 'logged_at', 'inserted_at', 'timestamp'),
    status: resolveStatus(row),
    rawStatus: pick(row, 'status', 'result', 'outcome') || 'success',
    details: row.details || row.payload || row.meta || row.notes || null,
    raw: row,
  };
}

export const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'batch', label: 'Batch / Class' },
  { value: 'registration', label: 'Registration' },
  { value: 'roles', label: 'Roles / Auth' },
  { value: 'sync', label: 'Sync / Moodle' },
  { value: 'comms', label: 'Comms / Email' },
  { value: 'admin', label: 'Admin (other)' },
];

export const DATE_RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '', label: 'All time' },
];

export async function fetchAuditLogs({ search, actor, dateRange, category, page }) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(
      `action.ilike.%${search}%,actor_email.ilike.%${search}%,entity_id.ilike.%${search}%,entity_type.ilike.%${search}%`
    );
  }

  if (actor) {
    query = query.eq('actor_email', actor);
  }

  if (dateRange) {
    const days = parseInt(dateRange);
    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      query = query.gte('created_at', cutoff);
    }
  }

  const { data, error, count } = await query;

  if (error) throw error;

  let rows = (data || []).map(normalizeRow);

  // Category is client-side filter (matches legacy behavior)
  if (category) {
    rows = rows.filter((r) => r.category === category);
  }

  return {
    rows,
    total: count || 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil((count || 0) / PAGE_SIZE),
  };
}

export async function fetchActors() {
  const { data } = await supabase
    .from('audit_logs')
    .select('actor_email')
    .order('actor_email')
    .limit(500);

  const unique = [...new Set((data || []).map((r) => r.actor_email).filter(Boolean))];
  return unique.sort();
}
