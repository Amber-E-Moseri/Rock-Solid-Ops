import { supabase } from '../../../supabase.js';

export const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export const daysSince = (v) => (v ? Math.floor((Date.now() - new Date(v).getTime()) / 86400000) : null);

export async function fetchWaitlistData() {
  const [studentsRes, slotsRes, batchesRes] = await Promise.all([
    supabase.from('applicants')
      .select('id,full_name,email,fellowship_code,batch_id,availability,availability_status,registration_status,waitlisted_at,created_at,class_option_id')
      .or('availability_status.eq.NO_MATCHING_TIME,registration_status.eq.WAITLISTED')
      .not('availability_status', 'eq', 'NO_CLASS_AVAILABLE')
      .order('created_at', { ascending: true })
      .limit(500),
    supabase.from('class_slots')
      .select('class_slot_id,class_option_id,batch_id,status,current_enrolment,max_capacity')
      .order('class_option_id'),
    supabase.from('batches')
      .select('batch_id,batch_name')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const students = studentsRes.data || [];
  const slots = slotsRes.data || [];
  const batches = batchesRes.data || [];

  const slotCoIds = [...new Set(slots.map((s) => s.class_option_id).filter(Boolean))];
  const { data: cos } = await supabase.from('class_options')
    .select('class_option_id,teacher_name,day,class_time,fellowship_codes,active,enrollment_open')
    .or(`active.eq.true,class_option_id.in.(${slotCoIds.length ? slotCoIds.map((id) => `"${id}"`).join(',') : '""'})`);

  const classOptions = {};
  (cos || []).forEach((c) => { classOptions[c.class_option_id] = c; });

  return { students, slots, batches, classOptions };
}

export function computeSummary({ students, classOptions, activeBatch }) {
  const visible = students.filter((s) => !activeBatch || s.batch_id === activeBatch);
  const total = visible.length;
  const sinceOf = (s) => s.waitlisted_at || s.created_at;
  const gt7 = visible.filter((s) => (daysSince(sinceOf(s)) ?? 0) > 7).length;
  const gt14 = visible.filter((s) => (daysSince(sinceOf(s)) ?? 0) > 14).length;

  const waitingFellowships = new Set(visible.map((s) => String(s.fellowship_code || '').toUpperCase()).filter(Boolean));
  const coveredFellowships = new Set();
  for (const co of Object.values(classOptions)) {
    for (const f of co.fellowship_codes || []) coveredFellowships.add(String(f || '').toUpperCase());
  }
  const uncoveredCount = [...waitingFellowships].filter((f) => !coveredFellowships.has(f)).length;

  return { total, gt7, gt14, uncoveredCount };
}

export function filterStudents(students, { activeBatch, search, statusFilter, fellowshipFilter }) {
  const q = String(search || '').trim().toLowerCase();
  return students.filter((s) => {
    if (activeBatch && s.batch_id !== activeBatch) return false;
    if (fellowshipFilter && String(s.fellowship_code || '').toUpperCase() !== fellowshipFilter) return false;
    if (statusFilter === 'NO_MATCHING_TIME' && s.availability_status !== 'NO_MATCHING_TIME') return false;
    if (statusFilter === 'WAITLISTED' && s.registration_status !== 'WAITLISTED') return false;
    if (q) {
      const hay = `${s.full_name || ''} ${s.email || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getAssignableClassOptions(classOptions, fellowshipCode) {
  const fc = String(fellowshipCode || '').toUpperCase();
  return Object.values(classOptions)
    .filter((c) => c.active && c.enrollment_open)
    .sort((a, b) => {
      const aMatch = (a.fellowship_codes || []).map((v) => String(v || '').toUpperCase()).includes(fc);
      const bMatch = (b.fellowship_codes || []).map((v) => String(v || '').toUpperCase()).includes(fc);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return (a.teacher_name || '').localeCompare(b.teacher_name || '');
    });
}

export async function assignApplicantToClass(applicantId, classOptionId) {
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action: 'assign-applicant-admin', applicant_id: applicantId, class_option_id: classOptionId },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Assignment failed');
  return data;
}

export async function removeFromWaitlist(applicantId) {
  const { error } = await supabase.from('applicants')
    .update({ registration_status: 'INACTIVE', updated_at: new Date().toISOString() })
    .eq('id', applicantId);
  if (error) throw error;
}

export async function runWaitlistCheck() {
  const { data, error } = await supabase.functions.invoke('waitlist-processor', { body: {} });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Check failed');
  return data;
}

export async function saveSlotCapacity({ slotId, classOptionId, batchId, oldCapacity, newCapacity, newStatus, actorEmail }) {
  const { error } = await supabase.from('class_slots')
    .update({ max_capacity: newCapacity, status: newStatus })
    .eq('class_slot_id', slotId);
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    actor_email: actorEmail || null,
    action: 'SLOT_CAPACITY_UPDATED',
    entity_type: 'class_slot',
    entity_id: slotId,
    status: 'SUCCESS',
    details: { old_capacity: oldCapacity, new_capacity: newCapacity, class_option_id: classOptionId, batch_id: batchId, new_status: newStatus },
    created_at: new Date().toISOString(),
  });
}

export async function countAssignedInSlot(classOptionId, batchId) {
  const { count } = await supabase.from('applicants')
    .select('id', { count: 'exact', head: true })
    .eq('class_option_id', classOptionId).eq('batch_id', batchId).eq('registration_status', 'ASSIGNED');
  return count || 0;
}

export function fillClass(pct) {
  if (pct >= 90) return 'danger';
  if (pct >= 75) return 'warning';
  return 'success';
}
