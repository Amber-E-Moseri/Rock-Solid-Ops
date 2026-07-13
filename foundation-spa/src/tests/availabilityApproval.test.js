import { describe, it, expect } from 'vitest';
import {
  computeKpis, filterSubmissions, getFilterOptions, fmtMonth, statusVariant, buildSlotSet,
} from '../features/availability-approval/lib/availabilityApproval.js';

const makeSub = (overrides) => ({
  id: '1', teacher_name: 'Jane', teacher_email: 'jane@test.com', month: '2026-06',
  campuses: ['FCH'], slots: [{ day: 1, time: '09:00' }], status: 'pending',
  notes: '', review_note: '', created_at: '2026-06-01T00:00:00Z',
  ...overrides,
});

describe('availability-approval lib', () => {
  it('computeKpis counts by status', () => {
    const subs = [makeSub({ status: 'pending' }), makeSub({ id: '2', status: 'approved' }), makeSub({ id: '3', status: 'rejected' })];
    const kpis = computeKpis(subs);
    expect(kpis).toEqual({ total: 3, pending: 1, approved: 1, rejected: 1 });
  });

  it('filterSubmissions filters by search', () => {
    const subs = [makeSub({ teacher_name: 'Jane' }), makeSub({ id: '2', teacher_name: 'Bob', teacher_email: 'bob@test.com' })];
    expect(filterSubmissions(subs, { search: 'jane' })).toHaveLength(1);
  });

  it('filterSubmissions filters by status', () => {
    const subs = [makeSub({ status: 'pending' }), makeSub({ id: '2', status: 'approved' })];
    expect(filterSubmissions(subs, { status: 'approved' })).toHaveLength(1);
  });

  it('filterSubmissions filters by month', () => {
    const subs = [makeSub({ month: '2026-06' }), makeSub({ id: '2', month: '2026-07' })];
    expect(filterSubmissions(subs, { month: '2026-07' })).toHaveLength(1);
  });

  it('filterSubmissions filters by campus', () => {
    const subs = [makeSub({ campuses: ['FCH'] }), makeSub({ id: '2', campuses: ['FCE'] })];
    expect(filterSubmissions(subs, { campus: 'FCE' })).toHaveLength(1);
  });

  it('getFilterOptions extracts unique months and campuses', () => {
    const subs = [makeSub({ month: '2026-06', campuses: ['FCH', 'FCS'] }), makeSub({ id: '2', month: '2026-07', campuses: ['FCE'] })];
    const opts = getFilterOptions(subs);
    expect(opts.months).toEqual(['2026-06', '2026-07']);
    expect(opts.campuses).toEqual(['FCE', 'FCH', 'FCS']);
  });

  it('fmtMonth formats month string', () => {
    expect(fmtMonth('2026-06')).toContain('2026');
    expect(fmtMonth(null)).toBe('—');
  });

  it('statusVariant maps status to badge variant', () => {
    expect(statusVariant('approved')).toBe('success');
    expect(statusVariant('rejected')).toBe('danger');
    expect(statusVariant('pending')).toBe('warning');
  });

  it('buildSlotSet creates lookup set', () => {
    const set = buildSlotSet([{ day: 1, time: '09:00' }, { day: 3, time: '14:00' }]);
    expect(set.has('1:09:00')).toBe(true);
    expect(set.has('3:14:00')).toBe(true);
    expect(set.has('0:09:00')).toBe(false);
  });
});
