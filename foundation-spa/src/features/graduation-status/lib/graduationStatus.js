import { supabase } from '../../../supabase.js';

export async function fetchBatches() {
  const { data, error } = await supabase
    .from('batches')
    .select('batch_id,name,active')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function fetchBatchStudents(batchId) {
  const { data, error } = await supabase
    .from('applicants')
    .select('id,full_name,email,registration_status,graduation_eligibility(gate1_attendance,gate2_moodle_complete,gate3_milestones_met,gate4_exam_passed,eligible,override_eligible,override_reason,overridden_by,last_evaluated_at)')
    .eq('batch_id', batchId)
    .not('registration_status', 'in', '("INACTIVE","DUPLICATE")')
    .order('full_name', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data || []).map(a => {
    const ge = Array.isArray(a.graduation_eligibility) ? a.graduation_eligibility[0] : a.graduation_eligibility;
    return { ...a, ge: ge || null };
  });
}

export async function evaluateBatchGraduation(batchId) {
  const { data, error } = await supabase.rpc('evaluate_batch_graduation', { p_batch_id: batchId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function overrideGraduationEligibility(applicantId, batchId, eligible, reason) {
  const { error } = await supabase.rpc('override_graduation_eligibility', {
    p_applicant_id: applicantId,
    p_batch_id: batchId,
    p_eligible: eligible,
    p_reason: reason || null,
  });
  if (error) throw error;
}

export function isEffectivelyEligible(ge) {
  if (!ge) return false;
  if (ge.override_eligible != null) return ge.override_eligible;
  return ge.eligible === true;
}

export function eligibilityLabel(ge) {
  if (!ge) return 'Not Evaluated';
  if (ge.override_eligible != null) return ge.override_eligible ? 'Eligible (Override)' : 'Not Eligible (Override)';
  if (ge.eligible) return 'Eligible';
  return 'Not Eligible';
}

export function eligibilityVariant(ge) {
  if (!ge) return 'info';
  if (ge.override_eligible != null) return 'primary';
  if (ge.eligible) return 'success';
  return 'danger';
}

export function computeSummary(rows) {
  return {
    total: rows.length,
    evaluated: rows.filter(r => r.ge != null).length,
    eligible: rows.filter(r => isEffectivelyEligible(r.ge)).length,
    overridden: rows.filter(r => r.ge?.override_eligible != null).length,
  };
}

export function filterRows(rows, { search, eligibility }) {
  const q = String(search || '').toLowerCase();
  return rows.filter(r => {
    if (q && !(r.full_name || '').toLowerCase().includes(q) && !(r.email || '').toLowerCase().includes(q)) return false;
    if (eligibility === 'eligible' && !isEffectivelyEligible(r.ge)) return false;
    if (eligibility === 'not_eligible' && (isEffectivelyEligible(r.ge) || r.ge?.override_eligible != null)) return false;
    if (eligibility === 'override' && r.ge?.override_eligible == null) return false;
    return true;
  });
}

export function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}
