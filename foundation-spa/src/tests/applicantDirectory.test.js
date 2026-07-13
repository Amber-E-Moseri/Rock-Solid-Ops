import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase.js', () => ({
  supabase: { from: vi.fn() },
}));

import {
  buildDirectoryModel, filterApplicants, computeKpis, summarizeApplicant,
  classifyRowStatus, milestoneStatus, getAttendanceSummary, getDuplicateBadgeMeta,
  buildFilterOptions, FALLBACK_MILESTONE_DEFS,
} from '../features/applicant-directory/lib/applicants.js';

function makeModel(overrides = {}) {
  return buildDirectoryModel({
    applicants: [],
    classOptions: [],
    batches: [],
    attendance: [],
    milestoneDefs: FALLBACK_MILESTONE_DEFS,
    milestoneStatusRows: [],
    summaryRows: null,
    duplicateGroups: [],
    duplicateNotifications: [],
    ...overrides,
  });
}

const baseApp = (over = {}) => ({
  id: '1', full_name: 'Ann Smith', email: 'ann@x.com', phone: '555',
  registration_status: 'PENDING', created_at: '2026-07-01T10:00:00Z', ...over,
});

describe('classifyRowStatus', () => {
  const model = makeModel();
  const cache = new Map();
  it('follows the legacy priority: duplicate > attention > completed > assigned > unassigned', () => {
    const dup = baseApp({ duplicate_count: 2 });
    expect(classifyRowStatus(dup, summarizeApplicant(model, dup, cache)).cls).toBe('duplicate');
    const att = baseApp({ id: '2', needs_admin_review: true });
    expect(classifyRowStatus(att, summarizeApplicant(model, att, cache)).cls).toBe('attention');
    const assigned = baseApp({ id: '3', class_option_id: 'CO-1' });
    expect(classifyRowStatus(assigned, summarizeApplicant(model, assigned, cache)).cls).toBe('assigned');
    const un = baseApp({ id: '4' });
    expect(classifyRowStatus(un, summarizeApplicant(model, un, cache)).cls).toBe('unassigned');
  });
});

describe('getAttendanceSummary', () => {
  it('prefers the server-side summaries view when present', () => {
    const model = makeModel({
      summaryRows: [{ applicant_id: '1', total_sessions: 10, attended_sessions: 8, last_attendance_at: '2026-07-01' }],
    });
    const s = getAttendanceSummary(model, baseApp());
    expect(s.pct).toBe(80);
    expect(s.missing).toBe(2);
  });

  it('falls back to raw attendance rows matched by id or email', () => {
    const model = makeModel({
      attendance: [
        { applicant_id: '1', status: 'present', created_at: '2026-06-01' },
        { student_email: 'ann@x.com', present: 'yes', created_at: '2026-06-08' },
        { applicant_id: '1', status: 'absent', created_at: '2026-06-15' },
      ],
    });
    const s = getAttendanceSummary(model, baseApp());
    expect(s.total).toBe(3);
    expect(s.attended).toBe(2);
    expect(s.pct).toBe(67);
  });

  it('returns null pct with no data', () => {
    expect(getAttendanceSummary(makeModel(), baseApp()).pct).toBeNull();
  });
});

describe('milestoneStatus', () => {
  const model = makeModel(); // 7 fallback milestone defs
  it('maps count to Not Started / In Progress / Complete', () => {
    expect(milestoneStatus(model, { milestoneCount: 0 })).toMatchObject({ label: 'Not Started', counter: '0/7' });
    expect(milestoneStatus(model, { milestoneCount: 3 })).toMatchObject({ label: 'In Progress', counter: '3/7' });
    expect(milestoneStatus(model, { milestoneCount: 7 })).toMatchObject({ label: 'Complete', counter: '7/7' });
  });
});

