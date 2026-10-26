import { describe, it, expect, vi, afterEach } from 'vitest';
import { supabase } from '../supabase.js';
import { retryAllFailedMoodleSyncs } from '../features/dashboards/lib/dashboard.js';
import { runHealthChecks } from '../features/system-health/lib/system-health.js';
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

  it('sends the admin session token as bearer and the anon key only as apikey', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'admin-session-token' } },
      error: null,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, sitename: 'Test' }), { status: 200 }),
    );
    await runHealthChecks(URL, ANON);
    const calls = moodleCalls(fetchSpy).filter(([, init]) => init?.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) {
      expect(init.headers.Authorization).toBe('Bearer admin-session-token');
      expect(init.headers.apikey).toBe(ANON);
      expect(init.headers.Authorization).not.toContain(ANON);
      expect(JSON.parse(init.body)).toEqual({ action: 'test' });
    }
  }, 30000);

  it('makes no moodle-sync request with the anon key as bearer when there is no session', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{}', { status: 200 }),
    );
    await runHealthChecks(URL, ANON);
    const posts = moodleCalls(fetchSpy).filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(0);
  }, 30000);
});
