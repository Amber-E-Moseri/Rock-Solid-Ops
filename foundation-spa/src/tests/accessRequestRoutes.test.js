import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTE_ACCESS } from '../routing/routeRoles.js';
import { INBOX_ROLES } from '../features/access-requests-inbox/lib/accessRequestsInbox.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const APP = read('../App.jsx');
const SHELL = read('../components/layout/Shell.jsx');

const REVIEW_ROLES = ['pastor', 'regional_secretary', 'subgroup_admin', 'superadmin'];

describe('access request routes and roles', () => {
  it('the route table and the inbox agree on the four review roles', () => {
    expect([...ROUTE_ACCESS['/staff/access-requests']].sort()).toEqual(REVIEW_ROLES);
    expect([...INBOX_ROLES].sort()).toEqual(REVIEW_ROLES);
  });

  it('excludes admin, principal, teacher and pending from the inbox', () => {
    for (const role of ['admin', 'principal', 'teacher', 'pending']) {
      expect(ROUTE_ACCESS['/staff/access-requests']).not.toContain(role);
    }
  });

  it('the navigation item shows the same roles as the route', () => {
    const match = SHELL.match(/const ACCESS_REVIEW_ROLES = \[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const roles = match[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).sort();
    expect(roles).toEqual(REVIEW_ROLES);
    expect(SHELL).toMatch(/path: '\/staff\/access-requests'/);
  });

  it('the request page is public and sits before the catch-all auth redirect', () => {
    const publicRoute = APP.indexOf('<Route path="/auth/request-access" element={<RequestAccessPage />} />');
    const catchAll = APP.indexOf('<Route path="/auth/*"');
    expect(publicRoute).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    expect(publicRoute).toBeLessThan(catchAll);
  });

  it('the request page is not wrapped in a staff guard', () => {
    const start = APP.indexOf('path="/auth/request-access"');
    const line = APP.slice(start, APP.indexOf('\n', start));
    expect(line).not.toMatch(/ProtectedRoute/);
  });

  it('the inbox route is wrapped in the protected staff guard with the inbox roles', () => {
    const start = APP.indexOf('path="/staff/access-requests"');
    expect(start).toBeGreaterThan(-1);
    const block = APP.slice(start, APP.indexOf('/>', APP.indexOf('</ProtectedRoute>', start)) + 2);
    expect(block).toMatch(/<ProtectedRoute roles=\{INBOX_ROLES\}>/);
    expect(block).toMatch(/<AccessRequestsPage \/>/);
    expect(block).toMatch(/<StaffShell title="Access Requests">/);
  });

  it('both pages are lazy-loaded rather than bundled into the shell', () => {
    expect(APP).toMatch(/const RequestAccessPage\s+= lazy\(\(\) => import\('\.\/features\/access-request\/RequestAccessPage\.jsx'\)\)/);
    expect(APP).toMatch(/const AccessRequestsPage = lazy\(\(\) => import\('\.\/features\/access-requests-inbox\/AccessRequestsPage\.jsx'\)\)/);
  });
});
