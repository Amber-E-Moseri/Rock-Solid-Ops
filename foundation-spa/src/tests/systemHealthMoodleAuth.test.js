import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Moodle connectivity check calls moodle-sync, which is staff-only. It must send the signed-in session
// token. The anon key is a project key, not a staff credential, so it must never be the bearer.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('../supabase.js', () => ({
  supabase: { auth: { getSession } },
}));

import { requestMoodleConnectivityTest } from '../features/system-health/lib/system-health.js';

const SUPABASE_URL = 'https://project.example.test';
const ANON_KEY = 'anon-key-value-not-a-credential';

describe('system health Moodle connectivity check', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends the signed-in session token as the bearer', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-jwt-value' } } });

    await requestMoodleConnectivityTest(SUPABASE_URL, ANON_KEY);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/moodle-sync`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer session-jwt-value');
    expect(JSON.parse(init.body)).toEqual({ action: 'test' });
  });

  it('never sends the anon key as the bearer', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-jwt-value' } } });

    await requestMoodleConnectivityTest(SUPABASE_URL, ANON_KEY);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).not.toContain(ANON_KEY);
    // The project key still identifies the project to the gateway; it is not used as the credential.
    expect(init.headers.apikey).toBe(ANON_KEY);
  });

  it('with no session sends an empty bearer, never the anon key', async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    await requestMoodleConnectivityTest(SUPABASE_URL, ANON_KEY);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer ');
    expect(init.headers.Authorization).not.toContain(ANON_KEY);
  });
});
