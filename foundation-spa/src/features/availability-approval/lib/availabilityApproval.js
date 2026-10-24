import { supabase } from '../../../supabase.js';
import { APPROVAL_CERTIFIED, APPROVAL_HOLD_MESSAGE } from '../../../releaseHolds.js';

// Slot model: one row of public.teacher_availability per teacher, batch, day and time slot.
// Columns verified against the authoritative migrations (000_baseline_squash, 202605071200,
// 202605191700) and against staging. No submission-level fields (name, month, slots[], review_note,
// reviewed_at, reviewed_by) exist here, and this module does not write any.
export const SLOT_COLUMNS = [
  'id', 'teacher_id', 'batch_id', 'day', 'time_slot', 'status', 'notes',
  'class_option_id', 'selected_fellowship_codes', 'campus_selection_review_needed',
  'class_option_sync_status', 'class_option_sync_error', 'created_at', 'updated_at',
].join(', ');

// Mirrors is_superadmin() / is_admin() in the migrations. The RPC enforces this server-side;
// the UI uses it only to decide whether to show the approve action.
export const APPROVER_ROLES = ['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal'];

const DAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const READ_LIMIT = 1000;

export async function fetchAvailabilitySlots() {
  const { data: slots, error } = await supabase
    .from('teacher_availability')
    .select(SLOT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(READ_LIMIT);
  if (error) throw error;

  const teacherIds = [...new Set((slots || []).map((s) => s.teacher_id).filter(Boolean))];
  let teachers = [];
  if (teacherIds.length) {
    const { data, error: teacherError } = await supabase
      .from('teachers')
      .select('teacher_id, full_name, email')
      .in('teacher_id', teacherIds)
      .limit(READ_LIMIT);
    if (teacherError) throw teacherError;
    teachers = data || [];
  }
  const byId = new Map(teachers.map((t) => [t.teacher_id, t]));

  return (slots || []).map((s) => {
    const teacher = byId.get(s.teacher_id);
    return {
      ...s,
      teacher_full_name: teacher?.full_name || null,
      teacher_email: teacher?.email || null,
    };
  });
}

export function statusInfo(status) {
  switch (status) {
    case 'Tentative': return { key: 'awaiting', label: 'Awaiting approval', variant: 'warning' };
    case 'Available': return { key: 'approved', label: 'Approved', variant: 'success' };
    case 'Unavailable': return { key: 'unavailable', label: 'Unavailable', variant: 'neutral' };
    default: return { key: 'other', label: status || 'No status', variant: 'info' };
  }
}

export function dayIndex(day) {
  const i = DAY_ORDER.indexOf(day);
  return i === -1 ? DAY_ORDER.length : i;
}

export function formatTime(timeSlot) {
  return timeSlot ? String(timeSlot).slice(0, 5) : '—';
}

export function groupSlots(slots) {
  const groups = new Map();
  for (const s of slots) {
    const key = `${s.teacher_id}|${s.batch_id || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        teacher_id: s.teacher_id,
        teacher_name: s.teacher_full_name || null,
        teacher_email: s.teacher_email || null,
        batch_id: s.batch_id || null,
        slots: [],
      });
    }
    groups.get(key).slots.push(s);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      slots: [...g.slots].sort((a, b) => (dayIndex(a.day) - dayIndex(b.day))
        || String(a.time_slot || '').localeCompare(String(b.time_slot || ''))),
    }))
    .sort((a, b) => String(a.teacher_name || a.teacher_email || a.teacher_id).localeCompare(
      String(b.teacher_name || b.teacher_email || b.teacher_id),
    ) || String(a.batch_id || '').localeCompare(String(b.batch_id || '')));
}

export function computeKpis(slots) {
  return {
    teachers: new Set(slots.map((s) => s.teacher_id).filter(Boolean)).size,
    slots: slots.length,
    awaiting: slots.filter((s) => statusInfo(s.status).key === 'awaiting').length,
    approved: slots.filter((s) => statusInfo(s.status).key === 'approved').length,
  };
}

export function filterSlots(slots, { search = '', status = '' }) {
  const q = String(search).trim().toLowerCase();
  return slots.filter((s) => {
    if (status && statusInfo(s.status).key !== status) return false;
    if (q) {
      const hay = [s.teacher_full_name, s.teacher_email, s.teacher_id].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Approval gate and hold wording live in releaseHolds.js (single source). While
// APPROVAL_CERTIFIED is false the page shows Approve disabled and approveSlot refuses the RPC.
export { APPROVAL_CERTIFIED, APPROVAL_HOLD_MESSAGE };

export function canApprove(slot, role) {
  return APPROVER_ROLES.includes(role) && statusInfo(slot.status).key === 'awaiting';
}

export function approvalAvailable(slot, role) {
  return APPROVAL_CERTIFIED && canApprove(slot, role);
}

export async function approveSlot({ id, actorEmail, actorId }) {
  if (!APPROVAL_CERTIFIED) throw new Error(APPROVAL_HOLD_MESSAGE);
  return callApprovalRpc({ id, actorEmail, actorId });
}

// Direct wrapper for the existing atomic RPC, called once per slot. It creates the class option and class
// slot and sets status to Available. Exported for the contract tests only; the page must call approveSlot.
export async function callApprovalRpc({ id, actorEmail, actorId }) {
  const { data, error } = await supabase.rpc('approve_teacher_availability_atomic', {
    p_availability_id: id,
    p_actor_email: actorEmail || null,
    p_actor_id: actorId || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.ok !== true) {
    throw new Error(row?.error || 'Approval was not completed.');
  }
  return { classOptionId: row.class_option_id, classSlotId: row.class_slot_id };
}

// Retired submission-model write. The slot model above replaces it. Kept as a fail-closed
// entry point so older callers and the release-hold tests see a refusal, never a write.
export async function setSubmissionStatus() {
  throw new Error(APPROVAL_HOLD_MESSAGE);
}
