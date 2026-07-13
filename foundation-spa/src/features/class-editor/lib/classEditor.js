import { supabase } from '../../../supabase.js';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Helpers (mirror class-editor.html) ───────────────────────────────────────

const idPart = (input, fallback = 'X') => {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean || fallback;
};

export function generateSharedClassId(subgroupId, teacherId, day, time) {
  return `CO-${idPart(subgroupId, 'SG')}-${day ? idPart(day.slice(0, 3), 'DAY') : 'DAY'}-${time ? time.replace(':', '') : '0000'}-${teacherId ? idPart(String(teacherId).slice(0, 8), 'XXXX') : 'XXXX'}`;
}

export function generateSeparateClassId(fellowshipCode, teacherId, day, time) {
  return `CO-${idPart(fellowshipCode, 'REGIONAL')}-${day ? idPart(day.slice(0, 3), 'DAY') : 'DAY'}-${time ? time.replace(':', '') : '0000'}-${teacherId ? idPart(String(teacherId).slice(0, 8), 'XXXX') : 'XXXX'}`;
}

export const normalizedCodes = (codes) => [...new Set((codes || []).map((v) => String(v || '').trim()).filter(Boolean))];

export function enforceCodesForOnlineMode(codes, isOnline) {
  const clean = normalizedCodes(codes);
  return isOnline ? clean : (clean.length ? [clean[0]] : []);
}

