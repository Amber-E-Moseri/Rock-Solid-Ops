import { describe, it, expect } from 'vitest';
import { fmtDateTime } from '../features/system-health/lib/system-health.js';

describe('system-health formatters', () => {
  it('fmtDateTime handles ISO string', () => {
    const result = fmtDateTime('2026-07-01T10:00:00Z');
    expect(result).not.toBe('-');
  });

  it('fmtDateTime handles null and dash', () => {
    expect(fmtDateTime(null)).toBe('-');
    expect(fmtDateTime('-')).toBe('-');
    expect(fmtDateTime('')).toBe('-');
  });
});
