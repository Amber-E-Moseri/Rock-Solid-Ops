import { describe, it, expect } from 'vitest';
import { makeClient } from './teacherOnboardingHarness.js';
import {
  APPROVAL_CONTRACT_AVAILABLE,
  REVIEWER_ROLES,
  REVIEW_ACTIONS,
  STATUS_FILTERS,
  STATUS_LABELS,
  STATUS_TONES,
  escapeLike,
  fellowshipOptions,
  fetchRosterMatches,
  filterApplications,
  isDecidable,
  needsReload,
  reviewApplication,
  reviewErrorMessage,
  summarizeRoster,
} from '../features/teacher-applications/lib/reviewApi.js';
import {
  TEACHER_APPLICATION_EMAIL_CONTRACT,
  TEMPLATE_LABELS,
  auditEventLabel,
} from '../features/teacher-applications/lib/communications.js';

const ROWS = [
  { id: 'a', full_name: 'Alice Ahn', email: 'alice@example.org', phone: '555-0101', fellowship_code: 'CMU', status: 'SUBMITTED' },
  { id: 'b', full_name: 'Bruno Bell', email: 'bruno@example.org', phone: null, fellowship_code: 'UOFT', status: 'INFO_REQUESTED' },
  { id: 'c', full_name: 'Carla Cole', email: 'carla@example.org', phone: '555-0303', fellowship_code: 'CMU', status: 'REJECTED' },
];

describe('reviewer access', () => {
  it('admits only admin and superadmin to the review queue', () => {
    expect([...REVIEWER_ROLES].sort()).toEqual(['admin', 'superadmin']);
  });

  it('keeps the approval contract held', () => {
    expect(APPROVAL_CONTRACT_AVAILABLE).toBe(false);
  });
});