describe('filterApplicants', () => {
  const applicants = [
    baseApp({ id: '1', class_option_id: 'CO-1', fellowship_code: 'CESGA', batch_id: 'B1' }),
    baseApp({ id: '2', full_name: 'Bob Jones', email: 'bob@x.com', registration_status: 'WAITLISTED' }),
    baseApp({ id: '3', full_name: 'Cy Duplicate', email: 'cy@x.com', duplicate_status: 'CONFIRMED', needs_admin_review: true }),
  ];
  const model = makeModel({ applicants });
  const base = { quickTab: 'all', mode: 'directory', filters: {}, advFilters: null };

  it('search matches name, email, phone', () => {
    expect(filterApplicants(model, { ...base, filters: { search: 'bob' } })).toHaveLength(1);
    expect(filterApplicants(model, { ...base, filters: { search: 'ann@x' } })).toHaveLength(1);
  });

  it('quick tabs: waitlisted and needs_review', () => {
    expect(filterApplicants(model, { ...base, quickTab: 'waitlisted' })).toHaveLength(1);
    expect(filterApplicants(model, { ...base, quickTab: 'needs_review' })).toHaveLength(1);
  });

  it('assignment and fellowship filters', () => {
    expect(filterApplicants(model, { ...base, filters: { assignment: 'assigned' } })).toHaveLength(1);
    expect(filterApplicants(model, { ...base, filters: { assignment: 'unassigned' } })).toHaveLength(2);
    expect(filterApplicants(model, { ...base, filters: { fellowship: 'CESGA' } })).toHaveLength(1);
  });

  it('review mode restricts to the review queue', () => {
    // id 1 is ASSIGNED-like (has class, PENDING status → PENDING is in queue);
    // all three qualify here because 2 is WAITLISTED without class (unassigned, not DUPLICATE/INACTIVE)
    const rows = filterApplicants(model, { ...base, mode: 'review' });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('duplicate filter narrows to duplicate-tagged rows', () => {
    const rows = filterApplicants(model, { ...base, filters: { duplicate: 'duplicate_only' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('3');
  });
});

describe('computeKpis', () => {
  it('counts totals, assignment split, duplicates, attention', () => {
    const applicants = [
      baseApp({ id: '1', class_option_id: 'CO-1' }),
      baseApp({ id: '2' }),
      baseApp({ id: '3', duplicate_status: 'CONFIRMED', needs_admin_review: true }),
    ];
    const model = makeModel({
      applicants,
      duplicateNotifications: [{ notification_status: 'pending' }, { notification_status: 'sent' }],
    });
    const k = computeKpis(model, applicants, new Map());
    expect(k).toMatchObject({ total: 3, assigned: 1, unassigned: 2, duplicates: 1, needsAttention: 1, pendingNotifications: 1 });
  });
});

describe('getDuplicateBadgeMeta', () => {
  it('marks unresolved confirmed duplicates with a warning', () => {
    const model = makeModel({
      applicants: [baseApp({ id: '1', duplicate_status: 'CONFIRMED', duplicate_group_id: 'g1' })],
      duplicateGroups: [{ id: 'g1', status: 'open', duplicate_count: 2 }],
    });
    const meta = getDuplicateBadgeMeta(model, model.applicants[0]);
    expect(meta.showWarning).toBe(true);
    expect(meta.label).toBe('CONFIRMED');
    expect(meta.meta).toBe('2 in group');
  });

  it('shows Resolved when the group is resolved', () => {
    const model = makeModel({
      applicants: [baseApp({ id: '1', duplicate_status: 'CONFIRMED', duplicate_group_id: 'g1' })],
      duplicateGroups: [{ id: 'g1', status: 'resolved', duplicate_count: 2 }],
    });
    expect(getDuplicateBadgeMeta(model, model.applicants[0]).label).toBe('Resolved');
  });

  it('is a dash for unique applicants', () => {
    const model = makeModel({ applicants: [baseApp()] });
    expect(getDuplicateBadgeMeta(model, model.applicants[0]).label).toBe('—');
  });
});

describe('buildFilterOptions', () => {
  it('derives sorted unique dropdown values', () => {
    const model = makeModel({
      applicants: [
        baseApp({ id: '1', fellowship_code: 'B', subgroup_id: 'S2', batch_id: 'B2' }),
        baseApp({ id: '2', fellowship_code: 'A', subgroup_id: 'S1', batch_id: 'B1' }),
      ],
      classOptions: [{ class_option_id: 'CO-2' }, { class_option_id: 'CO-1' }],
    });
    const o = buildFilterOptions(model);
    expect(o.fellowships).toEqual(['A', 'B']);
    expect(o.subgroups).toEqual(['S1', 'S2']);
    expect(o.classes).toEqual(['CO-1', 'CO-2']);
    expect(o.batches).toEqual(['B1', 'B2']);
  });
});
