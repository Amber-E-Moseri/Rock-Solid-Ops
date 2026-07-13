import { describe, it, expect } from 'vitest';
import {
  normFaith, faithBadgeVariant, computeChecks, computeProgressPct, filterStudents, computeStats, buildCsv, CLASS_COLUMNS,
} from '../features/student-progress/lib/studentProgress.js';

const makeStudent = (overrides) => ({
  studentId: 's1', fullName: 'Jane Doe', bornAgain: 'Yes', speaksInTongues: 'No', waterBaptized: null,
  attendance: { Class1: true, Class2: false }, milestones: { M1: true, M2: false },
  ...overrides,
});

describe('student-progress lib', () => {
  it('normFaith defaults to unsure', () => {
    expect(normFaith(null)).toBe("I'm not sure");
    expect(normFaith('')).toBe("I'm not sure");
    expect(normFaith('Yes')).toBe('Yes');
  });

  it('faithBadgeVariant maps values', () => {
    expect(faithBadgeVariant('born', 'Yes')).toBe('success');
    expect(faithBadgeVariant('born', 'No')).toBe('warning');
    expect(faithBadgeVariant('water', 'No')).toBe('danger');
    expect(faithBadgeVariant('born', null)).toBe('info');
  });

  it('computeChecks reads attendance for classes view', () => {
    const s = makeStudent();
    const checks = computeChecks(s, 'classes', [], ['Class1', 'Class2']);
    expect(checks).toEqual([true, false]);
  });

  it('computeChecks reads milestones for milestones view', () => {
    const s = makeStudent();
    const milestones = [{ code: 'M1' }, { code: 'M2' }];
    const checks = computeChecks(s, 'milestones', milestones, []);
    expect(checks).toEqual([true, false]);
  });

  it('computeProgressPct computes percentage', () => {
    expect(computeProgressPct([true, true, false, false])).toBe(50);
    expect(computeProgressPct([])).toBe(0);
  });

  it('filterStudents filters by search', () => {
    const students = [makeStudent({ fullName: 'Jane Doe', studentId: 's1' }), makeStudent({ fullName: 'Bob Smith', studentId: 's2' })];
    expect(filterStudents(students, { search: 'jane', classCols: CLASS_COLUMNS })).toHaveLength(1);
  });

  it('filterStudents filters at-risk (attendance < 75%)', () => {
    const students = [
      makeStudent({ studentId: 's1', attendance: { Class1: true, Class2: true, Class3: true, Class4A: true } }),
      makeStudent({ studentId: 's2', attendance: { Class1: false, Class2: false } }),
    ];
    const classCols = ['Class1', 'Class2', 'Class3', 'Class4A'];
    const atRisk = filterStudents(students, { atRiskOnly: true, classCols });
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0].studentId).toBe('s2');
  });

  it('computeStats aggregates totals and per-column counts', () => {
    const students = [
      makeStudent({ studentId: 's1', attendance: { Class1: true, Class2: false } }),
      makeStudent({ studentId: 's2', attendance: { Class1: true, Class2: true } }),
    ];
    const stats = computeStats(students, 'classes', [], ['Class1', 'Class2']);
    expect(stats.total).toBe(2);
    expect(stats.overallPct).toBe(75);
    expect(stats.perColumn).toEqual([2, 1]);
  });

  it('buildCsv includes header and rows', () => {
    const students = [makeStudent({ studentId: 's1', fullName: 'Jane Doe', attendance: { Class1: true, Class2: false } })];
    const csv = buildCsv(students, 'classes', [], ['Class1', 'Class2']);
    expect(csv).toContain('StudentID,Name,Class1,Class2,Attended,Total,Pct');
    expect(csv).toContain('s1,Jane Doe,1,0,1,2,50%');
  });
});
