import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every table read and returns fixed rows. A test can fail one table.
const { calls, tables, failures } = vi.hoisted(() => ({ calls: [], tables: {}, failures: {} }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => {
      const state = { table, filters: [] };
      const result = () => (failures[table]
        ? { data: null, error: failures[table] }
        : { data: tables[table] || [], error: null });
      const builder = {
        select(cols) { state.cols = cols; return builder; },
        eq(column, value) { state.filters.push({ op: 'eq', column, value }); return builder; },
        is(column, value) { state.filters.push({ op: 'is', column, value }); return builder; },
        in(column, values) { state.filters.push({ op: 'in', column, values }); return builder; },
        order() { return builder; },
        limit() { calls.push({ table, filters: state.filters.slice(), cols: state.cols }); return builder; },
        then(resolve, reject) { calls.push({ table, filters: state.filters.slice(), cols: state.cols }); return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
  },
}));

import { fetchClasses, classStatus, computeKpis } from '../features/attendance/lib/attendance.js';

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(tables)) delete tables[key];
  for (const key of Object.keys(failures)) delete failures[key];
});

const CLASS_ROW = {
  class_option_id: 'CO-SG1-MON-0900-T1', teacher_id: 'T-1', teacher_name: 'Jane Teacher',
  subgroup_id: 'SG1', day: 'Mon', class_time: '09:00:00',
};

describe('attendance read contract', () => {
  it('reads active, undeleted class options and their active roster from the tracked tables only', async () => {
    tables.class_options = [CLASS_ROW];
    tables.class_roster = [{ class_option_id: CLASS_ROW.class_option_id, student_id: 's-1', status: 'Active', students: { full_name: 'Ann Student' } }];

    await fetchClasses();

    const optionCall = calls.find((c) => c.table === 'class_options');
    expect(optionCall.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'active', value: true },
      { op: 'is', column: 'deleted_at', value: null },
    ]));
    const rosterCall = calls.find((c) => c.table === 'class_roster');
    expect(rosterCall.filters).toEqual(expect.arrayContaining([
      { op: 'in', column: 'class_option_id', values: [CLASS_ROW.class_option_id] },
      { op: 'eq', column: 'status', value: 'Active' },
    ]));
    // The untracked or wrong-status sources are not read.
    expect(calls.some((c) => c.table === 'teacher_availability' || c.table === 'attendance_log')).toBe(false);
  });

  it('maps a class and its roster names, and records no submission state', async () => {
    tables.class_options = [CLASS_ROW];
    tables.class_roster = [{ class_option_id: CLASS_ROW.class_option_id, student_id: 's-1', status: 'Active', students: { full_name: 'Ann Student' } }];

    const [cls] = await fetchClasses();

    expect(cls).toMatchObject({ id: CLASS_ROW.class_option_id, loc: 'SG1', teacher: 'Jane Teacher', submitted: null });
    expect(cls.roster).toEqual([{ name: 'Ann Student', student_id: 's-1', status: null }]);
  });

  it('returns no classes, and reads no roster, for a successful empty class list', async () => {
    tables.class_options = [];

    const classes = await fetchClasses();

    expect(classes).toEqual([]);
    expect(calls.some((c) => c.table === 'class_roster')).toBe(false);
  });

  it('propagates a class-list failure rather than returning an empty list', async () => {
    failures.class_options = { message: 'permission denied for table class_options' };

    await expect(fetchClasses()).rejects.toMatchObject({ message: 'permission denied for table class_options' });
  });
});

describe('attendance unknown states are not zero', () => {
  it('reports submission-derived KPIs as unavailable when submission state is not loaded', () => {
    const kpis = computeKpis([{ submitted: null, roster: [{ status: null }] }]);
    expect(kpis).toEqual({ rate: '—', missing: '—', flagged: '—', onTime: '—' });
  });

  it('reports KPIs for an empty class list without inventing submission rates', () => {
    expect(computeKpis([])).toEqual({ rate: '—', missing: '—', flagged: '—', onTime: '—' });
  });

  it('classifies a class without known submission state as unknown, not missing', () => {
    expect(classStatus({ submitted: null, roster: [{ status: null }] })).toBe('unknown');
  });
});
