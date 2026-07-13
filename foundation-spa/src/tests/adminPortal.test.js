import { describe, it, expect, vi, afterEach } from 'vitest';
import { greeting, relTime } from '../features/admin-portal/lib/adminPortal.js';

describe('adminPortal lib', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('greeting returns morning/afternoon/evening based on hour', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-01-01T08:00:00'));
    expect(greeting()).toBe('Good morning');

    vi.setSystemTime(new Date('2026-01-01T14:00:00'));
    expect(greeting()).toBe('Good afternoon');

    vi.setSystemTime(new Date('2026-01-01T20:00:00'));
    expect(greeting()).toBe('Good evening');
  });

  it('relTime returns empty string for falsy input', () => {
    expect(relTime(null)).toBe('');
    expect(relTime('')).toBe('');
  });

  it('relTime formats recent timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));

    expect(relTime(new Date('2026-01-01T12:00:00Z').toISOString())).toBe('just now');
    expect(relTime(new Date('2026-01-01T11:55:00Z').toISOString())).toBe('5m ago');
    expect(relTime(new Date('2026-01-01T09:00:00Z').toISOString())).toBe('3h ago');
    expect(relTime(new Date('2025-12-30T12:00:00Z').toISOString())).toBe('2d ago');
  });
});
