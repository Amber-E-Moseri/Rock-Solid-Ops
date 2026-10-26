import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isEmailResolveHeld, EMAIL_QUEUE_RESOLVE_HELD, EMAIL_RESOLVE_HOLD_MESSAGE } from '../releaseHolds.js';
import { supabase } from '../supabase.js';
import { invokeRetryAction } from '../features/failed-sync-retry-center/lib/failed-syncs.js';
import { invokeRetryWorker } from '../features/notification-center/lib/notifications.js';

vi.mock('../supabase.js', () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));

beforeEach(() => {
  supabase.functions.invoke.mockReset();
  supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

// vitest runs from foundation-spa (npm run test), so source paths resolve from the package root.
const src = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('email Resolve hold (release constant)', () => {
  it('is held', () => {
    expect(EMAIL_QUEUE_RESOLVE_HELD).toBe(true);
  });

  it('holds Resolve for email_queue, including whitespace variants', () => {
    expect(isEmailResolveHeld('resolve', 'email_queue')).toBe(true);
    expect(isEmailResolveHeld(' resolve ', ' email_queue ')).toBe(true);
  });

  it('does not affect Retry for email_queue', () => {
    expect(isEmailResolveHeld('retry', 'email_queue')).toBe(false);
  });

  it('does not affect Resolve for the other sources', () => {
    for (const source of ['scheduled_notifications', 'failed_syncs', 'moodle_enrollment_sync', 'moodle_sync']) {
      expect(isEmailResolveHeld('resolve', source), source).toBe(false);
    }
  });

  it('is off when explicitly not held', () => {
    expect(isEmailResolveHeld('resolve', 'email_queue', false)).toBe(false);
  });
});

describe('email Resolve refused before any request (SPA libraries)', () => {
  it('failed-sync invokeRetryAction refuses email Resolve with no request', async () => {
    await expect(invokeRetryAction('resolve', 'email_queue', 'row-1')).rejects.toThrow(EMAIL_RESOLVE_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('notification-center invokeRetryWorker refuses email Resolve with no request', async () => {
    await expect(invokeRetryWorker('resolve', 'email_queue', 'row-2')).rejects.toThrow(EMAIL_RESOLVE_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('email Retry still sends a request from both libraries', async () => {
    await invokeRetryAction('retry', 'email_queue', 'row-3');
    await invokeRetryWorker('retry', 'email_queue', 'row-4');
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-worker', {
      body: { action: 'retry', source: 'email_queue', id: 'row-3' },
    });
  });

  it('Resolve for the other sources still sends a request', async () => {
    await invokeRetryAction('resolve', 'scheduled_notifications', 'row-5');
    await invokeRetryWorker('resolve', 'failed_syncs', 'row-6');
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });
});

describe('email Resolve hidden and skipped in the SPA pages', () => {
  const pages = [
    'src/features/failed-sync-retry-center/FailedSyncRetryCenterPage.jsx',
    'src/features/notification-center/NotificationCenterPage.jsx',
  ];

  for (const page of pages) {
    it(`${page}: per-row Resolve is disabled for email rows`, () => {
      const text = src(page);
      expect(text).toMatch(/const isHeldResolve = \(row\) => isEmailResolveHeld\('resolve', row\.source\);/);
      expect(text).toMatch(/disabled=\{busy \|\| isHeldResolve\(r\)\}[^>]*onClick=\{\(\) => handleAction\('resolve', \[r\]\)\}/);
    });

    it(`${page}: bulk Resolve skips email rows and keeps Retry skipping as before`, () => {
      const text = src(page);
      expect(text).toMatch(/action === 'resolve' \? rows\.filter\(\(r\) => !isHeldResolve\(r\)\)/);
      expect(text).toMatch(/action === 'retry'\s*\?\s*rows\.filter\(\(r\) => !isHeldRetry\(r\)\)/);
    });
  }
});
