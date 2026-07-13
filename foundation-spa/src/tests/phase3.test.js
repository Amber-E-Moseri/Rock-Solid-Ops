import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase.js', () => ({
  supabase: { from: vi.fn() },
}));

import { applyFilters, computeKpis, computeActorSummary } from '../features/admin-activity/lib/adminActivity.js';
import { filterProfiles, computeRoleKpis, ALL_ROLES } from '../features/role-audit/lib/roleAudit.js';

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe('admin-activity: applyFilters', () => {
  const logs = [
    { actor_email: 'admin@x.com', action: 'BATCH_CREATED', entity_type: 'batch', created_at: '2026-07-01T10:00:00Z' },
    { actor_email: 'other@x.com', action: 'ROLE_CHANGED', entity_type: 'user', created_at: '2026-06-01T10:00:00Z' },
  ];

  it('filters by actor substring case-insensitively', () => {
    expect(applyFilters(logs, { actor: 'ADMIN@' })).toHaveLength(1);
  });

  it('filters by exact action and entity type', () => {
    expect(applyFilters(logs, { action: 'ROLE_CHANGED' })).toHaveLength(1);
    expect(applyFilters(logs, { entityType: 'batch' })).toHaveLength(1);
  });

  it('filters by date range (from inclusive, to by day)', () => {
    expect(applyFilters(logs, { dateFrom: '2026-06-15' })).toHaveLength(1);
    expect(applyFilters(logs, { dateTo: '2026-06-15' })).toHaveLength(1);
    expect(applyFilters(logs, {})).toHaveLength(2);
  });
});

describe('admin-activity: computeKpis', () => {
  it('buckets by today / week / month', () => {
    const logs = [
      { created_at: new Date().toISOString() }, // today
      { created_at: day(3) },                   // this week
      { created_at: day(20) },                  // this month
      { created_at: day(60) },                  // older
    ];
    const k = computeKpis(logs);
    expect(k.today).toBe(1);
    expect(k.week).toBe(2);
    expect(k.month).toBe(3);
    expect(k.total).toBe(4);
  });
});

describe('admin-activity: computeActorSummary', () => {
  it('aggregates last-30-day actions per actor with top action, sorted by count', () => {
    const logs = [
      { actor_email: 'a@x.com', action: 'A1', created_at: day(1) },
      { actor_email: 'a@x.com', action: 'A1', created_at: day(2) },
      { actor_email: 'a@x.com', action: 'A2', created_at: day(3) },
      { actor_email: 'b@x.com', action: 'B1', created_at: day(4) },
      { actor_email: 'b@x.com', action: 'B1', created_at: day(45) }, // outside window
      { actor_email: null, action: 'S1', created_at: day(5) },       // system
    ];
    const summary = computeActorSummary(logs);
    expect(summary[0].email).toBe('a@x.com');
    expect(summary[0].count).toBe(3);
    expect(summary[0].topAction).toBe('A1');
    expect(summary.find((s) => s.email === 'b@x.com').count).toBe(1);
    expect(summary.some((s) => s.email === 'system')).toBe(true);
  });
});

describe('role-audit: filterProfiles', () => {
  const profiles = [
    { full_name: 'Sue Super', email: 'sue@x.com', role: 'superadmin', is_active: true },
    { full_name: 'Tim Teach', email: 'tim@x.com', role: 'teacher', is_active: true },
    { full_name: 'Pat Pastor', email: 'pat@x.com', role: 'pastor', is_active: false },
    { full_name: 'Pen Ding', email: 'pen@x.com', role: 'pending', is_active: true },
  ];

  it('filters by tab', () => {
    expect(filterProfiles(profiles, { tab: 'admin' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'teacher' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'pastor' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'pending' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'inactive' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'all' })).toHaveLength(4);
  });

  it('searches name and email', () => {
    expect(filterProfiles(profiles, { tab: 'all', search: 'tim@' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'all', search: 'pastor' })).toHaveLength(1);
    expect(filterProfiles(profiles, { tab: 'all', search: 'nobody' })).toHaveLength(0);
  });
});

describe('role-audit: computeRoleKpis', () => {
  it('counts each role group', () => {
    const k = computeRoleKpis([
      { role: 'superadmin', is_active: true },
      { role: 'admin', is_active: true },
      { role: 'teacher', is_active: false },
      { role: 'principal', is_active: true },
      { role: 'pending', is_active: true },
    ]);
    expect(k).toEqual({ total: 5, admins: 2, teachers: 1, pastors: 1, pending: 1, inactive: 1 });
  });

  it('role list covers all assignable platform roles', () => {
    expect(ALL_ROLES).toContain('regional_secretary');
    expect(ALL_ROLES).toContain('superadmin');
    expect(ALL_ROLES).toContain('pending');
  });
});
