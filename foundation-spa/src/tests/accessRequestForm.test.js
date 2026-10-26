import { describe, it, expect, vi } from 'vitest';

// Organization options as the access_request_org_options RPC returns them. Codes are the stored codes.
vi.mock('../supabase.js', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), auth: {} } }));

import {
  REQUEST_ROLES, ROLE_LABELS, NOTE_MAX,
  normalizeOrgOptions, groupOptions, subgroupOptions, fellowshipOptions,
  validateRequestDraft, buildSubmission, statusInfo, friendlyMessage, OPEN_STATUSES,
} from '../features/access-request/lib/accessRequest.js';

const RAW = [
  { group_id: 'CE', subgroups: [
    { subgroup_id: 'CESGA', fellowships: [{ code: 'CMU', campus: 'Central Main' }] },
    { subgroup_id: 'CESGB', fellowships: [{ code: 'YORK', campus: 'York Campus' }] },
  ] },
  { group_id: 'CS', subgroups: [
    { subgroup_id: 'CSGA', fellowships: [{ code: 'STOR', campus: 'Storefront' }] },
  ] },
];
const TREE = normalizeOrgOptions(RAW);

const VALID = {
  requestedRole: 'pastor',
  fullName: 'Pat Example',
  email: 'pat@example.test',
  phone: '+1 555 010 0199',
  groupId: 'CE',
  subgroupId: 'CESGA',
  fellowshipCode: 'CMU',
  note: 'Happy to help',
};

describe('requested roles', () => {
  it('offers exactly the four requested roles, in order', () => {
    expect(REQUEST_ROLES.map((r) => r.value)).toEqual(['teacher', 'pastor', 'subgroup_admin', 'other']);
    expect(REQUEST_ROLES.map((r) => r.label)).toEqual(['Teacher', 'Pastor', 'Subgroup Admin', 'Other']);
  });

  it('has no group admin option anywhere', () => {
    // Exact match: "subgroup_admin" is a valid role and must not trip this check.
    expect(REQUEST_ROLES.some((r) => r.value === 'group_admin' || r.label === 'Group Admin')).toBe(false);
    expect(ROLE_LABELS.group_admin).toBeUndefined();
  });

  it('rejects group_admin as a requested role', () => {
    const errors = validateRequestDraft({ ...VALID, requestedRole: 'group_admin' }, TREE);
    expect(errors.requestedRole).toBeTruthy();
  });
});

describe('dependent group, subgroup and fellowship options', () => {
  it('keeps the stored codes exactly', () => {
    expect(groupOptions(TREE)).toEqual(['CE', 'CS']);
    expect(subgroupOptions(TREE, 'CE')).toEqual(['CESGA', 'CESGB']);
  });

  it('lists only the subgroups of the chosen group', () => {
    expect(subgroupOptions(TREE, 'CE')).not.toContain('CSGA');
    expect(subgroupOptions(TREE, 'CS')).toEqual(['CSGA']);
  });

  it('returns no subgroups for an unknown group', () => {
    expect(subgroupOptions(TREE, 'WS')).toEqual([]);
    expect(subgroupOptions(TREE, '')).toEqual([]);
  });

  it('lists only the fellowships of the chosen pair', () => {
    expect(fellowshipOptions(TREE, 'CE', 'CESGA').map((f) => f.code)).toEqual(['CMU']);
    expect(fellowshipOptions(TREE, 'CE', 'CESGB').map((f) => f.code)).toEqual(['YORK']);
    expect(fellowshipOptions(TREE, 'CS', 'CESGA')).toEqual([]);
  });

  it('coerces missing campus names to the code, so an option is never blank', () => {
    const tree = normalizeOrgOptions([{ group_id: 'CE', subgroups: [{ subgroup_id: 'CESGA', fellowships: [{ code: 'CMU' }] }] }]);
    expect(fellowshipOptions(tree, 'CE', 'CESGA')[0].campus).toBe('CMU');
  });

  it('treats a non-array option payload as empty', () => {
    expect(normalizeOrgOptions(null)).toEqual([]);
    expect(normalizeOrgOptions({})).toEqual([]);
  });
});

