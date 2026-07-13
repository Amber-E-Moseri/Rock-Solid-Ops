import { supabase } from '../../../supabase.js';

export async function fetchMilestoneData() {
  const [apps, classes, defs, statuses] = await Promise.all([
    supabase.from('applicants').select('*').limit(6000),
    supabase.from('class_options').select('*').limit(2000),
    supabase.from('milestone_definitions').select('*').order('sort_order', { ascending: true }),
    supabase.from('student_milestone_status').select('*').limit(30000),
  ]);

  if (apps.error || classes.error) {
    throw new Error(apps.error?.message || classes.error?.message || 'Failed to load data.');
  }

  return {
    applicants: apps.data || [],
    classOptions: classes.data || [],
    milestoneDefs: defs.error ? [] : (defs.data || []),
    milestoneStatus: statuses.error ? [] : (statuses.data || []),
    milestonesReady: !(defs.error || statuses.error),
  };
}

export function activeDefinitions(defs) {
  return defs
    .filter((item) => item.is_active !== false)
    .sort((a, b) => {
      const aOrder = a.sort_order ?? a.class_session_number ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.sort_order ?? b.class_session_number ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
}

const isCompleted = (item) => String(item.status || 'pending') === 'completed';

export function buildCompletionIndex(statusRows) {
  const byApplicant = new Map();
  for (const item of statusRows) {
    if (!isCompleted(item)) continue;
    const id = String(item.applicant_id || item.student_id || '');
    if (!id) continue;
    if (!byApplicant.has(id)) byApplicant.set(id, new Set());
    byApplicant.get(id).add(String(item.milestone_code || ''));
  }
  return byApplicant;
}

export const completedCodes = (index, applicantId) => index.get(String(applicantId)) || new Set();

export function filterApplicants(applicants, index, defs, { search, fellowship, classOption, milestone, status }) {
  return applicants.filter((a) => {
    const text = `${a.full_name || ''} ${a.email || ''}`.toLowerCase();
    const done = completedCodes(index, a.id);
    if (search && !text.includes(search.toLowerCase())) return false;
    if (fellowship && String(a.fellowship_code || a.fellowship || a.subgroup_id || '') !== fellowship) return false;
    if (classOption && String(a.class_option_id || '') !== classOption) return false;
    if (milestone && !done.has(milestone)) return false;
    if (status === 'completed' && !done.size) return false;
    if (status === 'pending' && done.size === defs.length) return false;
    return true;
  });
}

export function summarize(applicants, index, defs) {
  const fullyComplete = applicants.filter((a) => defs.length && completedCodes(index, a.id).size === defs.length).length;
  const zeroProgress = applicants.filter((a) => completedCodes(index, a.id).size === 0).length;
  const average = applicants.length && defs.length
    ? Math.round(applicants.reduce((sum, a) => sum + completedCodes(index, a.id).size / defs.length, 0) / applicants.length * 100)
    : 0;
  return { milestones: defs.length, fullyComplete, average, zeroProgress };
}

export async function toggleMilestone({ applicantId, milestoneCode, currentlyCompleted, actorEmail }) {
  const now = new Date().toISOString();
  const nextCompleted = !currentlyCompleted;
  const payload = {
    applicant_id: String(applicantId),
    student_id: String(applicantId),
    milestone_code: String(milestoneCode),
    status: nextCompleted ? 'completed' : 'pending',
    completed_at: nextCompleted ? now : null,
    completed_by: nextCompleted ? (actorEmail || null) : null,
    updated_at: now,
    updated_by: actorEmail || null,
  };

  const { error } = await supabase.from('student_milestone_status').upsert(payload, { onConflict: 'applicant_id,milestone_code' });
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: 'MILESTONE_STATUS_UPDATED',
    entity_type: 'student_milestone_status',
    entity_id: `${applicantId}:${milestoneCode}`,
    actor_email: actorEmail,
    status: 'SUCCESS',
    details: { applicant_id: applicantId, milestone_code: milestoneCode, completed: nextCompleted },
    created_at: now,
  });
  return nextCompleted;
}

export async function saveDefinition({ label, sessionNumber, defsCount }) {
  const code = String(label).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!code || !label.trim()) throw new Error('Code and label are required.');
  const classSessionNumber = Number.isFinite(Number(sessionNumber)) && sessionNumber !== '' ? Number(sessionNumber) : null;
  const payload = {
    code,
    label: label.trim(),
    class_session_number: classSessionNumber,
    is_active: true,
    is_required: true,
    sort_order: classSessionNumber ?? defsCount + 1,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('milestone_definitions').upsert(payload, { onConflict: 'code' });
  if (error) throw error;
}

export function defaultDescription(item) {
  if (item.class_session_number) return `Completed in class ${item.class_session_number}`;
  return String(item.code || 'Milestone').replace(/_/g, ' ').toLowerCase();
}
