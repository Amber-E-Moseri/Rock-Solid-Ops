import { describe, it, expect } from 'vitest';
import { filterMappings } from '../features/nexus-management/lib/nexusManagement.js';

describe('nexus-management lib', () => {
  const rows = [
    { id: '1', admin_email: 'alice@school.org', nexus_user_name: 'Alice', group_id: 'G1' },
    { id: '2', admin_email: 'bob@school.org', nexus_user_name: 'Bob', group_id: 'G2' },
  ];

  it('filterMappings returns all when no search', () => {
    expect(filterMappings(rows, '')).toHaveLength(2);
  });

  it('filterMappings filters by search term', () => {
    expect(filterMappings(rows, 'alice')).toHaveLength(1);
    expect(filterMappings(rows, 'G2')).toHaveLength(1);
  });

  it('filterMappings is case-insensitive', () => {
    expect(filterMappings(rows, 'BOB')).toHaveLength(1);
  });
});
