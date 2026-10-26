import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each table returns the result set in `responses`. A chainable builder resolves to that result.
const { responses } = vi.hoisted(() => ({ responses: {} }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => {
      const result = () => responses[table];
      const builder = {
        select() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        eq() { return builder; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
  },
}));

vi.mock('../releaseHolds.js', () => ({
  MOODLE_RETRY_CERTIFIED: false,
  MOODLE_RETRY_HOLD_MESSAGE: 'held',
}));

import { fetchBatches } from '../features/dashboards/lib/dashboard.js';

const BATCHES = [{ batch_id: 'B-1', name: 'Spring', start_date: '2026-01-01', active: true }];

beforeEach(() => {
  responses.batches = { data: BATCHES, error: null };
});

describe('fetchBatches student counts', () => {
  it('reports null, not zero, when the students count query fails', async () => {
    responses.students = { data: null, error: { message: 'permission denied' } };
    const [batch] = await fetchBatches();
    expect(batch.studentCount).toBeNull();
  });

  it('reports a real zero when the count query succeeds with no active students', async () => {
    responses.students = { data: [], error: null };
    const [batch] = await fetchBatches();
    expect(batch.studentCount).toBe(0);
  });

  it('counts active students per batch when the query succeeds', async () => {
    responses.students = { data: [{ batch_id: 'B-1' }, { batch_id: 'B-1' }], error: null };
    const [batch] = await fetchBatches();
    expect(batch.studentCount).toBe(2);
  });
});
