/**
 * availabilityApi.js  - Supabase-backed
 * Set in .env:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Every request runs as the signed-in user. The anon key is sent only in the apikey header;
 * the Authorization header carries the user's session access token. If there is no valid
 * session, requests are not sent and SignInRequiredError is thrown. There is no anon fallback.
 */

import { getSessionOrNull } from '../auth/auth-client.js';

const ENV = (import.meta && import.meta.env) ? import.meta.env : {};
const SUPABASE_URL      = ENV.VITE_SUPABASE_URL || window.FS_CONFIG?.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || window.FS_CONFIG?.SUPABASE_ANON_KEY || '';

const FALLBACK_CAMPUSES = [
  { code: 'CMU',      name: 'Canadian Mennonite University',     group: 'CE', subgroup: 'CESGA', timezone: 'America/Winnipeg' },
  { code: 'YORK',     name: 'York University',                   group: 'CS', subgroup: 'CSGA',  timezone: 'America/Toronto'  },
  { code: 'UTM',      name: 'University of Toronto Mississauga', group: 'CS', subgroup: 'CSGB',  timezone: 'America/Toronto'  },
  { code: 'UALBERTA', name: 'University of Alberta',             group: 'WS', subgroup: 'WSGA',  timezone: 'America/Edmonton' },
];

// - Errors -

export class SignInRequiredError extends Error {
  constructor(message = 'Your session has expired. Sign in again to continue.') {
    super(message);
    this.name = 'SignInRequiredError';
    this.code = 'SIGN_IN_REQUIRED';
  }
}

export class AccessDeniedError extends Error {
  constructor(message = 'This account is not permitted to perform that request.') {
    super(message);
    this.name = 'AccessDeniedError';
    this.code = 'ACCESS_DENIED';
  }
}

// Auth failures must reach the caller. The read helpers below otherwise return empty or fallback data.
export function isAuthError(err) {
  return err instanceof SignInRequiredError || err instanceof AccessDeniedError;
}

// - Helpers -

// Returns the signed-in user's access token. getSession() refreshes a near-expiry token.
// Throws SignInRequiredError when there is no session, the session is expired, or the lookup fails.
async function requireAccessToken() {
  let session = null;
  try {
    session = await getSessionOrNull();
  } catch (_) {
    session = null;
  }
  const token = session?.access_token || '';
  const expiresAtMs = Number(session?.expires_at || 0) * 1000;
  if (!token || (expiresAtMs && expiresAtMs <= Date.now())) {
    throw new SignInRequiredError();
  }
  return token;
}

async function sbHeaders(extra = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase configuration is missing.');
  }
  const token = await requireAccessToken();
  return {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
    ...extra,
  };
}

// Maps PostgREST auth failures to typed errors. Other failures keep the caller's message format.
async function throwIfNotOk(res, failureLabel) {
  if (res.ok) return;
  if (res.status === 401) throw new SignInRequiredError();
  if (res.status === 403) {
    throw new AccessDeniedError(
      'Your account is not allowed to make this request. Check that it is linked to your teacher record.'
    );
  }
  const txt = await res.text();
  throw new Error(`${failureLabel} failed (${res.status}): ${txt}`);
}

async function sbGet(table, params = '') {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`,
    { headers: await sbHeaders() }
  );
  await throwIfNotOk(res, `GET ${table}`);
  return res.json();
}

function to24h(time12) {
  const m = String(time12 || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mi = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${mi}:00`;
}

