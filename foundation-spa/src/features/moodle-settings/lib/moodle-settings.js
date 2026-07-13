import { supabase } from '../../../supabase.js';

export function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function normalizeMappingRow(r) {
  return {
    id: r.id || `${r.batch_id || ''}:${r.group_id || ''}`,
    batch_id: r.batch_id || '',
    group_id: r.group_id || r.subgroup_id || '',
    moodle_course_id: r.moodle_course_id || r.course_id || '',
    active: r.active !== false,
    updated_at: r.updated_at || r.created_at || null,
  };
}

export async function fetchMappings() {
  const { data, error } = await supabase
    .from('batch_moodle_courses')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).map(normalizeMappingRow);
}

export function validateMapping({ batchId, groupId, courseId }) {
  if (!batchId || !groupId || !courseId) return 'Batch, group/subgroup, and course ID are required.';
  if (!/^\d+$/.test(courseId)) return 'Moodle course ID must be numeric.';
  return null;
}

export async function saveMapping({ batchId, groupId, courseId, active }) {
  const payload = {
    batch_id: batchId,
    group_id: groupId,
    moodle_course_id: Number(courseId),
    active,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('batch_moodle_courses').upsert(payload, { onConflict: 'batch_id,group_id' });
  if (error) throw error;
}

export async function seedMissing(existingMappings) {
  const [fm, batches] = await Promise.all([
    supabase.from('fellowship_map').select('group_id,subgroup_id').eq('active', true),
    supabase.from('batches').select('batch_id').eq('active', true).limit(20),
  ]);
  if (fm.error) throw fm.error;
  if (batches.error) throw batches.error;

  const activeBatchIds = (batches.data || []).map((b) => b.batch_id).filter(Boolean);
  if (!activeBatchIds.length) throw new Error('No active batches found.');

  const groups = [...new Set((fm.data || []).map((r) => r.group_id).filter(Boolean))];
  const desired = [];
  activeBatchIds.forEach((batch_id) => groups.forEach((group_id) => desired.push({ batch_id, group_id })));

  const existingKeys = new Set(existingMappings.map((m) => `${m.batch_id}::${m.group_id}`));
  const inserts = desired
    .filter((d) => !existingKeys.has(`${d.batch_id}::${d.group_id}`))
    .map((d) => ({ batch_id: d.batch_id, group_id: d.group_id, moodle_course_id: null, active: false }));

  if (!inserts.length) return 0;

  const { error } = await supabase.from('batch_moodle_courses').insert(inserts);
  if (error) throw error;
  return inserts.length;
}

export async function testMoodleConnection() {
  const { data, error } = await supabase.functions.invoke('moodle-sync', { body: { action: 'test' } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Connection test failed.');
  return data;
}
