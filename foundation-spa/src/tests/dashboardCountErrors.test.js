import { describe, it, expect, vi, beforeEach } from 'vitest';

// Table reads return a fixed count; RPCs and tables can be failed one at a time.
const { rpcCalls, tableCalls, failRpc, failTable, teacherCount } = vi.hoisted(() => ({
  rpcCalls: [], tableCalls: [], failRpc: new Set(), failTable: new Set(), teacherCount: { value: 2 },
}));

vi.mock('../supabase.js', () => {
  const result = (table, count) => {
    if (failTable.has(table)) return { data: null, count: null, error: { message: `relation "${table}" failed` } };
    return { data: [], count: table === 'teachers' ? teacherCount.value : 0, error: null };
  };
  return {
    supabase: {
      from: (table) => {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          is() { return builder; },
          in() { return builder; },
          not() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          gte() { return builder; },
          lte() { return builder; },
          then(resolve, reject) {
            tableCalls.push(table);
            return Promise.resolve(result(table)).then(resolve, reject);
          },
        };
        return builder;
      },
      rpc: (name) => {
        rpcCalls.push(name);
        if (failRpc.has(name)) return Promise.resolve({ data: null, error: { message: `${name} failed` } });
        return Promise.resolve({ data: name === 'get_currently_teaching_count' ? 1 : [], error: null });
      },
      auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    },
  };
});

import { fetchDashboardData } from '../features/dashboards/lib/dashboard.js';

beforeEach(() => {
  rpcCalls.length = 0;
  tableCalls.length = 0;
  failRpc.clear();
  failTable.clear();
  teacherCount.value = 2;
});

describe('dashboard active-teacher count', () => {
  it('counts teachers by the lifecycle column status = ACTIVE, not by the certified RPC', async () => {
    const data = await fetchDashboardData(null, null);

    expect(data.teacherKpis.activeTeachers).toBe(2);
    expect(rpcCalls).not.toContain('get_active_certified_teachers_count');
  });

  it('reports the active-teacher count as unknown, not zero, when its query fails', async () => {
    failTable.add('teachers');
    const data = await fetchDashboardData(null, null);
    expect(data.teacherKpis.activeTeachers).toBeNull();
  });

  it('reports a genuine zero as zero', async () => {
    teacherCount.value = 0;
    const data = await fetchDashboardData(null, null);
    expect(data.teacherKpis.activeTeachers).toBe(0);
  });

  it('reports currently-teaching as unknown when its RPC fails', async () => {
    failRpc.add('get_currently_teaching_count');
    const data = await fetchDashboardData(null, null);
    expect(data.teacherKpis.currentlyTeaching).toBeNull();
    expect(data.teacherKpis.activeTeachers).toBe(2);
  });
});

describe('dashboard queue and duplicate counts', () => {
  it('reports the stale-review count as unknown when its RPC fails', async () => {
    failRpc.add('get_stale_queue_items');
    const data = await fetchDashboardData(null, null);
    expect(data.staleQueue).toBeNull();
  });

  it('reports the duplicate count as unknown when its query fails', async () => {
    failTable.add('duplicate_registration_groups');
    const data = await fetchDashboardData(null, null);
    expect(data.duplicates.count).toBeNull();
  });
});