describe('validateRequestDraft', () => {
  it('accepts a complete, consistent draft', () => {
    expect(validateRequestDraft(VALID, TREE)).toEqual({});
  });

  it('accepts a draft with no phone and no note', () => {
    expect(validateRequestDraft({ ...VALID, phone: '', note: '' }, TREE)).toEqual({});
  });

  it('requires a role, a name, a valid email, a group, a subgroup and a fellowship', () => {
    const errors = validateRequestDraft({ requestedRole: '', fullName: '', email: 'nope', groupId: '', subgroupId: '', fellowshipCode: '' }, TREE);
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['requestedRole', 'fullName', 'email', 'groupId']));
  });

  it('enforces the name length bounds', () => {
    expect(validateRequestDraft({ ...VALID, fullName: 'A' }, TREE).fullName).toBeTruthy();
    expect(validateRequestDraft({ ...VALID, fullName: 'x'.repeat(121) }, TREE).fullName).toBeTruthy();
    expect(validateRequestDraft({ ...VALID, fullName: 'Al' }, TREE).fullName).toBeUndefined();
  });

  it('rejects a phone number that is too short or has letters', () => {
    expect(validateRequestDraft({ ...VALID, phone: '12345' }, TREE).phone).toBeTruthy();
    expect(validateRequestDraft({ ...VALID, phone: 'call me' }, TREE).phone).toBeTruthy();
    expect(validateRequestDraft({ ...VALID, phone: '(555) 010-0199' }, TREE).phone).toBeUndefined();
  });

  it('refuses a subgroup that belongs to a different group', () => {
    const errors = validateRequestDraft({ ...VALID, groupId: 'CS', subgroupId: 'CESGA', fellowshipCode: 'CMU' }, TREE);
    expect(errors.subgroupId).toBeTruthy();
  });

  it('refuses a subgroup that is not in the chosen group at all', () => {
    expect(validateRequestDraft({ ...VALID, subgroupId: 'NOPE' }, TREE).subgroupId).toBeTruthy();
  });

  it('refuses a fellowship that belongs to another subgroup of the same group', () => {
    const errors = validateRequestDraft({ ...VALID, subgroupId: 'CESGA', fellowshipCode: 'YORK' }, TREE);
    expect(errors.fellowshipCode).toBeTruthy();
  });

  it('refuses a fellowship from a different group', () => {
    expect(validateRequestDraft({ ...VALID, groupId: 'CS', subgroupId: 'CSGA', fellowshipCode: 'CMU' }, TREE).fellowshipCode).toBeTruthy();
  });

  it('does not report a subgroup or fellowship error until a group exists', () => {
    const errors = validateRequestDraft({ ...VALID, groupId: '', subgroupId: '', fellowshipCode: '' }, TREE);
    expect(errors.subgroupId).toBeUndefined();
    expect(errors.fellowshipCode).toBeUndefined();
  });

  it('caps the note length', () => {
    expect(validateRequestDraft({ ...VALID, note: 'x'.repeat(NOTE_MAX + 1) }, TREE).note).toBeTruthy();
    expect(validateRequestDraft({ ...VALID, note: 'x'.repeat(NOTE_MAX) }, TREE).note).toBeUndefined();
  });
});

describe('buildSubmission', () => {
  it('trims text, nulls empty optional fields, and never includes an email', () => {
    const payload = buildSubmission({ ...VALID, fullName: '  Pat Example  ', phone: '   ', note: '  ' });
    expect(payload).toEqual({
      requestedRole: 'pastor',
      fullName: 'Pat Example',
      phone: null,
      fellowshipCode: 'CMU',
      groupId: 'CE',
      subgroupId: 'CESGA',
      note: null,
    });
    expect(Object.keys(payload)).not.toContain('email');
  });
});

describe('status and error presentation', () => {
  it('describes every request status', () => {
    expect(statusInfo('SUBMITTED').label).toBe('Awaiting review');
    expect(statusInfo('INFO_REQUESTED').label).toBe('More information needed');
    expect(statusInfo('APPROVAL_PENDING_PROVISIONING').label).toBe('Approved, awaiting setup');
    expect(statusInfo('REJECTED').label).toBe('Not approved');
    expect(statusInfo('WITHDRAWN').label).toBe('Withdrawn');
    expect(statusInfo('mystery').label).toBe('mystery');
  });

  it('says approval is not activation', () => {
    expect(statusInfo('APPROVAL_PENDING_PROVISIONING').detail).toMatch(/not active until setup is complete/);
  });

  it('treats the three non-terminal states as open', () => {
    expect(OPEN_STATUSES).toEqual(['SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING']);
  });

  it('maps server codes to sentences a person can act on', () => {
    expect(friendlyMessage(new Error('EMAIL_NOT_VERIFIED: confirm your email'))).toMatch(/Confirm your email/);
    expect(friendlyMessage(new Error('INVALID_SCOPE: the fellowship does not belong'))).toMatch(/do not match/);
    expect(friendlyMessage(new Error('ALREADY_STAFF: staff role'))).toMatch(/staff role/);
  });

  it('falls back for an unknown or non-coded error', () => {
    expect(friendlyMessage(new Error('something odd'), 'Fallback text')).toBe('Fallback text');
    expect(friendlyMessage(new Error('Weird: not a known code'))).toMatch(/Something went wrong/);
  });
});
