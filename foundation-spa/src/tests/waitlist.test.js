import { describe, it, expect } from 'vitest';
import { computeSummary, filterStudents, getAssignableClassOptions, fmt, daysSince, fillClass } from '../features/waitlist/lib/waitlist.js';

const makeStudent = (overrides) => ({
  id: '1', full_name: 'Jane Doe', email: 'jane@example.com', fellowship_code: 'FEL1',
  batch_id: 'b1', availability: 'Weekday evenings', availability_status: 'NO_MATCHING_TIME',
  registration_status: 'PENDING', waitlisted_at: null, created_at: '2026-06-20T10:00:00Z',
  ...overrides,
});

describe('waitlist lib', () => {
  it('computeSummary counts total and threshold buckets', () => {
    const students = [
      makeStudent({ id: '1', created_at: new Date(Date.now() - 20 * 86400000).toISOString() }),
      makeStudent({ id: '2', created_at: new Date(Date.now() - 10 * 86400000).toISOString() }),
      makeStudent({ id: '3', created_at: new Date().toISOString() }),
    ];
    const s = computeSummary({ students, classOptions: {}, activeBatch: '' });
    expect(s.total).toBe(3);
    expect(s.gt7).toBe(2);
    expect(s.gt14).toBe(1);
  });

  it('computeSummary finds uncovered fellowships', () => {
    const students = [makeStudent({ fellowship_code: 'FEL1' }), makeStudent({ id: '2', fellowship_code: 'FEL2' })];
    const classOptions = { c1: { fellowship_codes: ['FEL1'] } };
    const s = computeSummary({ students, classOptions, activeBatch: '' });
    expect(s.uncoveredCount).toBe(1);
  });

  it('computeSummary respects activeBatch filter', () => {
    const students = [makeStudent({ batch_id: 'b1' }), makeStudent({ id: '2', batch_id: 'b2' })];
    const s = computeSummary({ students, classOptions: {}, activeBatch: 'b1' });
    expect(s.total).toBe(1);
  });

  it('filterStudents filters by search', () => {
    const students = [makeStudent({ full_name: 'Jane Doe' }), makeStudent({ id: '2', full_name: 'Bob Smith', email: 'bob@example.com' })];
    expect(filterStudents(students, { search: 'jane' })).toHaveLength(1);
  });

  it('filterStudents filters by status', () => {
    const students = [
      makeStudent({ availability_status: 'NO_MATCHING_TIME', registration_status: 'PENDING' }),
      makeStudent({ id: '2', availability_status: 'CLASS_FULL', registration_status: 'WAITLISTED' }),
    ];
    expect(filterStudents(students, { statusFilter: 'NO_MATCHING_TIME' })).toHaveLength(1);
    expect(filterStudents(students, { statusFilter: 'WAITLISTED' })).toHaveLength(1);
  });

  it('filterStudents filters by fellowship', () => {
    const students = [makeStudent({ fellowship_code: 'FEL1' }), makeStudent({ id: '2', fellowship_code: 'FEL2' })];
    expect(filterStudents(students, { fellowshipFilter: 'FEL1' })).toHaveLength(1);
  });

  it('getAssignableClassOptions filters active+open and prioritizes matching fellowship', () => {
    const classOptions = {
      c1: { class_option_id: 'c1', active: true, enrollment_open: true, fellowship_codes: ['FEL2'], teacher_name: 'B' },
      c2: { class_option_id: 'c2', active: true, enrollment_open: true, fellowship_codes: ['FEL1'], teacher_name: 'A' },
      c3: { class_option_id: 'c3', active: false, enrollment_open: true, fellowship_codes: ['FEL1'], teacher_name: 'C' },
    };
    const options = getAssignableClassOptions(classOptions, 'FEL1');
    expect(options).toHaveLength(2);
    expect(options[0].class_option_id).toBe('c2');
  });

  it('fmt handles null and valid dates', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt('2026-06-20T10:00:00Z')).not.toBe('—');
  });

  it('daysSince computes day difference', () => {
    expect(daysSince(null)).toBeNull();
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(daysSince(tenDaysAgo)).toBe(10);
  });

  it('fillClass thresholds', () => {
    expect(fillClass(95)).toBe('danger');
    expect(fillClass(80)).toBe('warning');
    expect(fillClass(50)).toBe('success');
  });
});
