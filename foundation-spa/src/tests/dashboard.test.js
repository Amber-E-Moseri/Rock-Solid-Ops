import { describe, it, expect } from 'vitest';
import { fmtDate, fmtTime, relativeMinutes, isRegionalSecretary, exportCapacityCsv } from '../features/dashboards/lib/dashboard.js';

describe('dashboard formatters', () => {
  it('fmtDate handles date-only strings', () => {
    const result = fmtDate('2026-07-01');
    expect(result).toContain('Jul');
    expect(result).toContain('1');
    expect(result).toContain('2026');
  });

  it('fmtDate handles null', () => {
    expect(fmtDate(null)).toBe('-');
    expect(fmtDate('')).toBe('-');
  });

  it('fmtTime handles ISO string', () => {
    const result = fmtTime('2026-07-01T10:00:00Z');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(5);
  });

  it('fmtTime handles null', () => {
    expect(fmtTime(null)).toBe('-');
  });

  it('relativeMinutes handles recent time', () => {
    const now = new Date().toISOString();
    expect(relativeMinutes(now)).toBe('just now');
  });

  it('relativeMinutes handles null', () => {
    expect(relativeMinutes(null)).toBe('-');
  });

  it('isRegionalSecretary identifies role', () => {
    expect(isRegionalSecretary('regional_secretary')).toBe(true);
    expect(isRegionalSecretary('REGIONAL_SECRETARY')).toBe(true);
    expect(isRegionalSecretary('admin')).toBe(false);
    expect(isRegionalSecretary(null)).toBe(false);
  });
});

describe('dashboard chart helpers', () => {
  it('exportCapacityCsv produces downloadable blob', () => {
    globalThis.URL.createObjectURL = () => 'blob:fake';
    const origCreateElement = document.createElement.bind(document);
    const clicks = [];
    const fakeLink = { href: '', download: '', click: () => clicks.push(1), remove: () => {} };
    document.createElement = (tag) => tag === 'a' ? fakeLink : origCreateElement(tag);
    document.body.appendChild = () => {};

    exportCapacityCsv([
      { classLabel: 'Sun 10:00 — FG', teacher_name: 'T1', enrolled: 5 },
    ]);
    expect(clicks.length).toBe(1);
    expect(fakeLink.download).toBe('students_by_class.csv');

    document.createElement = origCreateElement;
  });
});
