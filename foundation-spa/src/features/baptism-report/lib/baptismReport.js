import { supabase } from '../../../supabase.js';

export async function fetchBaptismData() {
  const [appsRes, fellowshipRes, classRes, slotsRes, batchRes] = await Promise.all([
    supabase
      .from('applicants')
      .select('id,full_name,email,fellowship_code,class_option_id,born_again,speaks_in_tongues,water_baptized,registration_status')
      .in('registration_status', ['ASSIGNED', 'ENROLLED', 'WAITLISTED'])
      .order('fellowship_code', { ascending: true })
      .order('full_name', { ascending: true }),
    supabase.from('fellowship_map').select('fellowship_code,campus_name,group_id,subgroup_id'),
    supabase.from('class_options').select('class_option_id,day,class_time,group_id,fellowship_codes'),
    supabase.from('class_slots').select('class_option_id,batch_id,status,created_at').eq('status', 'Active').order('created_at', { ascending: false }),
    supabase.from('batches').select('batch_id,batch_name,status').eq('status', 'Active').order('batch_name', { ascending: true }),
  ]);
  if (appsRes.error) throw appsRes.error;
  if (fellowshipRes.error) throw fellowshipRes.error;
  if (classRes.error) throw classRes.error;
  if (slotsRes.error) throw slotsRes.error;
  if (batchRes.error) throw batchRes.error;

  const fellowshipMap = new Map();
  (fellowshipRes.data || []).forEach(f => {
    const code = String(f.fellowship_code || '');
    if (code) fellowshipMap.set(code, String(f.campus_name || f.group_id || f.subgroup_id || code));
  });

  const classMap = new Map();
  (classRes.data || []).forEach(c => classMap.set(String(c.class_option_id || ''), c));

  const classBatchMap = new Map();
  (slotsRes.data || []).forEach(s => {
    const key = String(s.class_option_id || '');
    if (key && !classBatchMap.has(key)) classBatchMap.set(key, String(s.batch_id || ''));
  });

  return {
    applicants: appsRes.data || [],
    fellowshipMap,
    classMap,
    classBatchMap,
    batches: batchRes.data || [],
  };
}

export function asFaith(v) {
  const t = String(v || '').trim();
  return t || "I'm not sure";
}

export function faithVariant(v) {
  const x = asFaith(v);
  if (x === 'Yes') return 'success';
  if (x === 'No') return 'danger';
  return 'warning';
}

export function faithLabel(v) {
  const x = asFaith(v);
  return x === "I'm not sure" ? 'Not Sure' : x;
}

export function filterApplicants(applicants, { fellowship, batch, water, born }, classBatchMap) {
  return applicants.filter(a => {
    const fellowshipCode = String(a.fellowship_code || '');
    const batchId = classBatchMap.get(String(a.class_option_id || '')) || '';
    if (fellowship && fellowshipCode !== fellowship) return false;
    if (batch && String(batchId) !== batch) return false;
    if (water && asFaith(a.water_baptized) !== water) return false;
    if (born && asFaith(a.born_again) !== born) return false;
    return true;
  });
}

export function computeKpis(rows) {
  return {
    total: rows.length,
    needBaptism: rows.filter(r => { const v = asFaith(r.water_baptized); return v === 'No' || v === "I'm not sure"; }).length,
    notBorn: rows.filter(r => { const v = asFaith(r.born_again); return v === 'No' || v === "I'm not sure"; }).length,
    tongues: rows.filter(r => asFaith(r.speaks_in_tongues) === 'Yes').length,
  };
}

export function getFilterOptions(applicants, fellowshipMap) {
  const fellowships = [...new Set(applicants.map(a => String(a.fellowship_code || '')).filter(Boolean))].sort();
  return fellowships.map(code => ({ code, label: fellowshipMap.get(code) || code }));
}

export function buildCsv(rows, fellowshipMap, classMap) {
  const headers = ['Name', 'Email', 'Fellowship', 'Class', 'Born Again', 'Speaks in Tongues', 'Water Baptized', 'Status'];
  const lines = rows.map(a => {
    const fellowship = fellowshipMap.get(String(a.fellowship_code || '')) || a.fellowship_code || '';
    const classOptionId = String(a.class_option_id || '');
    const classInfo = classMap.get(classOptionId);
    const classLabel = classInfo ? `${classOptionId} ${classInfo.day || ''} ${classInfo.class_time || ''}`.trim() : classOptionId;
    return [a.full_name || '', a.email || '', fellowship, classLabel, asFaith(a.born_again), asFaith(a.speaks_in_tongues), asFaith(a.water_baptized), a.registration_status || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
  });
  return [headers.join(','), ...lines].join('\n');
}
