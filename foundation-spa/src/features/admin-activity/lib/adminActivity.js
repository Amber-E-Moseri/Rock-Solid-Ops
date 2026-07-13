import { supabase } from '../../../supabase.js';

const PAGE_SIZE = 100;

export async function fetchActivityLogs(offset = 0) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, entity_type, entity_id, actor_email, status, details, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw error;
  return { rows: data ?? [], exhausted: (data?.length ?? 0) < PAGE_SIZE };
}

export function applyFilters(logs, filters) {
  const { actor, action, entityType, dateFrom, dateTo } = filters;
  return logs.filter((log) => {
    if (actor && !String(log.actor_email ?? '').toLowerCase().includes(actor.toLowerCase())) return false;
    if (action && log.action !== action) return false;
    if (entityType && String(log.entity_type ?? '').toLowerCase() !== entityType.toLowerCase()) return false;
    if (dateFrom && log.created_at < dateFrom) return false;
    if (dateTo && log.created_at.slice(0, 10) > dateTo) return false;
    return true;
  });
}

export function computeKpis(logs) {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const week = new Date(now - 7 * 86400000).toISOString();
  const month = new Date(now - 30 * 86400000).toISOString();
  return {
    today: logs.filter((l) => l.created_at >= midnight).length,
    week: logs.filter((l) => l.created_at >= week).length,
    month: logs.filter((l) => l.created_at >= month).length,
    total: logs.length,
  };
}

export function computeActorSummary(logs) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const recent = logs.filter((l) => l.created_at >= cutoff);
  const map = {};
  for (const log of recent) {
    const key = log.actor_email || 'system';
    if (!map[key]) map[key] = { email: key, count: 0, last: log.created_at, actions: {} };
    map[key].count++;
    if (log.created_at > map[key].last) map[key].last = log.created_at;
    map[key].actions[log.action] = (map[key].actions[log.action] || 0) + 1;
  }
  return Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((a) => ({
      ...a,
      topAction: Object.entries(a.actions).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '',
    }));
}

export function exportCsv(rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['created_at', 'actor_email', 'action', 'entity_type', 'entity_id', 'status'];
  const lines = [header.join(','), ...rows.map((r) => header.map((h) => escape(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
