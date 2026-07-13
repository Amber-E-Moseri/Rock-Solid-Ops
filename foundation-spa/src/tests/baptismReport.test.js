import { describe, it, expect } from 'vitest';
import { asFaith, faithVariant, faithLabel, filterApplicants, computeKpis, getFilterOptions } from '../features/baptism-report/lib/baptismReport.js';

const makeApp = (overrides) => ({
  id: '1', full_name: 'Jane', email: 'jane@test.com', fellowship_code: 'FCH',
  class_option_id: 'C1', born_again: 'Yes', speaks_in_tongues: 'No', water_baptized: null,
  registration_status: 'ASSIGNED', ...overrides,
});

describe('baptism-report lib', () => {
  it('asFaith defaults to not sure', () => {
    expect(asFaith(null)).toBe("I'm not sure");
    expect(asFaith('Yes')).toBe('Yes');
  });

  it('faithVariant maps values', () => {
    expect(faithVariant('Yes')).toBe('success');
    expect(faithVariant('No')).toBe('danger');
    expect(faithVariant(null)).toBe('warning');
  });

  it('faithLabel converts not sure', () => {
    expect(faithLabel(null)).toBe('Not Sure');
    expect(faithLabel('Yes')).toBe('Yes');
  });

  it('filterApplicants filters by fellowship', () => {
    const apps = [makeApp({ fellowship_code: 'FCH' }), makeApp({ id: '2', fellowship_code: 'FCE' })];
    expect(filterApplicants(apps, { fellowship: 'FCE' }, new Map())).toHaveLength(1);
  });

  it('filterApplicants filters by born again', () => {
    const apps = [makeApp({ born_again: 'Yes' }), makeApp({ id: '2', born_again: 'No' })];
    expect(filterApplicants(apps, { born: 'No' }, new Map())).toHaveLength(1);
  });

  it('computeKpis counts categories', () => {
    const apps = [
      makeApp({ water_baptized: 'No', born_again: 'No', speaks_in_tongues: 'Yes' }),
      makeApp({ id: '2', water_baptized: 'Yes', born_again: 'Yes', speaks_in_tongues: 'No' }),
    ];
    const kpis = computeKpis(apps);
    expect(kpis.total).toBe(2);
    expect(kpis.needBaptism).toBe(1);
    expect(kpis.notBorn).toBe(1);
    expect(kpis.tongues).toBe(1);
  });

  it('getFilterOptions extracts fellowships', () => {
    const apps = [makeApp({ fellowship_code: 'FCH' }), makeApp({ id: '2', fellowship_code: 'FCE' })];
    const map = new Map([['FCH', 'Central'], ['FCE', 'East']]);
    const opts = getFilterOptions(apps, map);
    expect(opts).toHaveLength(2);
    expect(opts[0].label).toBe('East');
  });
});
