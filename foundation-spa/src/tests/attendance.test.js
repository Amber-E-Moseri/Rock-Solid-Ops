import { describe, it, expect } from 'vitest';
import { counts, classStatus, computeKpis, initials } from '../features/attendance/lib/attendance.js';

const makeClass = (overrides) => ({
  id: 1, time: 'Sun · 10:00 AM', loc: 'CE', teacher: 'T', session: '4b',
  flagSessions: [], submitted: false,
  roster: [{ name: 'A', status: 'present' }, { name: 'B', status: 'absent' }, { name: 'C', status: null }],
  ...overrides,
});

describe('attendance lib', () => {
  it('counts tallies present/late/absent/missing', () => {
    const c = counts(makeClass());
    expect(c).toEqual({ p: 1, l: 0, a: 1, m: 1, total: 3 });
  });

  it('classStatus returns ok when submitted', () => {
    expect(classStatus(makeClass({ submitted: true }))).toBe('ok');
  });

  it('classStatus returns miss when all unmarked', () => {
    expect(classStatus(makeClass({ roster: [{ name: 'A', status: null }] }))).toBe('miss');
  });

  it('classStatus returns part when partially marked', () => {
    expect(classStatus(makeClass())).toBe('part');
  });

  it('computeKpis computes rate and missing', () => {
    const classes = [
      makeClass({ id: 1, submitted: true, roster: [{ name: 'A', status: 'present' }] }),
      makeClass({ id: 2, submitted: false, roster: [{ name: 'B', status: null }] }),
    ];
    const kpis = computeKpis(classes);
    expect(kpis.rate).toBe('50%');
    expect(kpis.missing).toBe(1);
    expect(kpis.onTime).toBe('50%');
  });

  it('initials extracts first letters', () => {
    expect(initials('John Doe')).toBe('JD');
    expect(initials('Alice')).toBe('A');
    expect(initials('')).toBe('');
  });
});
