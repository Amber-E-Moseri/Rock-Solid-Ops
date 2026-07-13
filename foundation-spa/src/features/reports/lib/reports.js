import { supabase } from '../../../supabase.js';

export async function fetchBatches() {
  const { data, error } = await supabase.from('batches')
    .select('batch_id, batch_name, active')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function fetchScopeOptions() {
  const { data, error } = await supabase.from('fellowship_map')
    .select('group_id, subgroup_id, campus_name')
    .eq('active', true).limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function fetchArchive() {
  const { data, error } = await supabase.from('report_archive')
    .select('*')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function generateReport(payload) {
  const { data, error } = await supabase.functions.invoke('report-generator', { body: payload });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.message || 'Report generation failed');
  return data;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return String(ts); }
}

export function uniqueGroups(scopeData) {
  return [...new Set(scopeData.map((s) => s.group_id).filter(Boolean))].sort();
}

export function uniqueSubgroups(scopeData) {
  return [...new Set(scopeData.map((s) => s.subgroup_id).filter(Boolean))].sort();
}
