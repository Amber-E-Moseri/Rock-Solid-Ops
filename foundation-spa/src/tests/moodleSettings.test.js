import { describe, it, expect } from 'vitest';
import { validateMapping, fmtDate } from '../features/moodle-settings/lib/moodle-settings.js';

describe('moodle-settings lib', () => {
  it('validateMapping requires all fields', () => {
    expect(validateMapping({ batchId: '', groupId: 'CSGA', courseId: '5' })).toMatch(/required/);
    expect(validateMapping({ batchId: '2026A', groupId: '', courseId: '5' })).toMatch(/required/);
    expect(validateMapping({ batchId: '2026A', groupId: 'CSGA', courseId: '' })).toMatch(/required/);
  });

  it('validateMapping requires numeric course id', () => {
    expect(validateMapping({ batchId: '2026A', groupId: 'CSGA', courseId: 'abc' })).toMatch(/numeric/);
    expect(validateMapping({ batchId: '2026A', groupId: 'CSGA', courseId: '42' })).toBeNull();
  });

  it('fmtDate handles null and valid dates', () => {
    expect(fmtDate(null)).toBe('-');
    expect(fmtDate('2026-07-01T10:00:00Z')).not.toBe('-');
  });
});
