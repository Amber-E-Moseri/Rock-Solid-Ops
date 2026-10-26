import { describe, it, expect } from 'vitest';
import {
  scopeCodes, eligibleCampusCodes, campusesForBatch, summarizeOpenRegistration,
} from '../features/batch-management/lib/batchCampus.js';

const FELLOWSHIPS = [
  { fellowship_code: 'CMU', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' },
  { fellowship_code: 'UWA', campus_name: 'Waterloo', group_id: 'CE', subgroup_id: 'CESGB' },
  { fellowship_code: 'UBC', campus_name: 'UBC', group_id: 'WS', subgroup_id: 'WSGA' },
  { fellowship_code: 'YORK', campus_name: 'York', group_id: 'CS', subgroup_id: 'CSGA' },
];

const closed = (fellowship_code) => ({ fellowship_code, registration_open: false });
const open = (fellowship_code) => ({ fellowship_code, registration_open: true });

describe('organizational scope', () => {
  it('a subgroup-scoped batch covers only that subgroup, not its group', () => {
    // CESGA and CESGB are both in group CE. The CESGA batch must not pick up Waterloo.
    expect(scopeCodes({ subgroup_id: 'CESGA', fellowship_group: 'CE' }, FELLOWSHIPS)).toEqual(['CMU']);
  });

  it('accepts the legacy subgroup column when subgroup_id is absent', () => {
    expect(scopeCodes({ subgroup: 'WSGA' }, FELLOWSHIPS)).toEqual(['UBC']);
  });

  it('a group-scoped batch (no subgroup) covers every campus in that group', () => {
    expect(scopeCodes({ fellowship_group: 'CE' }, FELLOWSHIPS)).toEqual(['CMU', 'UWA']);
  });

  it('a fellowship-code scope covers that one campus', () => {
    expect(scopeCodes({ fellowship_group: 'YORK' }, FELLOWSHIPS)).toEqual(['YORK']);
  });

  it('an unresolved subgroup does not fall back to the group', () => {
    expect(scopeCodes({ subgroup_id: 'NOPE', fellowship_group: 'CE' }, FELLOWSHIPS)).toEqual([]);
  });
});

describe('unmapped batches', () => {
  it('a batch with no subgroup and no fellowship covers no campus', () => {
    expect(eligibleCampusCodes({}, FELLOWSHIPS)).toEqual([]);
    expect(campusesForBatch({}, FELLOWSHIPS)).toEqual([]);
  });

  it('an unmapped batch invents no campus, even with an explicit open row for an unknown code', () => {
    expect(eligibleCampusCodes({ subgroup_id: 'NOPE' }, FELLOWSHIPS, [open('GHOST')])).toEqual([]);
  });
});

describe('explicit batch-campus settings', () => {
  it('an explicit closed row removes a campus from subgroup scope', () => {
    expect(eligibleCampusCodes({ subgroup_id: 'CESGA' }, FELLOWSHIPS, [closed('CMU')])).toEqual([]);
  });

  it('an explicit closed row removes one campus from group scope and keeps the rest', () => {
    expect(eligibleCampusCodes({ fellowship_group: 'CE' }, FELLOWSHIPS, [closed('CMU')])).toEqual(['UWA']);
  });

  it('an explicit open row adds a campus outside the batch scope', () => {
    expect(eligibleCampusCodes({ subgroup_id: 'CESGA' }, FELLOWSHIPS, [open('UBC')])).toEqual(['CMU', 'UBC']);
  });

  it('a closed row for a campus outside scope changes nothing', () => {
    expect(eligibleCampusCodes({ subgroup_id: 'CESGA' }, FELLOWSHIPS, [closed('UBC')])).toEqual(['CMU']);
  });

  it('a campus with no row keeps its organizational eligibility', () => {
    expect(eligibleCampusCodes({ fellowship_group: 'CE' }, FELLOWSHIPS, [])).toEqual(['CMU', 'UWA']);
  });

  it('an explicit row naming a code that is not an active fellowship is ignored', () => {
    expect(eligibleCampusCodes({ subgroup_id: 'CESGA' }, FELLOWSHIPS, [open('GHOST')])).toEqual(['CMU']);
  });

  it('display names come from the eligible codes and never repeat', () => {
    const rows = [...FELLOWSHIPS, { fellowship_code: 'CMU2', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' }];
    expect(campusesForBatch({ subgroup_id: 'CESGA' }, rows)).toEqual(['Manitoba']);
  });
});

describe('summarizeOpenRegistration (Open Registration KPI)', () => {
  const open_ = (batch_id, fields) => ({ batch_id, registration_open: true, ...fields });
  const closedBatch = (batch_id, fields) => ({ batch_id, registration_open: false, ...fields });

  it('counts open batches and distinct accepting campuses, not every campus in the map', () => {
    // Open batches reach CMU (CESGA) and UWA (CESGB). UBC and YORK are in the map but unused.
    const batches = [open_('A', { subgroup_id: 'CESGA' }), open_('B', { subgroup_id: 'CESGA' }), open_('C', { subgroup_id: 'CESGB' })];
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS)).toEqual({ openBatches: 3, campuses: 2 });
  });

  it('counts duplicate coverage once', () => {
    // Two CESGA batches and a group-scoped CE batch all reach CMU. CE also reaches UWA.
    const batches = [open_('A', { subgroup_id: 'CESGA' }), open_('B', { subgroup_id: 'CESGA' }), open_('C', { fellowship_group: 'CE' })];
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS)).toEqual({ openBatches: 3, campuses: 2 });
  });

  it('applies each batch\'s own explicit overrides', () => {
    const batches = [open_('A', { subgroup_id: 'CESGA' }), open_('B', { subgroup_id: 'CESGB' })];
    const settings = new Map([['A', [closed('CMU')]]]);
    // A is closed at CMU and so does not count. B still counts through UWA.
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS, settings)).toEqual({ openBatches: 1, campuses: 1 });
  });

  it('a campus closed for one batch still counts through another open batch', () => {
    const batches = [open_('A', { subgroup_id: 'CESGA' }), open_('B', { subgroup_id: 'CESGA' })];
    const settings = new Map([['A', [closed('CMU')]]]);
    // A has no campus left, so it is not open. B still reaches Manitoba, so the campus counts once.
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS, settings)).toEqual({ openBatches: 1, campuses: 1 });
  });

  it('a batch with every eligible campus closed does not count as open', () => {
    const batches = [open_('A', { subgroup_id: 'CESGA' })];
    const settings = new Map([['A', [closed('CMU')]]]);
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS, settings)).toEqual({ openBatches: 0, campuses: 0 });
  });

  it('a batch with every campus of its group closed does not count as open', () => {
    const batches = [open_('A', { fellowship_group: 'CE' })];
    const settings = new Map([['A', [closed('CMU'), closed('UWA')]]]);
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS, settings)).toEqual({ openBatches: 0, campuses: 0 });
  });

  it('one campus reopened after closure counts the batch once, with that campus only', () => {
    // Group CE has Manitoba and Waterloo. Both are closed, then Waterloo is reopened.
    const batches = [open_('A', { fellowship_group: 'CE' })];
    const reopened = new Map([['A', [closed('CMU'), open('UWA')]]]);
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS, reopened)).toEqual({ openBatches: 1, campuses: 1 });
  });

  it('zero eligible campuses: an unmapped batch with registration on does not count', () => {
    const batches = [open_('A', { subgroup_id: 'NOPE' }), open_('B', {})];
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS)).toEqual({ openBatches: 0, campuses: 0 });
  });

  it('a batch with registration closed is excluded even when its campuses accept', () => {
    const batches = [closedBatch('A', { subgroup_id: 'CESGA' })];
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS)).toEqual({ openBatches: 0, campuses: 0 });
  });

  it('an explicit open override adds an eligible campus outside scope and counts it', () => {
    const batches = [open_('A', { subgroup_id: 'CESGA' })];
    const settings = new Map([['A', [open('UBC')]]]);
    expect(summarizeOpenRegistration(batches, FELLOWSHIPS, settings)).toEqual({ openBatches: 1, campuses: 2 });
  });

  it('campus identity is the fellowship code; a shared campus name does not merge two codes', () => {
    const rows = [
      { fellowship_code: 'CMU', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' },
      { fellowship_code: 'CMU2', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' },
    ];
    expect(summarizeOpenRegistration([open_('A', { subgroup_id: 'CESGA' })], rows)).toEqual({ openBatches: 1, campuses: 2 });
  });

  it('is zero when no batch is open', () => {
    expect(summarizeOpenRegistration([], FELLOWSHIPS)).toEqual({ openBatches: 0, campuses: 0 });
  });
});
