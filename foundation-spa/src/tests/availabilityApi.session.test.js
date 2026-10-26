import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// The helper lives in the static foundation tree and is shared with the published teacher page.
// Its session lookup is mocked; fetch is mocked per test. No network or database is used.
vi.mock('../../../foundation/auth/auth-client.js', () => ({
  getSessionOrNull: vi.fn(),
}));

import { getSessionOrNull } from '../../../foundation/auth/auth-client.js';

const ANON_KEY = 'anon-test-key';
const USER_TOKEN = 'user-access-token-for-teacher';
const FUTURE_EXPIRY_SECONDS = Math.floor(Date.now() / 1000) + 3600;

let api;

const validSession = () => ({ access_token: USER_TOKEN, expires_at: FUTURE_EXPIRY_SECONDS });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const headerOf = (init, name) => {
  const h = init?.headers || {};
  if (h instanceof Headers) return h.get(name);
  return h[name] ?? h[name.toLowerCase()] ?? null;
};

const SUBMIT_PAYLOAD = [{
  teacherEmail: 'teacher@example.test',
  teacherDay: 'Sunday',
  teacherTime: '9:00 AM',
  selectedCampusCodes: ['CMU'],
  month: 'June',
  year: '2026',
}];

// Routes each PostgREST request to a canned response, keyed by table and method.
function routeFetch(overrides = {}) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    const method = (init?.method || 'GET').toUpperCase();
    const key = method === 'POST' ? `POST ${u.split('/rest/v1/')[1]}` : u.split('/rest/v1/')[1].split('?')[0];
    if (overrides[key]) return overrides[key](u, init);
    if (key.startsWith('teachers')) return json([{ teacher_id: 'T-1', full_name: 'Teacher One', email: 'teacher@example.test', group_id: 'CE', subgroup_id: 'CESGA' }]);
    if (key.startsWith('batches')) return json([{ batch_id: 'B-1' }]);
    if (key.startsWith('fellowship_map')) return json([{ fellowship_code: 'CMU', campus_name: 'Canadian Mennonite University', group_id: 'CE', subgroup_id: 'CESGA', timezone: 'America/Winnipeg' }]);
    if (key.startsWith('class_options')) return json([]);
    if (key.startsWith('teacher_availability')) return json([]);
    if (key === 'POST teacher_availability') return json([{ id: 'A-1' }], 201);
    return json([]);
  });
}

beforeAll(async () => {
  window.FS_CONFIG = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: ANON_KEY };
  api = await import('../../../foundation/js/availabilityApi.js');
});

