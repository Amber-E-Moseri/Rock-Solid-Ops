import { supabase } from '../../../supabase.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SLOTS = ['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM', '10:00 PM'];
export const TZ_OPTIONS = ['America/Toronto', 'America/Edmonton', 'America/Vancouver', 'America/Regina', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'UTC'];
export const SUBGROUP_LABELS = {
  CESGA: 'Prairies (MB / SK)', CESGB: 'Atlantic Canada', CSGA: 'GTA, Ottawa & Quebec',
  CSGB: 'Waterloo & West GTA', WSGA: 'Alberta & BC', WSGB: 'Southern Alberta',
};

export async function fetchTeacherList() {
  const { data, error } = await supabase.from('teachers')
    .select('teacher_id, full_name, email, active, deleted_at')
    .is('deleted_at', null).order('full_name');
  if (error) throw error;

  const { data: sgData } = await supabase.from('teachers')
    .select('teacher_id, subgroup_id').is('deleted_at', null);
  const { data: fmData } = await supabase.from('fellowship_map')
    .select('subgroup_id, timezone, active').eq('active', true);

  const tzBySg = {};
  for (const f of fmData ?? []) { if (f.subgroup_id && f.timezone) tzBySg[f.subgroup_id] = f.timezone; }
  const sgByTeacher = {};
  for (const s of sgData ?? []) { if (s.teacher_id && s.subgroup_id) sgByTeacher[s.teacher_id] = s.subgroup_id; }

  return (data ?? []).map((t) => ({
    teacherId: t.teacher_id, teacherName: t.full_name, teacherEmail: t.email,
    teacherTimezone: tzBySg[sgByTeacher[t.teacher_id]] || Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
}

export async function fetchCampuses() {
  const { data, error } = await supabase.from('fellowship_map')
    .select('fellowship_code, campus_name, group_id, subgroup_id, timezone, active')
    .eq('active', true).order('campus_name');
  if (error) throw error;
  return (data ?? []).map((c) => ({
    code: c.fellowship_code, campusName: c.campus_name,
    groupID: c.group_id, subgroupID: c.subgroup_id,
    timezone: c.timezone || 'America/Toronto',
  }));
}

export async function fetchConflicts(campusCodes) {
  const { data, error } = await supabase.from('class_options')
    .select('fellowship_codes, day, class_time, teacher_name, active, enrollment_open, deleted_at')
    .eq('active', true).eq('enrollment_open', true).is('deleted_at', null);
  if (error) throw error;

  const occupied = {};
  for (const row of data ?? []) {
    const codes = parsePgArray(row.fellowship_codes);
    for (const code of codes) {
      if (!campusCodes.includes(code)) continue;
      if (!occupied[code]) occupied[code] = new Set();
      occupied[code].add(`${row.day}__${to12h(row.class_time)}`);
    }
  }
  return occupied;
}

function parsePgArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val !== 'string') return [];
  return val.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

function to12h(time) {
  if (!time || time.includes('AM') || time.includes('PM')) return time;
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

export function to24h(timeStr) {
  const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return timeStr;
  let h = parseInt(m[1]);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}:00`;
}

export function convertSlot(day, time, fromTz, toTz, year, monthIdx) {
  const dayIdx = DAYS.indexOf(day);
  if (dayIdx < 0) return { day, time };
  const firstOfMonth = new Date(year, monthIdx, 1);
  const firstDayOfWeek = firstOfMonth.getDay();
  let diff = dayIdx - (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1);
  if (diff < 0) diff += 7;
  const refDate = new Date(year, monthIdx, 1 + diff);

  const hourMatch = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!hourMatch) return { day, time };
  let hour = parseInt(hourMatch[1]);
  const minute = parseInt(hourMatch[2]);
  const ampm = hourMatch[3].toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  const fromStr = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-${String(refDate.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const fromDate = new Date(fromStr);

  try {
    const fromOffset = getTimezoneOffset(fromDate, fromTz);
    const toOffset = getTimezoneOffset(fromDate, toTz);
    const utcMs = fromDate.getTime() - fromOffset * 60000;
    const targetDate = new Date(utcMs + toOffset * 60000);
    const targetDay = DAYS[(targetDate.getDay() + 6) % 7];
    const tH = targetDate.getHours();
    const tM = targetDate.getMinutes();
    const tAmPm = tH >= 12 ? 'PM' : 'AM';
    const tHH = tH % 12 || 12;
    return { day: targetDay, time: `${tHH}:${String(tM).padStart(2, '0')} ${tAmPm}` };
  } catch {
    return { day, time };
  }
}

function getTimezoneOffset(date, tz) {
  const str = date.toLocaleString('en-US', { timeZone: tz });
  const local = new Date(str);
  return (local.getTime() - date.getTime() + date.getTimezoneOffset() * 60000) / 60000;
}

export function monthOptions(count = 6) {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push({ label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), year: d.getFullYear(), month: d.getMonth() });
  }
  return opts;
}

export async function submitAvailability(teacherEmail, teacherId, batchId, slots, campusCodes, month) {
  const records = [];
  for (const slotKey of slots) {
    const [day, time] = slotKey.split('||');
    records.push({
      teacher_id: teacherId,
      batch_id: batchId,
      day,
      time_slot: to24h(time),
      status: 'Tentative',
      notes: `Campus: ${campusCodes.join(',')} - ${month}`,
      created_by: teacherEmail,
      updated_by: teacherEmail,
    });
  }

  const { error } = await supabase.from('teacher_availability').insert(records);
  if (error) throw error;
  return records.length;
}

export async function getActiveBatchId() {
  const { data, error } = await supabase.from('batches')
    .select('batch_id, active, registration_open, start_date')
    .or('active.eq.true,registration_open.eq.true')
    .order('start_date', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.batch_id || null;
}

export async function resolveTeacherId(email) {
  const { data, error } = await supabase.from('teachers')
    .select('teacher_id, email, full_name, active, deleted_at')
    .is('deleted_at', null).ilike('email', email).limit(1).maybeSingle();
  if (error) throw error;
  return data?.teacher_id || null;
}