export function fmtTime(v) {
  if (!v) return '—';
  const [hour, minute] = String(v).split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute || 0).padStart(2, '0')} ${suffix}`;
}

export function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Data ─────────────────────────────────────────────────────────────────────

export async function fetchClassEditorData() {
  const [classRes, teacherRes, fcRes, batchRes, slotRes, applicantsRes] = await Promise.all([
    supabase.from('class_options').select('*').is('deleted_at', null).order('class_option_id').limit(500),
    supabase.from('teachers').select('teacher_id,full_name,email,group_id,subgroup_id').eq('status', 'ACTIVE').order('full_name').limit(200),
    supabase.from('fellowship_map').select('fellowship_code,campus_name,group_id').eq('active', true).order('fellowship_code').limit(200),
    supabase.from('batches').select('batch_id,batch_name').order('created_at', { ascending: false }).limit(50),
    supabase.from('class_slots').select('class_option_id,batch_id').limit(2000),
    supabase.from('applicants').select('class_option_id').eq('registration_status', 'ASSIGNED').limit(20000),
  ]);

  const slotBatches = {};
  (slotRes.data || []).forEach((s) => {
    slotBatches[s.class_option_id] = slotBatches[s.class_option_id] || [];
    if (!slotBatches[s.class_option_id].includes(s.batch_id)) slotBatches[s.class_option_id].push(s.batch_id);
  });
  const enrolled = {};
  (applicantsRes.data || []).forEach((a) => {
    const id = String(a.class_option_id || '').trim();
    if (id) enrolled[id] = (enrolled[id] || 0) + 1;
  });

  return {
    classes: classRes.data || [],
    teachers: teacherRes.data || [],
    fellowships: fcRes.data || [],
    batches: batchRes.data || [],
    slotBatches,
    enrolled,
  };
}

// ── Mutations (mirror legacy exactly) ────────────────────────────────────────

export async function saveClassEdit({ coId, updates, teacher, nextBatch, currentBatches, enrolledCount, actorEmail, oldDay, oldTime, sendTimeChangeNotice }) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('class_options').update({ ...updates, updated_by: actorEmail || null, updated_at: now }).eq('class_option_id', coId);
  if (error) throw error;

  if (teacher?.full_name) {
    await supabase.from('class_slots').update({ teacher_name: teacher.full_name }).eq('class_option_id', coId);
  }

  if (nextBatch && (currentBatches.length !== 1 || currentBatches[0] !== nextBatch)) {
    await supabase.from('class_slots').delete().eq('class_option_id', coId);
    await supabase.from('class_slots').insert({
      class_slot_id: `${coId}-${nextBatch}`,
      class_option_id: coId,
      batch_id: nextBatch,
      teacher_name: teacher?.full_name || null,
      group_id: teacher?.group_id || null,
      subgroup_id: teacher?.subgroup_id || null,
      status: 'Active',
      current_enrolment: enrolledCount || 0,
      max_capacity: updates.max_capacity,
      created_by: actorEmail || null,
      updated_by: actorEmail || null,
    });
  }

  const timeChanged = updates.day !== oldDay || updates.class_time !== oldTime;
  let notifSent = false;
  if (timeChanged && sendTimeChangeNotice) {
    const { data: enrolledRows } = await supabase.from('applicants').select('id,full_name,email').eq('class_option_id', coId).eq('registration_status', 'ASSIGNED');
    const emailRows = (enrolledRows || []).map((ap) => ({
      recipient_email: ap.email,
      recipient_name: ap.full_name || '',
      template_key: 'class_time_changed',
      subject: 'Update: Your Rock Solid class time has changed',
      status: 'Pending',
      payload: {
        first_name: String(ap.full_name || 'Student').split(/\s+/)[0],
        full_name: ap.full_name,
        teacher_name: teacher?.full_name || updates.teacher_name || '',
        old_day: oldDay, old_time: oldTime, new_day: updates.day, new_time: updates.class_time,
      },
    }));
    if (emailRows.length) await supabase.from('email_queue').insert(emailRows);
    notifSent = emailRows.length > 0;
  }

  await supabase.from('audit_logs').insert({
    actor_email: actorEmail || null, action: 'CLASS_OPTION_UPDATED', entity_type: 'class_option', entity_id: coId,
    status: 'SUCCESS', details: { changed_fields: Object.keys(updates), time_changed: timeChanged, notification_sent: notifSent }, created_at: now,
  });
  return { timeChanged, notifSent };
}

export async function countEnrolled(coId) {
  const { count } = await supabase.from('applicants').select('id', { count: 'exact', head: true }).eq('class_option_id', coId).eq('registration_status', 'ASSIGNED');
  return count || 0;
}

export async function createClass({ form, teacher, actorEmail }) {
  const now = new Date().toISOString();
  const { teacherId, day, time, capacity, batchId, suffix, expiry, isOnline, active, enrollOpen, fc, mode, customId } = form;

  const baseRow = {
    teacher_id: teacherId,
    teacher_name: teacher?.full_name || null,
    day, class_time: time, max_capacity: capacity, label_suffix: suffix,
    enrollment_closes_at: expiry ? new Date(expiry).toISOString() : null,
    active, enrollment_open: enrollOpen, is_online: isOnline,
    group_id: teacher?.group_id || null, subgroup_id: teacher?.subgroup_id || null,
    created_by: actorEmail || null, updated_by: actorEmail || null, created_at: now, updated_at: now,
  };

  const makeSlot = (classId) => ({
    class_slot_id: `${classId}-${batchId}`, class_option_id: classId, batch_id: batchId,
    teacher_name: teacher?.full_name || null, group_id: teacher?.group_id || null, subgroup_id: teacher?.subgroup_id || null,
    status: 'Active', current_enrolment: 0, max_capacity: capacity, created_by: actorEmail || null, updated_by: actorEmail || null,
  });

  if (isOnline && fc.length > 1 && mode === 'separate') {
    const rows = fc.map((code) => ({ ...baseRow, class_option_id: generateSeparateClassId(code, teacherId, day, time), fellowship_codes: [code] }));
    const { error } = await supabase.from('class_options').insert(rows);
    if (error) throw error;
    if (batchId) {
      const { error: slotErr } = await supabase.from('class_slots').insert(rows.map((r) => makeSlot(r.class_option_id)));
      if (slotErr) throw slotErr;
    }
    await supabase.from('audit_logs').insert(rows.map((r) => ({
      actor_email: actorEmail || null, action: 'CLASS_OPTION_CREATED', entity_type: 'class_option', entity_id: r.class_option_id,
      status: 'SUCCESS', details: { teacher_name: teacher?.full_name, day, class_time: time, batch_id: batchId, fellowship_code: r.fellowship_codes[0], mode: 'separate' }, created_at: now,
    })));
    return { created: fc.length, mode: 'separate' };
  }

  const classId = customId || generateSharedClassId(teacher?.subgroup_id || 'SG', teacherId, day, time);
  const { error } = await supabase.from('class_options').insert({ ...baseRow, class_option_id: classId, fellowship_codes: fc });
  if (error) throw error;
  if (batchId) {
    const { error: slotErr } = await supabase.from('class_slots').insert(makeSlot(classId));
    if (slotErr) throw slotErr;
  }
  await supabase.from('audit_logs').insert({
    actor_email: actorEmail || null, action: 'CLASS_OPTION_CREATED', entity_type: 'class_option', entity_id: classId,
    status: 'SUCCESS', details: { teacher_name: teacher?.full_name, day, class_time: time, batch_id: batchId, fellowship_codes: fc, mode: 'shared' }, created_at: now,
  });
  return { created: 1, mode: 'shared', classId };
}

export async function splitSharedClass({ source, actorEmail }) {
  const codes = source.fellowship_codes || [];
  if (codes.length < 2) throw new Error('Class has fewer than two fellowship codes.');
  const now = new Date().toISOString();
  const rows = codes.map((code) => ({
    class_option_id: generateSeparateClassId(code, source.teacher_id || '', source.day || '', source.class_time || ''),
    teacher_id: source.teacher_id, teacher_name: source.teacher_name, day: source.day, class_time: source.class_time,
    max_capacity: source.max_capacity, label_suffix: source.label_suffix, active: true,
    enrollment_open: source.enrollment_open !== false, fellowship_codes: [code],
    group_id: source.group_id, subgroup_id: source.subgroup_id,
    created_by: actorEmail || null, updated_by: actorEmail || null, created_at: now, updated_at: now,
  }));
  const { error } = await supabase.from('class_options').insert(rows);
  if (error) throw new Error(`Split failed: ${error.message}`);

  const { data: sourceSlots } = await supabase.from('class_slots').select('*').eq('class_option_id', source.class_option_id);
  if (sourceSlots?.length) {
    const slotRows = [];
    for (const row of rows) for (const s of sourceSlots) slotRows.push({
      class_slot_id: `${row.class_option_id}-${s.batch_id}`, class_option_id: row.class_option_id, batch_id: s.batch_id,
      teacher_name: row.teacher_name, group_id: row.group_id, subgroup_id: row.subgroup_id,
      status: s.status || 'Active', current_enrolment: 0, max_capacity: row.max_capacity,
      created_by: actorEmail || null, updated_by: actorEmail || null,
    });
    const { error: slotErr } = await supabase.from('class_slots').insert(slotRows);
    if (slotErr) throw new Error(`Split slot creation failed: ${slotErr.message}`);
  }

  await supabase.from('class_options').update({ active: false, enrollment_open: false, updated_by: actorEmail || null, updated_at: now }).eq('class_option_id', source.class_option_id);
  await supabase.from('audit_logs').insert({
    actor_email: actorEmail || null, action: 'CLASS_OPTION_SPLIT', entity_type: 'class_option', entity_id: source.class_option_id,
    status: 'SUCCESS', details: { source_class_option_id: source.class_option_id, fellowship_codes: codes, new_class_option_ids: rows.map((r) => r.class_option_id) }, created_at: now,
  });
  return rows.length;
}

export async function duplicateClass({ source, actorEmail }) {
  const newId = `${source.class_option_id}-COPY`;
  const { error } = await supabase.from('class_options').insert({
    ...source, class_option_id: newId,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    deleted_at: null, created_by: actorEmail || null,
  });
  if (error) throw error;
  return newId;
}

export async function softDeleteClass(coId) {
  const { error } = await supabase.from('class_options').update({ deleted_at: new Date().toISOString(), active: false }).eq('class_option_id', coId);
  if (error) throw error;
}

export async function massSetActive(ids, active) {
  const { error } = await supabase.from('class_options').update({ active, enrollment_open: active }).in('class_option_id', ids);
  if (error) throw error;
}

export async function massSetExpiry(ids, expiryVal) {
  const { error } = await supabase.from('class_options')
    .update({ enrollment_closes_at: expiryVal ? new Date(expiryVal).toISOString() : null })
    .in('class_option_id', ids);
  if (error) throw error;
}
