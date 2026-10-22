import { describe, it, expect } from 'vitest';
import { ROUTE_ACCESS } from '../routing/routeRoles.js';

// Teacher attendance is a teacher-account page. Admin and staff roles must not be listed for it.
describe('teacher attendance route access', () => {
  const allowed = ROUTE_ACCESS['/teacher/attendance'];

  it('allows teacher accounts', () => {
    expect(allowed).toContain('teacher');
  });

  it('does not allow admin or staff roles', () => {
    for (const role of ['admin', 'superadmin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary']) {
      expect(allowed).not.toContain(role);
    }
  });

  it('keeps the teacher home and availability routes unchanged for teachers', () => {
    expect(ROUTE_ACCESS['/teacher/index']).toContain('teacher');
    expect(ROUTE_ACCESS['/teacher/availability']).toContain('teacher');
  });
});
