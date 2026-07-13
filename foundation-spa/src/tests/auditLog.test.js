import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client before importing the lib
const mockQuery = {
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  or: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  limit: vi.fn(),
};

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockQuery),
  },
}));

import { normalizeRow, fetchAuditLogs, CATEGORIES, DATE_RANGES } from '../features/audit-log/lib/auditLog.js';
import { supabase } from '../supabase.js';

function makeThenableQuery(result) {
  // Each chained method returns the query; awaiting it resolves to `result`
  const q = {};
  for (const key of ['select', 'order', 'range', 'or', 'eq', 'gte', 'limit']) {
    q[key] = vi.fn(() => q);
  }
  q.then = (resolve) => resolve(result);
  return q;
}

describe('normalizeRow', () => {
  it('maps canonical columns', () => {
    const row = normalizeRow({
      id: 1,
      actor_email: 'admin@school.org',
      action: 'BATCH_CREATED',
      entity_id: 'batch-42',
      entity_type: 'batch',
      created_at: '2026-07-01T10:00:00Z',
      status: 'success',
      details: { name: 'July cohort' },
    });
    expect(row.actor).toBe('admin@school.org');
    expect(row.action).toBe('BATCH_CREATED');
    expect(row.entityId).toBe('batch-42');
    expect(row.category).toBe('batch');
    expect(row.status).toBe('success');
    expect(row.details).toEqual({ name: 'July cohort' });
  });

  it('falls back to system actor and classifies categories from action text', () => {
    expect(normalizeRow({ id: 1, action: 'ATTENDANCE_MARKED' }).category).toBe('attendance');
    expect(normalizeRow({ id: 2, action: 'REGISTRATION_ASSIGNED' }).category).toBe('registration');
    expect(normalizeRow({ id: 3, action: 'ROLE_CHANGED' }).category).toBe('roles');
    expect(normalizeRow({ id: 4, action: 'MOODLE_SYNC_FAILED' }).category).toBe('sync');
    expect(normalizeRow({ id: 5, action: 'EMAIL_SENT' }).category).toBe('comms');
    expect(normalizeRow({ id: 6, action: 'SETTINGS_UPDATED' }).category).toBe('admin');
    expect(normalizeRow({ id: 7 }).actor).toBe('system');
  });

  it('resolves status variants from raw values', () => {
    expect(normalizeRow({ id: 1, status: 'FAILED' }).status).toBe('error');
    expect(normalizeRow({ id: 2, status: 'pending_retry' }).status).toBe('pending');
    expect(normalizeRow({ id: 3 }).status).toBe('success'); // default
  });
});

describe('fetchAuditLogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns normalized rows with pagination metadata', async () => {
    const q = makeThenableQuery({
      data: [
        { id: 1, actor_email: 'a@x.com', action: 'BATCH_CREATED', created_at: '2026-07-01' },
        { id: 2, actor_email: 'b@x.com', action: 'EMAIL_SENT', created_at: '2026-07-02' },
      ],
      count: 60,
      error: null,
    });
    supabase.from.mockReturnValue(q);

    const result = await fetchAuditLogs({ search: '', actor: '', dateRange: '7', category: '', page: 0 });

    expect(supabase.from).toHaveBeenCalledWith('audit_logs');
    expect(q.range).toHaveBeenCalledWith(0, 24);
    expect(q.gte).toHaveBeenCalled(); // 7-day cutoff applied
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(60);
    expect(result.totalPages).toBe(3);
  });

  it('applies category as a client-side filter', async () => {
    const q = makeThenableQuery({
      data: [
        { id: 1, action: 'BATCH_CREATED' },
        { id: 2, action: 'EMAIL_SENT' },
      ],
      count: 2,
      error: null,
    });
    supabase.from.mockReturnValue(q);

    const result = await fetchAuditLogs({ search: '', actor: '', dateRange: '', category: 'comms', page: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].category).toBe('comms');
  });

  it('applies actor and search filters server-side and throws on error', async () => {
    const q = makeThenableQuery({ data: [], count: 0, error: null });
    supabase.from.mockReturnValue(q);
    await fetchAuditLogs({ search: 'batch', actor: 'a@x.com', dateRange: '', category: '', page: 1 });
    expect(q.or).toHaveBeenCalledWith(expect.stringContaining('batch'));
    expect(q.eq).toHaveBeenCalledWith('actor_email', 'a@x.com');
    expect(q.range).toHaveBeenCalledWith(25, 49);

    const failing = makeThenableQuery({ data: null, count: null, error: new Error('RLS denied') });
    supabase.from.mockReturnValue(failing);
    await expect(fetchAuditLogs({ page: 0 })).rejects.toThrow('RLS denied');
  });
});

describe('filter constants', () => {
  it('expose all categories and date ranges', () => {
    expect(CATEGORIES.map((c) => c.value)).toEqual(['', 'attendance', 'batch', 'registration', 'roles', 'sync', 'comms', 'admin']);
    expect(DATE_RANGES.map((r) => r.value)).toEqual(['7', '30', '90', '']);
  });
});
