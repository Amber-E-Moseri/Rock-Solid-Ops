import { describe, it, expect } from 'vitest';
import { initials, SESSIONS } from '../features/teacher-attendance/lib/teacherAttendance.js';

describe('teacherAttendance lib', () => {
  it('initials extracts first letters of up to two words', () => {
    expect(initials('Jane Doe')).toBe('JD');
    expect(initials('Alice')).toBe('A');
    expect(initials('Jane Middle Doe')).toBe('JM');
  });

  it('initials falls back to ? for empty name', () => {
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });

  it('SESSIONS contains 8 fixed session identifiers', () => {
    expect(SESSIONS).toHaveLength(8);
    expect(SESSIONS).toContain('Class4A');
    expect(SESSIONS).toContain('Class4B');
  });
});