beforeEach(() => {
  getSessionOrNull.mockReset();
  getSessionOrNull.mockResolvedValue(validSession());
  globalThis.fetch = routeFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session token authentication', () => {
  it('reads send the signed-in access token and keep the anon key in apikey', async () => {
    await api.getCampuses();
    expect(globalThis.fetch).toHaveBeenCalled();
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBe(`Bearer ${USER_TOKEN}`);
    expect(headerOf(init, 'apikey')).toBe(ANON_KEY);
  });

  it('never sends the anon key as the Bearer token on any helper call', async () => {
    await api.getCampuses();
    await api.getTeachers();
    await api.getScheduledClassConflicts('CMU');
    await api.loadAvailability({ teacherEmail: 'teacher@example.test' });
    await api.submitAvailability(SUBMIT_PAYLOAD);
    expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(4);
    for (const [, init] of globalThis.fetch.mock.calls) {
      expect(headerOf(init, 'Authorization')).toBe(`Bearer ${USER_TOKEN}`);
      expect(headerOf(init, 'Authorization')).not.toBe(`Bearer ${ANON_KEY}`);
    }
  });

  it('no session: rejects with SignInRequiredError and sends no request', async () => {
    getSessionOrNull.mockResolvedValue(null);
    await expect(api.getTeachers()).rejects.toMatchObject({ name: 'SignInRequiredError', code: 'SIGN_IN_REQUIRED' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('expired session: treated as missing, no request, no anon fallback', async () => {
    getSessionOrNull.mockResolvedValue({ access_token: USER_TOKEN, expires_at: Math.floor(Date.now() / 1000) - 60 });
    await expect(api.getCampuses()).rejects.toBeInstanceOf(api.SignInRequiredError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('session lookup failure: treated as missing, no request', async () => {
    getSessionOrNull.mockRejectedValue(new Error('refresh failed'));
    await expect(api.loadAvailability({ teacherEmail: 'teacher@example.test' })).rejects.toBeInstanceOf(api.SignInRequiredError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('session without an access token: no anon fallback', async () => {
    getSessionOrNull.mockResolvedValue({});
    await expect(api.getTeachers()).rejects.toBeInstanceOf(api.SignInRequiredError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('submit without a session: throws SignInRequiredError and sends nothing', async () => {
    getSessionOrNull.mockResolvedValue(null);
    await expect(api.submitAvailability(SUBMIT_PAYLOAD)).rejects.toBeInstanceOf(api.SignInRequiredError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('access denial', () => {
  it('401 from PostgREST surfaces as SignInRequiredError, not an empty list', async () => {
    globalThis.fetch = routeFetch({ teachers: () => json({ message: 'JWT expired' }, 401) });
    await expect(api.getTeachers()).rejects.toBeInstanceOf(api.SignInRequiredError);
  });

  it('403 from PostgREST surfaces as AccessDeniedError, not an empty result', async () => {
    globalThis.fetch = routeFetch({ class_options: () => json({ message: 'permission denied' }, 403) });
    await expect(api.getScheduledClassConflicts('CMU')).rejects.toBeInstanceOf(api.AccessDeniedError);
  });

  it('getCampuses does not replace an auth failure with fallback campuses', async () => {
    globalThis.fetch = routeFetch({ fellowship_map: () => json({ message: 'JWT expired' }, 401) });
    await expect(api.getCampuses()).rejects.toBeInstanceOf(api.SignInRequiredError);
  });

  it('batch lookup auth failure is not swallowed during submit', async () => {
    globalThis.fetch = routeFetch({ batches: () => json({ message: 'JWT expired' }, 401) });
    await expect(api.submitAvailability(SUBMIT_PAYLOAD)).rejects.toBeInstanceOf(api.SignInRequiredError);
    const posted = globalThis.fetch.mock.calls.some(([, init]) => (init?.method || 'GET') === 'POST');
    expect(posted).toBe(false);
  });

  it('insert refused by RLS (403) surfaces as AccessDeniedError', async () => {
    globalThis.fetch = routeFetch({ 'POST teacher_availability': () => json({ message: 'new row violates row-level security policy' }, 403) });
    await expect(api.submitAvailability(SUBMIT_PAYLOAD)).rejects.toBeInstanceOf(api.AccessDeniedError);
  });
});

describe('submit path (authenticated write)', () => {
  it('teacher lookup, batch lookup and insert all run as the user, with the expected row shape', async () => {
    const result = await api.submitAvailability(SUBMIT_PAYLOAD);
    expect(result).toEqual({ inserted: 1, updated: 0, deactivated: 0 });

    const insert = globalThis.fetch.mock.calls.find(([u, init]) => String(u).endsWith('/teacher_availability') && init?.method === 'POST');
    expect(insert).toBeDefined();
    const [, insertInit] = insert;
    expect(headerOf(insertInit, 'Authorization')).toBe(`Bearer ${USER_TOKEN}`);
    const rows = JSON.parse(insertInit.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teacher_id: 'T-1',
      batch_id: 'B-1',
      day: 'Sunday',
      time_slot: '09:00:00',
      status: 'Tentative',
      selected_fellowship_codes: ['CMU'],
    });
  });
});

describe('compatibility with restrictive anon grants (contract test)', () => {
  // The columns the helper reads, per table, as written in the repo's queries. Each read must use
  // only these columns, so that the authenticated RLS policies and the anon grant list stay in step.
  const CONTRACT = {
    fellowship_map: ['fellowship_code', 'campus_name', 'group_id', 'subgroup_id', 'timezone', 'active'],
    teachers: ['teacher_id', 'full_name', 'email', 'group_id', 'subgroup_id', 'active', 'deleted_at'],
    class_options: ['fellowship_codes', 'teacher_name', 'day', 'class_time', 'active', 'enrollment_open', 'deleted_at'],
    teacher_availability: ['id', 'day', 'time_slot', 'status', 'notes', 'batch_id', 'teacher_id'],
    batches: ['batch_id', 'active', 'registration_open', 'archived', 'start_date'],
  };

  it('every request targets a contract table and uses only contract columns', async () => {
    await api.getCampuses();
    await api.getTeachers();
    await api.getScheduledClassConflicts('CMU');
    await api.loadAvailability({ teacherEmail: 'teacher@example.test' });
    await api.submitAvailability(SUBMIT_PAYLOAD);

    for (const [url] of globalThis.fetch.mock.calls) {
      const parsed = new URL(String(url));
      const table = parsed.pathname.split('/rest/v1/')[1];
      expect(Object.keys(CONTRACT)).toContain(table === 'teacher_availability' ? 'teacher_availability' : table);
      const allowed = new Set(CONTRACT[table]);
      const select = parsed.searchParams.get('select');
      if (select) {
        for (const col of select.split(',')) expect(allowed.has(col.trim())).toBe(true);
      }
      for (const key of parsed.searchParams.keys()) {
        if (key === 'select' || key === 'order' || key === 'or' || key === 'limit') continue;
        expect(allowed.has(key)).toBe(true);
      }
    }
  });
});
