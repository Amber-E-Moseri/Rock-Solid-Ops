import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every write, and lets a test fail a specific table's write.
const { calls, failures } = vi.hoisted(() => ({ calls: [], failures: {} }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => {
      const state = { table, ops: [], payload: null };
      const result = () => (failures[table] && state.payload && state.ops.includes('update')
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

describe('performAction suspend', () => {
  it('does not change the teacher when the availability write is refused, and surfaces the database message', async () => {
    failures.teacher_availability = { message: 'new row violates check constraint "teacher_availability_status_check"' };

    await expect(performAction('T-1', 'suspend', 'reason', 'admin@test.com', null))
      .rejects.toThrow('Teacher not suspended. Availability could not be updated: new row violates check constraint');

    expect(writesTo('teachers')).toHaveLength(0);
    expect(calls.some((c) => c.table === 'email_queue')).toBe(false);
  });

  it('suspends the availability first, then the teacher, when both writes succeed', async () => {
    await performAction('T-1', 'suspend', 'reason', 'admin@test.com', null);

    const availability = writesTo('teacher_availability');
    expect(availability).toHaveLength(1);
    expect(availability[0].payload).toEqual({ status: 'Suspended' });

    const teacherIndex = calls.findIndex((c) => c.table === 'teachers' && c.op === 'update');
    const availabilityIndex = calls.findIndex((c) => c.table === 'teacher_availability' && c.op === 'update');
    expect(availabilityIndex).toBeLessThan(teacherIndex);
    expect(writesTo('teachers')[0].payload).toMatchObject({ status: 'SUSPENDED', active: false });
  });

  it('does not touch availability for other actions', async () => {
    await performAction('T-1', 'activate', '', 'admin@test.com', null);
    expect(writesTo('teacher_availability')).toHaveLength(0);
    expect(writesTo('teachers')).toHaveLength(1);
  });
});
