import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSummary, filterRows, statusVariant, fmtDate } from '../features/notification-center/lib/notifications.js';

// The email_queue select must not name last_error: the staging table has no such column, and a select
// that names it fails with "does not exist", which selectSafe turns into an empty Email Queue section.
const emailQueueSelectLine = (src) => src.split('\n').find((line) => line.includes("selectSafe(") && line.includes('email_queue')) || '';
const sharedSpa = readFileSync(resolve(process.cwd(), 'src/features/notification-center/lib/notifications.js'), 'utf8');
const legacyJs = readFileSync(resolve(process.cwd(), '../foundation/js/notification-center.js'), 'utf8');

const makeRow = (overrides) => ({
  id: '1', source: 'email_queue', type: 'email', status: 'PENDING',
  recipient: 'a@b.com', subject: 'Welcome', error: '', created_at: '2026-07-01T10:00:00Z', raw: {},
  ...overrides,
});

describe('notification-center lib', () => {
  it('computeSummary counts correctly', () => {
    const rows = [
      makeRow({ type: 'email', status: 'PENDING' }),
      makeRow({ id: '2', type: 'email', status: 'FAILED' }),
      makeRow({ id: '3', type: 'moodle', status: 'PENDING' }),
      makeRow({ id: '4', type: 'moodle', status: 'FAILED' }),
      makeRow({ id: '5', type: 'email', status: 'SENT' }),
    ];
    const s = computeSummary(rows);
    expect(s.pendingEmails).toBe(1);
    expect(s.failedEmails).toBe(1);
    expect(s.pendingMoodle).toBe(1);
    expect(s.failedMoodle).toBe(1);
  });

  it('filterRows filters by status', () => {
    const rows = [makeRow({ status: 'PENDING' }), makeRow({ id: '2', status: 'FAILED' })];
    expect(filterRows(rows, { status: 'PENDING' })).toHaveLength(1);
    expect(filterRows(rows, { status: 'FAILED' })).toHaveLength(1);
    expect(filterRows(rows, {})).toHaveLength(2);
  });

  it('filterRows filters by type', () => {
    const rows = [makeRow({ type: 'email' }), makeRow({ id: '2', type: 'moodle' })];
    expect(filterRows(rows, { type: 'email' })).toHaveLength(1);
  });

  it('filterRows filters by search', () => {
    const rows = [makeRow({ recipient: 'test@example.com' }), makeRow({ id: '2', recipient: 'other@x.com' })];
    expect(filterRows(rows, { search: 'test@' })).toHaveLength(1);
  });

  it('statusVariant returns correct variants', () => {
    expect(statusVariant('FAILED')).toBe('danger');
    expect(statusVariant('PENDING')).toBe('warning');
    expect(statusVariant('SENT')).toBe('success');
    expect(statusVariant('UNKNOWN')).toBe('info');
  });

  it('fmtDate handles null and valid dates', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('2026-07-01T10:00:00Z')).not.toBe('—');
  });
});

describe('notification-center email_queue select', () => {
  it('SPA loader does not select last_error from email_queue', () => {
    const line = emailQueueSelectLine(sharedSpa);
    expect(line).toContain("selectSafe('email_queue'");
    expect(line).toContain('error_message');
    expect(line).not.toContain('last_error');
  });

  it('legacy loader does not select last_error from email_queue', () => {
    const line = emailQueueSelectLine(legacyJs);
    expect(line).toContain('selectSafe("email_queue"');
    expect(line).toContain('error_message');
    expect(line).not.toContain('last_error');
  });

  it('scheduled_notifications and moodle_enrollment_sync still select last_error', () => {
    expect(sharedSpa).toMatch(/selectSafe\('scheduled_notifications'[^\n]*last_error/);
    expect(sharedSpa).toMatch(/selectSafe\('moodle_enrollment_sync'[^\n]*last_error/);
    expect(legacyJs).toMatch(/selectSafe\("scheduled_notifications"[^\n]*last_error/);
    expect(legacyJs).toMatch(/selectSafe\("moodle_enrollment_sync"[^\n]*last_error/);
  });
});
