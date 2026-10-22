import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every write, and lets a test fail a specific table's write.
const { calls, failures } = vi.hoisted(() => ({ calls: [], failures: {} }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => {
      const state = { ops: [], payload: null };
      const result = () => (failures[table] && state.ops.includes('update')
        ? { data: null, error: failures[table] }
        : { data: [], error: null });
      const builder = {
        update(payload) { state.ops.push('update'); state.payload = payload; calls.push({ table, op: 'update', payload }); return builder; },
        insert(payload) { calls.push({ table, op: 'insert', payload }); return Promise.resolve({ data: null, error: null }); },
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        limit() { return builder; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
  },
}));

import { performAction } from '../features/teacher-management/lib/teacherManagement.js';

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(failures)) delete failures[key];
});

const writesTo = (table) => calls.filter((c) => c.table === table && c.op === 'update');

describe('performAction suspend uses the teacher lifecycle only', () => {
  it('writes the teacher lifecycle status and suspension fields', async () => {
    await performAction('T-1', 'suspend', 'reason', 'admin@test.com', null);

    expect(writesTo('teachers')).toHaveLength(1);
    expect(writesTo('teachers')[0].payload).toMatchObject({ status: 'SUSPENDED', active: false, suspended_reason: 'reason' });
  });

  it('never writes Suspended to teacher_availability', async () => {
    await performAction('T-1', 'suspend', 'reason', 'admin@test.com', 'user-1');

    expect(writesTo('teacher_availability')).toHaveLength(0);
    expect(calls.some((c) => c.payload && JSON.stringify(c.payload).includes('"Suspended"'))).toBe(false);
  });

  it('blocks sign-in through the linked profile, as the existing contract does', async () => {
    await performAction('T-1', 'suspend', 'reason', 'admin@test.com', 'user-1');

    expect(writesTo('profiles')[0].payload).toEqual({ is_active: false });
  });

  it('surfaces a refused teacher write, and no success follows', async () => {
    failures.teachers = { message: 'permission denied for table teachers' };

    await expect(performAction('T-1', 'suspend', 'reason', 'admin@test.com', null))
      .rejects.toMatchObject({ message: 'permission denied for table teachers' });
    expect(writesTo('profiles')).toHaveLength(0);
    expect(calls.some((c) => c.table === 'email_queue')).toBe(false);
  });

  it('leaves availability alone for other actions', async () => {
    await performAction('T-1', 'activate', '', 'admin@test.com', null);
    expect(writesTo('teacher_availability')).toHaveLength(0);
  });
});
