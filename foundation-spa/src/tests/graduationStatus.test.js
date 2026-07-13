import { describe, it, expect } from 'vitest';
import {
  isEffectivelyEligible, eligibilityLabel, eligibilityVariant, computeSummary, filterRows, fmtDate,
} from '../features/graduation-status/lib/graduationStatus.js';

const makeRow = (ge) => ({ id: '1', full_name: 'Jane', email: 'jane@test.com', ge });

describe('graduation-status lib', () => {
  it('isEffectivelyEligible respects override', () => {
    expect(isEffectivelyEligible(null)).toBe(false);
    expect(isEffectivelyEligible({ eligible: true })).toBe(true);
    expect(isEffectivelyEligible({ eligible: true, override_eligible: false })).toBe(false);
    expect(isEffectivelyEligible({ eligible: false, override_eligible: true })).toBe(true);
  });

  it('eligibilityLabel describes status', () => {
    expect(eligibilityLabel(null)).toBe('Not Evaluated');
    expect(eligibilityLabel({ eligible: true })).toBe('Eligible');
    expect(eligibilityLabel({ eligible: false })).toBe('Not Eligible');
    expect(eligibilityLabel({ override_eligible: true })).toBe('Eligible (Override)');
  });

  it('eligibilityVariant maps to badge variant', () => {
    expect(eligibilityVariant(null)).toBe('info');
    expect(eligibilityVariant({ eligible: true })).toBe('success');
    expect(eligibilityVariant({ eligible: false })).toBe('danger');
    expect(eligibilityVariant({ override_eligible: true })).toBe('primary');
  });

  it('computeSummary counts categories', () => {
    const rows = [
      makeRow({ eligible: true }),
      makeRow({ eligible: false, override_eligible: true }),
      makeRow(null),
    ];
    const s = computeSummary(rows);
    expect(s.total).toBe(3);
    expect(s.evaluated).toBe(2);
    expect(s.eligible).toBe(2);
    expect(s.overridden).toBe(1);
  });

  it('filterRows filters by search and eligibility', () => {
    const rows = [
      { ...makeRow({ eligible: true }), full_name: 'Jane' },
      { ...makeRow({ eligible: false }), id: '2', full_name: 'Bob', email: 'bob@test.com' },
    ];
    expect(filterRows(rows, { search: 'jane' })).toHaveLength(1);
    expect(filterRows(rows, { eligibility: 'eligible' })).toHaveLength(1);
    expect(filterRows(rows, { eligibility: 'not_eligible' })).toHaveLength(1);
  });

  it('fmtDate formats or returns dash', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('2026-06-01')).toContain('2026');
  });
});
