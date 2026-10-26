import { describe, it, expect } from 'vitest';
import { campusesForBatch, countCampuses } from '../features/batch-management/lib/batchCampus.js';

const FELLOWSHIPS = [
  { fellowship_code: 'CMU', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' },
  { fellowship_code: 'UWA', campus_name: 'Waterloo', group_id: 'CE', subgroup_id: 'CESGB' },
  { fellowship_code: 'UBC', campus_name: 'UBC', group_id: 'WS', subgroup_id: 'WSGA' },
  { fellowship_code: 'YORK', campus_name: 'York', group_id: 'CS', subgroup_id: 'CSGA' },
];

describe('campusesForBatch', () => {
  it('resolves a batch with a subgroup to that subgroup\'s campuses', () => {
    expect(campusesForBatch({ subgroup_id: 'CESGA', fellowship_group: 'CE' }, FELLOWSHIPS)).toEqual(['Manitoba']);
  });

  it('accepts the legacy subgroup column when subgroup_id is absent', () => {
    expect(campusesForBatch({ subgroup: 'WSGA' }, FELLOWSHIPS)).toEqual(['UBC']);
  });

  it('falls back to the group code when there is no subgroup', () => {
    expect(campusesForBatch({ fellowship_group: 'CE' }, FELLOWSHIPS)).toEqual(['Manitoba', 'Waterloo']);
  });

  it('falls back to a fellowship code when the value is not a group', () => {
    expect(campusesForBatch({ fellowship_group: 'YORK' }, FELLOWSHIPS)).toEqual(['York']);
  });

  it('returns no campuses when nothing matches or the batch has no fellowship', () => {
    expect(campusesForBatch({ subgroup_id: 'NOPE' }, FELLOWSHIPS)).toEqual([]);
    expect(campusesForBatch({}, FELLOWSHIPS)).toEqual([]);
  });

  it('lists each campus once', () => {
    const rows = [...FELLOWSHIPS, { fellowship_code: 'CMU2', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' }];
    expect(campusesForBatch({ subgroup_id: 'CESGA' }, rows)).toEqual(['Manitoba']);
  });
});

describe('countCampuses (Open Registration KPI)', () => {
  it('counts distinct campuses reached by the given batches only', () => {
    // Two open batches in CESGA and CESGB reach two campuses. UBC and York are in the map but unused here.
    const open = [{ subgroup_id: 'CESGA' }, { subgroup_id: 'CESGA' }, { subgroup_id: 'CESGB' }];
    expect(countCampuses(open, FELLOWSHIPS)).toBe(2);
  });

  it('does not count every campus in fellowship_map', () => {
    expect(countCampuses([{ subgroup_id: 'CESGA' }], FELLOWSHIPS)).toBe(1);
    expect(FELLOWSHIPS.length).toBe(4);
  });

  it('counts a group-level batch once per distinct campus across batches', () => {
    expect(countCampuses([{ fellowship_group: 'CE' }, { subgroup_id: 'CESGA' }], FELLOWSHIPS)).toBe(2);
  });

  it('is zero when no batch is open', () => {
    expect(countCampuses([], FELLOWSHIPS)).toBe(0);
  });
});
