import { describe, it, expect } from 'vitest';
import { safeNextPath, postLoginPath } from '../features/auth/postLoginPath.js';
import { landingPathForRole, TEACHER_LANDING, STAFF_LANDING, ROUTE_ACCESS } from '../routing/routeRoles.js';

describe('safeNextPath', () => {
  it('accepts same-origin application paths', () => {
    for (const ok of [
      '/staff/dashboards',
      '/staff/student-progress?id=12&tab=notes#top',
      '/teacher/index?section=my-class',
      '/staff/student-progress?next=%2Fstaff%2Fdashboards',
    ]) {
      expect(safeNextPath(ok), ok).toBe(ok);
    }
  });

  it('rejects absolute and protocol-relative targets', () => {
    for (const bad of ['//evil.example', 'https://evil.example/', 'http:/evil.example', 'javascript:alert(1)', 'evil.example']) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it('rejects backslash ambiguities', () => {
    for (const bad of ['/\\evil.example', '/\\\\evil.example', '/%5Cevil.example', '/%5cevil.example']) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it('rejects raw whitespace and control characters', () => {
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\u0000x', '/\u007fx', ' /staff', '/staff x']) {
      expect(safeNextPath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects percent-encoded bypasses', () => {
    for (const bad of ['/%2F%2Fevil.example', '%2F%2Fevil.example', '/%09/evil.example', '/%0a/evil.example', '/%20/evil.example', '/%2F%5Cevil.example']) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it('rejects malformed, empty and non-string input', () => {
    for (const bad of ['', '/%E0%A4%A', null, undefined, 42]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
  });
});

describe('postLoginPath', () => {
  it('sends teachers with no usable next to /teacher/index', () => {
    expect(postLoginPath({ role: 'teacher', next: null })).toBe(TEACHER_LANDING);
    expect(postLoginPath({ role: 'Teacher ', next: '//evil.example' })).toBe(TEACHER_LANDING);
    expect(TEACHER_LANDING).toBe('/teacher/index');
  });

  it('follows a valid next for a teacher; the route guard refuses staff routes', () => {
    expect(postLoginPath({ role: 'teacher', next: '/staff/dashboards' })).toBe('/staff/dashboards');
  });

  it('follows a validated next for staff roles', () => {
    expect(postLoginPath({ role: 'admin', next: '/staff/waitlist' })).toBe('/staff/waitlist');
  });

  it('ignores an unsafe next and uses the role landing', () => {
    expect(postLoginPath({ role: 'admin', next: '//evil.example' })).toBe(STAFF_LANDING);
    expect(postLoginPath({ role: 'admin', next: '/\t/evil.example' })).toBe(STAFF_LANDING);
  });

  it('falls back to the staff dashboard for roles with no landing', () => {
    expect(postLoginPath({ role: 'pending', next: null })).toBe(STAFF_LANDING);
    expect(postLoginPath({ role: null, next: null })).toBe(STAFF_LANDING);
  });
});

describe('next targets with an incompatible base or auth path', () => {
  it('rejects /app, /foundation and /auth prefixes, in any letter case or encoding', () => {
    for (const bad of [
      '/app/staff/dashboards',
      '/app',
      '/APP/staff/dashboards',
      '/%61pp/staff/dashboards',
      '/foundation/staff/dashboards.html',
      '/auth/login?next=%2Fstaff%2Fdashboards',
      '/auth/teacher/register',
      '/auth',
      '/app?x=1',
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
      expect(postLoginPath({ role: 'admin', next: bad }), bad).toBe(STAFF_LANDING);
      expect(postLoginPath({ role: 'teacher', next: bad }), bad).toBe(TEACHER_LANDING);
    }
  });

  it('still accepts paths that only start with the same letters', () => {
    expect(safeNextPath('/authentic-report')).toBe('/authentic-report');
    expect(safeNextPath('/application/list')).toBe('/application/list');
    expect(safeNextPath('/apps')).toBe('/apps');
  });

  it('rejects malformed encodings and control characters', () => {
    for (const bad of ['/%E0%A4%A', '/staff/%0Ad', '/staff/ dashboards']) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });
});

describe('shared access matrix', () => {
  it('gives teachers the teacher portal and no staff dashboard', () => {
    expect(landingPathForRole('teacher')).toBe('/teacher/index');
    expect(ROUTE_ACCESS['/staff/dashboards']).not.toContain('teacher');
    expect(ROUTE_ACCESS['/teacher/index']).toContain('teacher');
  });
});
