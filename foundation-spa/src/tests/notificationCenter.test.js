import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSummary, filterRows, statusVariant, fmtDate } from '../features/notification-center/lib/notifications.js';

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

// The legacy Notification Center is a plain script with no module export, so its loader is checked as source.
// The SPA loader is covered behaviorally in notificationEmailQueueSelect.test.js.
describe('legacy notification-center email_queue select', () => {
  const legacyJs = readFileSync(resolve(process.cwd(), '../foundation/js/notification-center.js'), 'utf8');
  const selectLine = (table) => legacyJs.split('\n').find((line) => line.includes(`selectSafe("${table}"`)) || '';

  it('email_queue select does not request last_error and keeps error_message', () => {
    const line = selectLine('email_queue');
    expect(line).toContain('error_message');
    expect(line).not.toContain('last_error');
  });

  it('scheduled_notifications and moodle_enrollment_sync still select last_error', () => {
    expect(selectLine('scheduled_notifications')).toContain('last_error');
    expect(selectLine('moodle_enrollment_sync')).toContain('last_error');
  });
});
