import { describe, it, expect, vi, afterEach } from 'vitest';
import { supabase } from '../supabase.js';
import { retryAllFailedMoodleSyncs } from '../features/dashboards/lib/dashboard.js';
import { runHealthChecks, runMoodleConnectivityTest } from '../features/system-health/lib/system-health.js';
import { isMoodleRetryHeld, MOODLE_RETRY_CERTIFIED, MOODLE_RETRY_HOLD_MESSAGE } from '../releaseHolds.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Moodle retry hold', () => {
  it('keeps MOODLE_RETRY_CERTIFIED false', () => {
    expect(MOODLE_RETRY_CERTIFIED).toBe(false);
  });

  it('holds a Moodle retry while uncertified and never holds other actions', () => {
    expect(isMoodleRetryHeld('retry', 'moodle_enrollment_sync', false)).toBe(true);
    expect(isMoodleRetryHeld('retry', 'moodle_sync', false)).toBe(true);
    expect(isMoodleRetryHeld('resolve', 'moodle_enrollment_sync', false)).toBe(false);
    expect(isMoodleRetryHeld('retry', 'email', false)).toBe(false);
  });

  it('dashboard retry refuses before any request while uncertified', async () => {
    const invoke = vi.spyOn(supabase.functions, 'invoke');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(retryAllFailedMoodleSyncs()).rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(invoke).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('system-health Moodle connectivity', () => {
  const URL = 'https://project.example.test';
  const ANON = 'anon-public-key-probe';

  function moodleCalls(fetchSpy) {
    return fetchSpy.mock.calls.filter(([url]) => String(url).includes('/functions/v1/moodle-sync'));
  }

  it('opening System Health sends no moodle-sync request, with or without a session', async () => {
    for (const session of [{ access_token: 'admin-session-token' }, null]) {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session }, error: null });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(JSON.stringify({ ok: true, sitename: 'Test' }), { status: 200 }),
      );
      await runHealthChecks(URL, ANON);
      // The only automatic contact with moodle-sync is the CORS preflight reachability probe (OPTIONS).
      // It returns before authorization, database or Moodle work. No POST, so no Moodle call.
      const nonPreflight = moodleCalls(fetchSpy).filter(([, init]) => init?.method !== 'OPTIONS');
      expect(nonPreflight).toHaveLength(0);
      vi.restoreAllMocks();
    }
  }, 30000);

  it('the explicit test sends the admin session token as bearer and the anon key only as apikey', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'admin-session-token' } },
      error: null,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, sitename: 'Test' }), { status: 200 }),
    );
    const check = await runMoodleConnectivityTest(URL, ANON);
    const calls = moodleCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    const [, init] = calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer admin-session-token');
    expect(init.headers.apikey).toBe(ANON);
    expect(init.headers.Authorization).not.toContain(ANON);
    expect(JSON.parse(init.body)).toEqual({ action: 'test' });
    expect(check).toMatchObject({ key: 'moodle-api', state: 'pass' });
  }, 30000);

  it('the explicit test makes no moodle-sync request without a session', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{}', { status: 200 }),
    );
    const check = await runMoodleConnectivityTest(URL, ANON);
    expect(moodleCalls(fetchSpy)).toHaveLength(0);
    expect(check).toMatchObject({ key: 'moodle-api', state: 'warn' });
  }, 30000);
});
