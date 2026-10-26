import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../supabase.js', () => ({ supabase: {} }));

import { ROUTE_ACCESS } from '../routing/routeRoles.js';
import { isRoleAllowed } from '../context/AuthContext.jsx';

const PATH = '/staff/teacher-applications';
const ALL_ROLES = ['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary', 'teacher', 'pending'];

function source(relative) {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

describe('teacher application review access', () => {
  it('admits only admin and superadmin in the access matrix', () => {
    expect([...ROUTE_ACCESS[PATH]].sort()).toEqual(['admin', 'superadmin']);
  });

  it.each(ALL_ROLES)('evaluates %s against the matrix', (role) => {
    const expected = role === 'admin' || role === 'superadmin';
    expect(isRoleAllowed(role, ROUTE_ACCESS[PATH])).toBe(expected);
  });

  it('shows the navigation entry only when the onboarding release hold is on, and only to admin and superadmin', () => {
    const shell = source('src/components/layout/Shell.jsx');
    expect(shell).toMatch(/\.\.\.\(TEACHER_ONBOARDING_CERTIFIED\s*\?\s*\[\{ key: 'teacherapps'[^\]]*roles: SYSTEM_ADMIN_ROLES \}\]\s*:\s*\[\]\)/);
    expect(shell).toMatch(/const SYSTEM_ADMIN_ROLES = \['admin', 'superadmin'\];/);
  });

  it('registers the review route once, behind the same release hold', () => {
    const app = source('src/App.jsx');
    const uses = app.match(/teacherApplicationsRoute/g) ?? [];
    expect(uses).toHaveLength(2);
    expect(app).toMatch(/\{TEACHER_ONBOARDING_CERTIFIED && teacherApplicationsRoute\}/);
    expect(app.match(/path="\/staff\/teacher-applications"/g) ?? []).toHaveLength(0);
  });

  it('registers the forgot-password route once, outside the onboarding gate', () => {
    const app = source('src/App.jsx');
    expect(app).toMatch(/^\s*\{forgotPasswordRoute\}\s*$/m);
    expect(app).not.toMatch(/TEACHER_ONBOARDING_CERTIFIED && forgotPasswordRoute/);
  });
});