describe('filterApplications', () => {
  it('filters by status, fellowship and free-text search across name, email, phone and fellowship', () => {
    expect(filterApplications(ROWS, { status: 'ALL' })).toHaveLength(3);
    expect(filterApplications(ROWS, { status: 'SUBMITTED' }).map((r) => r.id)).toEqual(['a']);
    expect(filterApplications(ROWS, { fellowship: 'CMU' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterApplications(ROWS, { search: '  BRUNO ' }).map((r) => r.id)).toEqual(['b']);
    expect(filterApplications(ROWS, { search: '555-0303' }).map((r) => r.id)).toEqual(['c']);
    expect(filterApplications(ROWS, { search: 'example.org', status: 'REJECTED' }).map((r) => r.id)).toEqual(['c']);
    expect(filterApplications(ROWS, { search: 'nobody' })).toEqual([]);
  });

  it('lists each fellowship once, sorted', () => {
    expect(fellowshipOptions(ROWS)).toEqual(['CMU', 'UOFT']);
  });

  it('gives every filter status a label and tone', () => {
    for (const status of STATUS_FILTERS.filter((s) => s !== 'ALL')) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(STATUS_TONES[status]).toBeTruthy();
    }
  });
});

describe('decision eligibility', () => {
  it('allows decisions only while the application is open', () => {
    expect(isDecidable({ status: 'SUBMITTED' })).toBe(true);
    expect(isDecidable({ status: 'INFO_REQUESTED' })).toBe(true);
    expect(isDecidable({ status: 'APPROVED' })).toBe(false);
    expect(isDecidable({ status: 'REJECTED' })).toBe(false);
    expect(isDecidable({ status: 'WITHDRAWN' })).toBe(false);
    expect(isDecidable(null)).toBe(false);
  });
});

describe('reviewApplication', () => {
  it('sends only the two decision actions through the reviewer RPC', async () => {
    const client = makeClient({ rpc: async () => ({ data: { ok: true }, error: null }) });
    await reviewApplication(client, { applicationId: 'a', action: REVIEW_ACTIONS.REJECT, expectedVersion: 3, message: 'Reason' });
    expect(client.rpc).toHaveBeenCalledWith('review_teacher_application', {
      p_application_id: 'a',
      p_action: 'REJECT',
      p_expected_version: 3,
      p_message: 'Reason',
    });
  });

  it('refuses APPROVE and any other action before any request is sent', async () => {
    const client = makeClient();
    await expect(reviewApplication(client, { applicationId: 'a', action: 'APPROVE', expectedVersion: 1, message: 'x' }))
      .rejects.toThrow('INVALID_ACTION');
    await expect(reviewApplication(client, { applicationId: 'a', action: 'ACTIVATE', expectedVersion: 1, message: 'x' }))
      .rejects.toThrow('INVALID_ACTION');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('surfaces the RPC error to the caller', async () => {
    const client = makeClient({ rpc: async () => ({ data: null, error: { message: 'VERSION_CONFLICT: changed' } }) });
    await expect(reviewApplication(client, { applicationId: 'a', action: 'REJECT', expectedVersion: 1, message: 'x' }))
      .rejects.toThrow('VERSION_CONFLICT');
  });
});

describe('reviewErrorMessage and needsReload', () => {
  it('maps known codes to copy and never echoes unknown server text', () => {
    expect(reviewErrorMessage(new Error('VERSION_CONFLICT: changed'))).toMatch(/Someone else changed/);
    expect(reviewErrorMessage(new Error('FORBIDDEN: administrator role required'))).toMatch(/do not have permission/);
    expect(reviewErrorMessage(new Error('FORBIDDEN: reviewers cannot decide their own application'))).toMatch(/submitted yourself/);
    expect(reviewErrorMessage(new Error('MESSAGE_REQUIRED: a message or reason is required'))).toMatch(/Enter a message/);
    expect(reviewErrorMessage(new Error('APPROVAL_NOT_AVAILABLE: approval is served by the teacher-link contract'))).toMatch(/held/);
    const raw = reviewErrorMessage(new Error('permission denied for table teacher_applications at 10.0.0.4'));
    expect(raw).not.toMatch(/10\.0\.0\.4|permission denied|teacher_applications/);
  });

  it('asks for a reload only after errors that make the open record stale', () => {
    expect(needsReload(new Error('VERSION_CONFLICT: x'))).toBe(true);
    expect(needsReload(new Error('APPLICATION_NOT_FOUND'))).toBe(true);
    expect(needsReload(new Error('INVALID_TRANSITION: REJECTED to INFO_REQUESTED'))).toBe(true);
    expect(needsReload(new Error('MESSAGE_REQUIRED'))).toBe(false);
  });
});

describe('roster matching', () => {
  it('escapes LIKE wildcards in the email before the query', async () => {
    const client = makeClient({ tables: { teachers: { data: [], error: null } } });
    await fetchRosterMatches(client, 'a_b%c\\d@x.org');
    const chain = client.from.mock.results[0].value;
    expect(chain.ilike).toHaveBeenCalledWith('email', 'a\\_b\\%c\\\\d@x.org');
    expect(escapeLike('plain@x.org')).toBe('plain@x.org');
  });

  it('reports none, a single live match, or an ambiguous set, ignoring deleted rows', () => {
    expect(summarizeRoster([]).kind).toBe('none');
    expect(summarizeRoster([{ teacher_id: 'T1', deleted_at: '2026-01-01' }]).kind).toBe('none');
    expect(summarizeRoster([{ teacher_id: 'T1' }]).kind).toBe('match');
    expect(summarizeRoster([{ teacher_id: 'T1' }, { teacher_id: 'T2' }]).kind).toBe('ambiguous');
    expect(summarizeRoster([{ teacher_id: 'T1' }, { teacher_id: 'T2', deleted_at: 'x' }]).kind).toBe('match');
  });
});

describe('communication contract', () => {
  it('uses snake_case template keys that only the database-backed events name', () => {
    const keys = TEACHER_APPLICATION_EMAIL_CONTRACT.map((e) => e.templateKey).filter(Boolean);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TEMPLATE_LABELS.teacher_application_received).toBeTruthy();
  });

  it('marks only the three PR #22 templates as existing and the approval and activation templates as proposed', () => {
    const existing = TEACHER_APPLICATION_EMAIL_CONTRACT.filter((e) => e.state === 'exists').map((e) => e.templateKey).sort();
    expect(existing).toEqual(['teacher_application_info_requested', 'teacher_application_received', 'teacher_application_rejected']);
    const proposed = TEACHER_APPLICATION_EMAIL_CONTRACT.filter((e) => e.state === 'proposed').map((e) => e.templateKey);
    expect(proposed).toEqual(['teacher_application_approved_pending', 'teacher_account_activated']);
  });

  it('gives every audit action a readable label and never shows the raw action name', () => {
    expect(auditEventLabel('TEACHER_APPLICATION_INFO_REQUESTED')).toBe('Information requested');
    expect(auditEventLabel('TEACHER_APPLICATION_SOMETHING_NEW')).toBe('Recorded event');
  });
});
