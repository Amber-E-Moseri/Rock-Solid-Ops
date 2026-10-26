// Static check of App.jsx: every route path is declared once, the onboarding paths do not collide with
// existing authentication routes, and the /auth/* catch-all still follows them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

describe('route conflicts in App.jsx', () => {
  it('declares no path twice', () => {
    const seen = new Set();
    const duplicates = paths.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
    expect(duplicates).toEqual([]);
  });

  it('keeps the login and reset routes as they were', () => {
    expect(paths).toContain('/auth/login');
    expect(paths).toContain('/auth/reset-password');
    expect(paths.filter((p) => p === '/auth/reset-password')).toHaveLength(1);
  });

  it('places the onboarding routes before the /auth/* catch-all', () => {
    const catchAll = app.indexOf('path="/auth/*"');
    const onboarding = app.indexOf('{TEACHER_ONBOARDING_CERTIFIED && teacherOnboardingRoutes}');
    expect(catchAll).toBeGreaterThan(-1);
    expect(onboarding).toBeGreaterThan(-1);
    expect(onboarding).toBeLessThan(catchAll);
  });

  it('does not add any onboarding path to a teacher or staff tree', () => {
    const routes = readFileSync(resolve(process.cwd(), 'src/features/teacher-onboarding/routes.jsx'), 'utf8');
    const declared = [...routes.matchAll(/(?:register|checkEmail|confirm|application|forgotPassword|resetPassword):\s*'([^']+)'/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThanOrEqual(6);
    // The reset path is the existing route, which App.jsx keeps once with the hardened element.
    const existing = new Set(['/auth/reset-password']);
    for (const path of declared) {
      expect(path.startsWith('/auth/')).toBe(true);
      if (!existing.has(path)) expect(paths.filter((p) => p === path)).toHaveLength(0);
    }
  });
});
