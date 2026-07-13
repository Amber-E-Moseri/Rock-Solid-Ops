import { supabase } from '../../../supabase.js';

export async function fetchBatches() {
  const [batchRes, countRes, moodleRes] = await Promise.all([
    supabase.from('batches').select('*').order('created_at', { ascending: false }),
    supabase.from('applicants').select('batch_id, status').not('batch_id', 'is', null).limit(5000),
    queryWithFallback(['moodle_courses', 'batch_moodle_courses'], '*', 500),
  ]);
  if (batchRes.error) throw batchRes.error;

  const counts = {};
  for (const a of countRes.data ?? []) {
    if (!counts[a.batch_id]) counts[a.batch_id] = 0;
    counts[a.batch_id]++;
  }

  return {
    batches: batchRes.data ?? [],
    counts,
    moodleCourses: moodleRes,
  };
}

async function queryWithFallback(tables, select, limit) {
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select(select).limit(limit);
    if (!error && data) return data;
  }
  return [];
}

export async function fetchFellowshipMap() {
  const { data } = await supabase.from('fellowship_map')
    .select('fellowship_code, campus_name, subgroup_id, group_id')
    .eq('active', true).order('campus_name');
  return data ?? [];
}

export async function fetchSubgroups() {
  const { data } = await supabase.from('fellowship_map')
    .select('subgroup_id').eq('active', true);
  return [...new Set((data ?? []).map((d) => d.subgroup_id).filter(Boolean))].sort();
}

export async function fetchCampusSettings(batchId) {
  const { data } = await supabase.from('batch_campus_registration_settings')
    .select('*').eq('batch_id', batchId);
  return data ?? [];
}

export async function fetchClassSlots(batchId) {
  const { data, error } = await supabase.from('class_slots')
    .select('class_slot_id, batch_id, teacher_name, status, current_enrolment, max_capacity, class_options(class_option_id, fellowship_codes, day, class_time, enrollment_open, active)')
    .eq('batch_id', batchId).eq('status', 'Active').order('teacher_name');
  if (error) throw error;
  return data ?? [];
}

export async function upsertBatch(values) {
  const now = new Date().toISOString();
  const payload = { ...values, updated_at: now };
  const { error } = await supabase.from('batches').upsert(payload, { onConflict: 'batch_id' });
  if (error) throw error;
}

export async function archiveBatch(batchId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('batches').update({
    active: false, archived: true, archived_at: now, registration_open: false, status: 'Archived', updated_at: now,
  }).eq('batch_id', batchId);
  if (error) throw error;
}

export async function deleteBatch(batchId) {
  const { error } = await supabase.from('batches').delete().eq('batch_id', batchId);
  if (error) throw error;
}

export async function closeBatch(batchId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('batches').update({
    active: false, status: 'Completed', updated_at: now,
  }).eq('batch_id', batchId);
  if (error) throw error;
}

export async function reopenBatch(batchId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('batches').update({
    active: true, status: 'Active', archived: false, archived_at: null, updated_at: now,
  }).eq('batch_id', batchId);
  if (error) throw error;
}

export async function rolloverBatch(source, newValues, message) {
  const now = new Date().toISOString();
  const { error: insertErr } = await supabase.from('batches').insert({
    ...newValues, status: 'Active', active: true, archived: false, created_at: now, updated_at: now,
  });
  if (insertErr) throw insertErr;

  if (message) {
    const { data: students } = await supabase.from('students')
      .select('email, full_name').eq('batch_id', source.batch_id).limit(500);
    if (students?.length > 0) {
      const emails = students.map((s) => ({
        recipient_email: s.email, recipient_name: s.full_name,
        template_key: 'batch_rollover_notice', subject: `New batch: ${newValues.batch_name}`,
        status: 'Pending',
        payload: { full_name: s.full_name, new_batch_id: newValues.batch_id, new_batch_name: newValues.batch_name, start_date: newValues.start_date, end_date: newValues.end_date, message },
      }));
      await supabase.from('email_queue').insert(emails);
    }
  }
}

export async function announceBatch(batchId, subject, message, sendTo) {
  const recipients = [];
  if (sendTo === 'students' || sendTo === 'both') {
    const { data } = await supabase.from('students').select('email, full_name').eq('batch_id', batchId).limit(500);
    for (const s of data ?? []) recipients.push({ ...s, type: 'student' });
  }
  if (sendTo === 'teachers' || sendTo === 'both') {
    const { data } = await supabase.from('teachers').select('email, full_name').eq('active', true).limit(500);
    for (const t of data ?? []) recipients.push({ ...t, type: 'teacher' });
  }
  if (recipients.length === 0) throw new Error('No recipients found');
  const emails = recipients.map((r) => ({
    recipient_email: r.email, recipient_name: r.full_name,
    template_key: 'announcement', subject, status: 'Pending',
    payload: { full_name: r.full_name, message, recipient_type: r.type },
  }));
  await supabase.from('email_queue').insert(emails);
  return emails.length;
}

export async function closeCampusRegistration(batchId, fellowshipCode, reason, actorEmail) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('batch_campus_registration_settings').upsert({
    batch_id: batchId, fellowship_code: fellowshipCode, registration_open: false,
    closed_reason: reason, closed_by: actorEmail, closed_at: now,
    reopened_by: null, reopened_at: null, updated_at: now,
  }, { onConflict: 'batch_id,fellowship_code' });
  if (error) throw error;
}

export async function openCampusRegistration(batchId, fellowshipCode, actorEmail) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('batch_campus_registration_settings').upsert({
    batch_id: batchId, fellowship_code: fellowshipCode, registration_open: true,
    closed_reason: null, closed_by: null, closed_at: null,
    reopened_by: actorEmail, reopened_at: now, updated_at: now,
  }, { onConflict: 'batch_id,fellowship_code' });
  if (error) throw error;
}

export function filterBatches(batches, { search, status, fellowship, sort }) {
  let result = batches;
  if (search) {
    const q = search.toLowerCase();
    result = result.filter((b) => JSON.stringify(b).toLowerCase().includes(q));
  }
  if (status) result = result.filter((b) => (b.status || '').toLowerCase() === status.toLowerCase());
  if (fellowship) result = result.filter((b) => b.fellowship_group === fellowship || b.subgroup === fellowship || b.subgroup_id === fellowship);
  if (sort === 'oldest') result = [...result].reverse();
  return result;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('en-CA'); } catch { return String(ts); }
}
