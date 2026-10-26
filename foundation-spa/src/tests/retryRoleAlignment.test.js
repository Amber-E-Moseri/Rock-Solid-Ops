import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROUTE_ACCESS, SYSTEM_ADMIN_ROLES, canManualRetry } from '../routing/routeRoles.js';
import { MOODLE_RETRY_HOLD_MESSAGE } from '../releaseHolds.js';
import { supabase } from '../supabase.js';
import { retryFailedNotification } from '../features/applicant-directory/lib/mutations.js';
// The backend gate itself. Cross-layer check: the SPA must offer retry exactly where the server allows it.
import { RETRY_ADMIN_ROLES } from '../../../supabase/functions/_shared/retry-admin-lookup.ts';

vi.mock('../supabase.js', () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));

// vitest runs from foundation-spa (npm run test), so paths resolve from the package root.
const appSource = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const applicantDirectoryDir = resolve(process.cwd(), 'src/features/applicant-directory');

// The source of one route element: from its path attribute up to the next <Route. App.jsx uses self-closing
// <Route ... /> elements, so the next route marks the end of this one.
function routeBlock(path) {
  const start = appSource.indexOf(`path="${path}"`);
  if (start < 0) return '';
  const next = appSource.indexOf('<Route', start + 1);
  return appSource.slice(start, next < 0 ? undefined : next);
}

beforeEach(() => {
  supabase.functions.invoke.mockReset();
  supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('retry role alignment (backend, route, and frontend)', () => {
  it('the backend retry role set is exactly admin and superadmin', () => {
    expect([...RETRY_ADMIN_ROLES]).toEqual(['admin', 'superadmin']);
  });

  it('the SPA system-admin set matches the backend retry set', () => {
    expect([...SYSTEM_ADMIN_ROLES].sort()).toEqual([...RETRY_ADMIN_ROLES].sort());
  });

  it('the Failed Sync Retry Center route access matches the backend', () => {
    expect([...ROUTE_ACCESS['/staff/failed-sync-retry-center']].sort()).toEqual([...RETRY_ADMIN_ROLES].sort());
  });

  it('App.jsx guards the Failed Sync Retry Center route with SYSTEM_ADMIN_ROLES', () => {
    // Bounded to this route's own block, so a later route's roles cannot satisfy or defeat the check.
    const block = routeBlock('/staff/failed-sync-retry-center');
    expect(block).toMatch(/roles=\{SYSTEM_ADMIN_ROLES\}/);
    expect(block).not.toMatch(/roles=\{ADMIN_ROLES\}/);
  });

  it('canManualRetry allows admin and superadmin only, ignoring case and whitespace', () => {
    expect(canManualRetry('admin')).toBe(true);
    expect(canManualRetry(' SuperAdmin ')).toBe(true);
    for (const role of ['subgroup_admin', 'pastor', 'principal', 'regional_secretary', 'teacher', 'pending', '', null, undefined]) {
      expect(canManualRetry(role), `role ${JSON.stringify(role)}`).toBe(false);
    }
  });
});

describe('Applicant Directory exposes no unauthorized retry control', () => {
  it('no applicant-directory module calls retry-worker or the retry helper outside lib', () => {
    const files = readdirSync(applicantDirectoryDir, { recursive: true }).filter((f) => /\.(jsx?|tsx?)$/.test(f));
    const offenders = files.filter((f) => {
      const text = readFileSync(resolve(applicantDirectoryDir, f), 'utf8');
      return text.includes('retry-worker') || text.includes('retryFailedNotification');
    });
    // Only the helper's own module may name them. No component may wire a retry control.
    // readdirSync returns OS-native separators, so normalise to '/' before matching (Windows uses '\').
    expect(offenders.filter((f) => !f.replace(/\\/g, '/').endsWith('lib/mutations.js'))).toEqual([]);
  });

  it('retryFailedNotification refuses non-admin roles before any request', async () => {
    for (const actorRole of ['principal', 'regional_secretary', 'subgroup_admin', 'pastor', 'teacher']) {
      await expect(retryFailedNotification({ target: { id: 7 }, source: 'email_queue', actorRole }))
        .rejects.toThrow('Manual retry is limited to administrators.');
    }
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('retryFailedNotification sends a request for admin and superadmin', async () => {
    for (const actorRole of ['admin', 'superadmin']) {
      await retryFailedNotification({ target: { id: 7 }, source: 'email_queue', actorRole });
    }
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-worker', {
      body: { action: 'retry', source: 'email_queue', id: '7' },
    });
  });

  it('the Moodle hold still refuses first, even for an admin', async () => {
    await expect(retryFailedNotification({ target: { id: 4 }, source: 'moodle_enrollment_sync', actorRole: 'admin' }))
      .rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('read-only access to the Applicant Directory is preserved for principal and regional_secretary', () => {
    const roles = routeBlock('/staff/applicant-directory').match(/roles=\{\[([^\]]*)\]\}/);
    expect(roles, 'applicant directory roles found').not.toBeNull();
    expect(roles[1]).toContain("'principal'");
    expect(roles[1]).toContain("'regional_secretary'");
  });
});
