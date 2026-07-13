import { describe, it, expect } from 'vitest';
import { to24h, convertSlot, monthOptions, DAYS, SLOTS } from '../features/teacher-schedule/lib/teacherSchedule.js';

describe('teacherSchedule lib', () => {
  it('to24h converts 12h time to 24h', () => {
    expect(to24h('9:00 AM')).toBe('09:00:00');
    expect(to24h('12:00 PM')).toBe('12:00:00');
    expect(to24h('12:00 AM')).toBe('00:00:00');
    expect(to24h('11:30 PM')).toBe('23:30:00');
  });

  it('to24h passes through unparseable input', () => {
    expect(to24h('garbage')).toBe('garbage');
  });

  it('convertSlot returns same day/time for identical timezones', () => {
    const result = convertSlot('Monday', '10:00 AM', 'America/Toronto', 'America/Toronto', 2026, 0);
    expect(result.day).toBe('Monday');
    expect(result.time).toBe('10:00 AM');
  });

  it('convertSlot falls back gracefully on invalid day', () => {
    const result = convertSlot('NotADay', '10:00 AM', 'America/Toronto', 'America/Vancouver', 2026, 0);
    expect(result).toEqual({ day: 'NotADay', time: '10:00 AM' });
  });

  it('monthOptions returns requested count with label/year/month', () => {
    const opts = monthOptions(3);
    expect(opts).toHaveLength(3);
    expect(opts[0]).toHaveProperty('label');
    expect(opts[0]).toHaveProperty('year');
    expect(opts[0]).toHaveProperty('month');
  });

  it('DAYS and SLOTS are non-empty fixed lists', () => {
    expect(DAYS).toHaveLength(7);
    expect(SLOTS.length).toBeGreaterThan(0);
  });
});
