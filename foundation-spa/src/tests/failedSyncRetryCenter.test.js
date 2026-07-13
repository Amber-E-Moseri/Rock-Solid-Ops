import { describe, it, expect } from 'vitest';
import { computeKpis, filterJobs, statusVariant, fmtDateTime } from '../features/failed-sync-retry-center/lib/failed-syncs.js';

const makeJob = (overrides) => ({
  source: 'failed_syncs', id: '1', type: 'Email', recipient: 'a@b.com',
  status: 'FAILED', error: 'timeout', failureReason: '', traceId: '',
  created_at: '2026-07-01T10:00:00Z', lastAttemptedAt: '2026-07-01T11:00:00Z', retryCount: 0, raw: {},
  ...overrides,
});

describe('failed-syncs lib', () => {
  it('computeKpis counts correctly', () => {
    const rows = [
      makeJob({ source: 'email_queue', type: 'Email' }),
      makeJob({ id: '2', source: 'moodle_enrollment_sync', type: 'Moodle' }),
    ];
    const k = computeKpis(rows);
    expect(k.total).toBe(2);
    expect(k.emails).toBe(1);
    expect(k.moodle).toBe(1);
  });

  it('filterJobs by status', () => {
    const rows = [makeJob({ status: 'FAILED' }), makeJob({ id: '2', status: 'PENDING' })];
    expect(filterJobs(rows, { status: 'failed' })).toHaveLength(1);
    expect(filterJobs(rows, {})).toHaveLength(2);
  });

  it('filterJobs by type', () => {
    const rows = [makeJob({ type: 'Email' }), makeJob({ id: '2', type: 'Moodle' })];
    expect(filterJobs(rows, { type: 'email' })).toHaveLength(1);
  });

  it('filterJobs by search', () => {
    const rows = [makeJob({ recipient: 'test@x.com' }), makeJob({ id: '2', recipient: 'other@y.com' })];
    expect(filterJobs(rows, { search: 'test@' })).toHaveLength(1);
  });

  it('filterJobs by date range', () => {
    const rows = [
      makeJob({ created_at: '2026-07-01T10:00:00Z' }),
      makeJob({ id: '2', created_at: '2026-07-05T10:00:00Z' }),
    ];
    expect(filterJobs(rows, { dateFrom: '2026-07-03' })).toHaveLength(1);
    expect(filterJobs(rows, { dateTo: '2026-07-03' })).toHaveLength(1);
    expect(filterJobs(rows, { dateFrom: '2026-07-01', dateTo: '2026-07-05' })).toHaveLength(2);
  });

  it('statusVariant returns correct variants', () => {
    expect(statusVariant('FAILED')).toBe('danger');
    expect(statusVariant('PENDING')).toBe('warning');
    expect(statusVariant('RESOLVED')).toBe('success');
    expect(statusVariant('UNKNOWN')).toBe('info');
  });

  it('fmtDateTime handles null and valid dates', () => {
    expect(fmtDateTime(null)).toBe('-');
    expect(fmtDateTime('-')).toBe('-');
    expect(fmtDateTime('2026-07-01T10:00:00Z')).not.toBe('-');
  });
});