function to12h(time24) {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h  = parseInt(hStr, 10);
  const mi = mStr || '00';
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mi} ${ap}`;
}

// - Public API -

export async function getCampuses() {
  try {
    const rows = await sbGet(
      'fellowship_map',
      'active=eq.true&select=fellowship_code,campus_name,group_id,subgroup_id,timezone&order=campus_name'
    );
    const normalized = rows
      .map(r => ({
        code:     r.fellowship_code,
        name:     r.campus_name,
        group:    r.group_id,
        subgroup: r.subgroup_id,
        timezone: r.timezone || 'America/Toronto',
      }))
      .filter(r => r.code && r.name);
    console.log('[TA] getCampuses:', normalized.length, 'rows');
    return normalized.length ? normalized : FALLBACK_CAMPUSES;
  } catch (e) {
    if (isAuthError(e)) throw e;
    console.error('[TA] getCampuses failed - using fallback:', e.message);
    return FALLBACK_CAMPUSES;
  }
}

export async function getTeachers() {
  try {
    const rows = await sbGet(
      'teachers',
      'active=eq.true&deleted_at=is.null&select=teacher_id,full_name,email,group_id,subgroup_id&order=full_name'
    );
    return rows.map(r => ({
      teacherID:       r.teacher_id,
      teacherName:     r.full_name,
      teacherEmail:    r.email || '',
      teacherTimezone: 'America/Toronto',
    }));
  } catch (e) {
    if (isAuthError(e)) throw e;
    console.error('[TA] getTeachers failed:', e.message);
    return [];
  }
}

export async function getScheduledClassConflicts(campusCodes) {
  try {
    if (!campusCodes) return [];
    const codes = String(campusCodes).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!codes.length) return [];
    const rows = await sbGet(
      'class_options',
      'active=eq.true&enrollment_open=eq.true&deleted_at=is.null&select=fellowship_codes,teacher_name,day,class_time'
    );
    const conflicts = [];
    rows.forEach(r => {
      const raw    = String(r.fellowship_codes || '{}').replace(/^\{|\}$/g, '');
      const fCodes = raw.split(',').map(s => s.trim().toUpperCase());
      if (codes.some(c => fCodes.includes(c)) && r.day && r.class_time) {
        const time12 = to12h(r.class_time);
        conflicts.push({ day: r.day, time: time12, label: `${r.teacher_name || 'Class'} - ${r.day} ${time12}` });
      }
    });
    return conflicts;
  } catch (e) {
    if (isAuthError(e)) throw e;
    console.error('[TA] getScheduledClassConflicts failed:', e.message);
    return [];
  }
}

export async function loadAvailability({ teacherEmail }) {
  try {
    if (!teacherEmail) return [];
    const teachers = await sbGet('teachers', `email=eq.${encodeURIComponent(teacherEmail)}&active=eq.true&select=teacher_id`);
    if (!teachers.length) return [];
    const teacherId = teachers[0].teacher_id;
    const rows = await sbGet(
      'teacher_availability',
      `teacher_id=eq.${encodeURIComponent(teacherId)}&select=id,day,time_slot,status,notes,batch_id&order=day&order=time_slot`
    );
    return rows.map(r => ({
      recordId:    r.id,
      teacherDay:  r.day,
      teacherTime: to12h(r.time_slot),
      campusCode:  '',
      status:      r.status,
      notes:       r.notes,
    }));
  } catch (e) {
    if (isAuthError(e)) throw e;
    console.error('[TA] loadAvailability failed:', e.message);
    return [];
  }
}

export async function submitAvailability(payload) {
  if (!Array.isArray(payload) || !payload.length) {
    throw new Error('No availability slots to submit');
  }

  console.log('[TA] submitAvailability - raw payload:', payload);

  const uniqueEmails = [...new Set(payload.map((p) => p.teacherEmail).filter(Boolean))];
  const teacherMap = {};
  for (const email of uniqueEmails) {
    try {
      const rows = await sbGet('teachers', `email=eq.${encodeURIComponent(email)}&select=teacher_id`);
      if (rows.length) {
        teacherMap[email] = rows[0].teacher_id;
      }
    } catch (e) {
      if (isAuthError(e)) throw e;
      console.error('[TA] teacher lookup failed for', email, e.message);
    }
  }

  let batchId = null;
  try {
    const batches = await sbGet(
      'batches',
      'or=(active.eq.true,registration_open.eq.true)&archived=eq.false&order=start_date.desc&limit=1&select=batch_id'
    );
    if (batches.length) batchId = batches[0].batch_id;
  } catch (e) {
    if (isAuthError(e)) throw e;
  }

  if (!batchId) {
    return { ok: false, error: 'No active batch found. Please contact your administrator.' };
  }

  const bySlot = new Map();
  for (const p of payload) {
    const teacher_id = teacherMap[p.teacherEmail] || p.teacherID || null;
    const time_slot = to24h(p.teacherTime);
    const day = String(p.teacherDay || p.day || '').trim();
    if (!teacher_id || !time_slot || !day) continue;

    const explicit = Array.isArray(p.selectedCampusCodes) ? p.selectedCampusCodes : [];
    const fallback = p.campusCode ? [p.campusCode] : [];
    const selected = [...new Set([...explicit, ...fallback].map((v) => String(v || '').trim().toUpperCase()).filter(Boolean))];

    const key = `${teacher_id}__${day}__${time_slot}`;
    if (!bySlot.has(key)) {
      bySlot.set(key, {
        teacher_id,
        day,
        time_slot,
        selected_fellowship_codes: new Set(),
        created_by: p.teacherEmail || null,
        month: p.month || '',
        year: p.year || '',
      });
    }
    const row = bySlot.get(key);
    selected.forEach((code) => row.selected_fellowship_codes.add(code));
  }

  const rows = [];
  for (const row of bySlot.values()) {
    const selectedCodes = [...row.selected_fellowship_codes];
    if (!selectedCodes.length) {
      throw new Error(`No campus selected for ${row.day} ${row.time_slot}. Select at least one campus.`);
    }
    rows.push({
      teacher_id: row.teacher_id,
      day: row.day,
      time_slot: row.time_slot,
      batch_id: batchId,
      status: 'Tentative',
      selected_fellowship_codes: selectedCodes,
      notes: `Teacher portal submission${row.month || row.year ? ` - ${row.month} ${row.year}` : ''}`.trim(),
      created_by: row.created_by,
    });
  }

  if (!rows.length) {
    throw new Error('No valid rows to insert. Ensure teacher + day + time are present.');
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/teacher_availability`, {
    method: 'POST',
    headers: await sbHeaders({
      'Prefer': 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  });

  await throwIfNotOk(res, 'Submit');

  const result = await res.json();
  return { inserted: result.length, updated: rows.length - result.length, deactivated: 0 };
}
export function buildDefaultConfig() {
  return {
    mode:    'supabase',
    appName: 'Foundation School Scheduler',
  };
}



