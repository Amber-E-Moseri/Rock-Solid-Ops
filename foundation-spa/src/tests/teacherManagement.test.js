import { describe, it, expect } from 'vitest';
import { filterTeachers, fmtDate, STATUS_TABS } from '../features/teacher-management/lib/teacherManagement.js';

const makeTeacher = (overrides) => ({
  teacher_id: 't1', full_name: 'Jane Doe', email: 'jane@test.com',
  fellowship_code: 'FCH', group_id: 'G1', subgroup_id: 'SG1', status: 'PENDING',
  ...overrides,
});

describe('teacherManagement lib', () => {
  it('filterTeachers filters by tab/status', () => {
    const teachers = [makeTeacher({ status: 'PENDING' }), makeTeacher({ teacher_id: 't2', status: 'ACTIVE' })];
    expect(filterTeachers(teachers, { tab: 'ACTIVE' })).toHaveLength(1);
    expect(filterTeachers(teachers, { tab: 'ALL' })).toHaveLength(2);
  });

  it('filterTeachers filters by search across multiple fields', () => {
    const teachers = [makeTeacher({ full_name: 'Jane Doe' }), makeTeacher({ teacher_id: 't2', full_name: 'Bob Smith', email: 'bob@test.com' })];
    expect(filterTeachers(teachers, { tab: 'ALL', search: 'jane' })).toHaveLength(1);
    expect(filterTeachers(teachers, { tab: 'ALL', search: 'bob@test.com' })).toHaveLength(1);
  });

  it('filterTeachers filters by group and subgroup', () => {
    const teachers = [makeTeacher({ group_id: 'G1', subgroup_id: 'SG1' }), makeTeacher({ teacher_id: 't2', group_id: 'G2', subgroup_id: 'SG2' })];
    expect(filterTeachers(teachers, { tab: 'ALL', group: 'G2' })).toHaveLength(1);
    expect(filterTeachers(teachers, { tab: 'ALL', subgroup: 'SG1' })).toHaveLength(1);
  });

  it('fmtDate formats a valid timestamp', () => {
    expect(fmtDate('2026-06-01T00:00:00Z')).toContain('2026');
  });

  it('fmtDate returns dash for empty input', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });

  it('STATUS_TABS includes all expected statuses', () => {
    expect(STATUS_TABS).toEqual(['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'ALL']);
  });
});
