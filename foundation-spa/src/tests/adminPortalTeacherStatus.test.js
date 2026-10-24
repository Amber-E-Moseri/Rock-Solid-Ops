import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records the status filter used for each table, so the teacher lifecycle value can be checked.
const { filters } = vi.hoisted(() => ({ filters: [] }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => {
      const builder = {
        select() { return builder; },
        in(column, values) { filters.push({ table, op: 'in', column, values }); return builder; },
        eq(column, value) { filters.push({ table, op: 'eq', column, value }); return builder; },
        not() { return builder; },
        then(resolve, reject) { return Promise.resolve({ count: 0, data: [], error: null }).then(resolve, reject); },
      };
      return builder;
    },
  },
}));

import { fetchPortalStats } from '../features/admin-portal/lib/adminPortal.js';

beforeEach(() => {
  filters.length = 0;
});

describe('admin portal teacher count', () => {
  it('filters teachers on the lifecycle value ACTIVE, the only value the teachers.status check permits', async () => {
    await fetchPortalStats();

    const teacherFilter = filters.find((f) => f.table === 'teachers' && f.column === 'status');
    expect(teacherFilter).toEqual({ table: 'teachers', op: 'eq', column: 'status', value: 'ACTIVE' });
  });
});
