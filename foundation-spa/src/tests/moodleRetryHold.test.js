import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MOODLE_RETRY_CERTIFIED, MOODLE_RETRY_HOLD_MESSAGE, isMoodleRetryHeld } from '../releaseHolds.js';
import { supabase } from '../supabase.js';
import { invokeRetryAction } from '../features/failed-sync-retry-center/lib/failed-syncs.js';
import { invokeRetryWorker } from '../features/notification-center/lib/notifications.js';
import { retryFailedNotification } from '../features/applicant-directory/lib/mutations.js';

// No request leaves the test. The retry-worker function is replaced so the
// assertions can prove whether a call would have reached it.
vi.mock('../supabase.js', () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));

beforeEach(() => {
  supabase.functions.invoke.mockReset();
  supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('Moodle retry hold (certification false)', () => {
  it('is the shipped state', () => {
    expect(MOODLE_RETRY_CERTIFIED).toBe(false);
  });

  it('holds retry for both Moodle identifiers the worker accepts', () => {
    expect(isMoodleRetryHeld('retry', 'moodle_enrollment_sync', false)).toBe(true);
    expect(isMoodleRetryHeld('retry', 'moodle_sync', false)).toBe(true);
    expect(isMoodleRetryHeld('retry', ' moodle_enrollment_sync ', false)).toBe(true);
  });

  it('does not hold resolve or non-Moodle sources', () => {
    expect(isMoodleRetryHeld('resolve', 'moodle_enrollment_sync', false)).toBe(false);
    expect(isMoodleRetryHeld('retry', 'email_queue', false)).toBe(false);
    expect(isMoodleRetryHeld('retry', 'scheduled_notifications', false)).toBe(false);
    expect(isMoodleRetryHeld('retry', 'failed_syncs', false)).toBe(false);
  });

  it('failed-sync Retry rejects a Moodle row before any worker request', async () => {
    await expect(invokeRetryAction('retry', 'moodle_enrollment_sync', 'row-1'))
      .rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('failed-sync Retry rejects the legacy moodle_sync identifier before any worker request', async () => {
    await expect(invokeRetryAction('retry', 'moodle_sync', 'row-2'))
      .rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('notification-center Retry rejects a Moodle row before any worker request', async () => {
    await expect(invokeRetryWorker('retry', 'moodle_enrollment_sync', 'row-3'))
      .rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('applicant-directory retry rejects a Moodle row before any worker request', async () => {
    await expect(retryFailedNotification({ target: { id: 4 }, source: 'moodle_enrollment_sync' }))
      .rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('Resolve on a Moodle row still reaches the worker (not a retry)', async () => {
    await invokeRetryAction('resolve', 'moodle_enrollment_sync', 'row-5');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-worker', {
      body: { action: 'resolve', source: 'moodle_enrollment_sync', id: 'row-5' },
    });
  });
});

describe('non-Moodle retry is unchanged', () => {
  it('sends the same request for email_queue retry and returns the worker payload', async () => {
    const result = await invokeRetryAction('retry', 'email_queue', 'mail-1');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-worker', {
      body: { action: 'retry', source: 'email_queue', id: 'mail-1' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('keeps failed_syncs retry and scheduled_notifications retry reachable', async () => {
    await invokeRetryAction('retry', 'failed_syncs', 'fs-1');
    await invokeRetryWorker('retry', 'scheduled_notifications', 'sn-1');
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('still surfaces worker errors for non-Moodle retries', async () => {
    supabase.functions.invoke.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(invokeRetryAction('retry', 'email_queue', 'mail-2')).rejects.toThrow('boom');
  });
});
