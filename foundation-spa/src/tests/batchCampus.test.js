import { describe, it, expect } from 'vitest';
import {
  scopeCodes, eligibleCampusCodes, campusesForBatch, countEligibleCampuses,
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

describe('countEligibleCampuses (Open Registration KPI)', () => {
  it('counts distinct campuses across open batches, not every campus in the map', () => {
    // Open batches reach CMU (CESGA) and UWA (CESGB). UBC and YORK are in the map but unused.
    const openBatches = [{ batch_id: 'A', subgroup_id: 'CESGA' }, { batch_id: 'B', subgroup_id: 'CESGA' }, { batch_id: 'C', subgroup_id: 'CESGB' }];
    expect(countEligibleCampuses(openBatches, FELLOWSHIPS)).toBe(2);
  });

  it('counts duplicate coverage once', () => {
    // Two CESGA batches and a group-scoped CE batch all reach CMU. CE also reaches UWA.
    const openBatches = [
      { batch_id: 'A', subgroup_id: 'CESGA' },
      { batch_id: 'B', subgroup_id: 'CESGA' },
      { batch_id: 'C', fellowship_group: 'CE' },
    ];
    expect(countEligibleCampuses(openBatches, FELLOWSHIPS)).toBe(2);
  });

  it('applies each batch\'s own explicit overrides', () => {
    const openBatches = [{ batch_id: 'A', subgroup_id: 'CESGA' }, { batch_id: 'B', subgroup_id: 'CESGB' }];
    const settings = new Map([['A', [closed('CMU')]]]);
    // A is closed at CMU, so only B's UWA remains.
    expect(countEligibleCampuses(openBatches, FELLOWSHIPS, settings)).toBe(1);
  });

  it('a campus closed for one batch still counts through another open batch', () => {
    const openBatches = [{ batch_id: 'A', subgroup_id: 'CESGA' }, { batch_id: 'B', subgroup_id: 'CESGA' }];
    const settings = new Map([['A', [closed('CMU')]]]);
    expect(countEligibleCampuses(openBatches, FELLOWSHIPS, settings)).toBe(1);
  });

  it('is zero when no batch is open', () => {
    expect(countEligibleCampuses([], FELLOWSHIPS)).toBe(0);
  });
});
