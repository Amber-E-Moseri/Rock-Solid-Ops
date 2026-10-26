import { describe, it, expect, vi, beforeEach } from 'vitest';

import { supabase } from '../supabase.js';
import { invokeRetryAction } from '../features/failed-sync-retry-center/lib/failed-syncs.js';
import { invokeRetryWorker } from '../features/notification-center/lib/notifications.js';

// Certification true is only simulated here. The shipped constant stays false
// (see moodleRetryHold.test.js). This file proves the original retry path is
// preserved once the hold is lifted through the existing flag.
vi.mock('../releaseHolds.js', async (importOriginal) => ({
  ...(await importOriginal()),
  MOODLE_RETRY_CERTIFIED: true,
}));

vi.mock('../supabase.js', () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));

beforeEach(() => {
  supabase.functions.invoke.mockReset();
  supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('Moodle retry when certification is true', () => {
  it('failed-sync Retry sends the existing retry-worker request for a Moodle row', async () => {
    const result = await invokeRetryAction('retry', 'moodle_enrollment_sync', 'row-1');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-worker', {
      body: { action: 'retry', source: 'moodle_enrollment_sync', id: 'row-1' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('notification-center Retry sends the existing retry-worker request for a Moodle row', async () => {
    await invokeRetryWorker('retry', 'moodle_sync', 'row-2');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-worker', {
      body: { action: 'retry', source: 'moodle_sync', id: 'row-2' },
    });
  });
});
