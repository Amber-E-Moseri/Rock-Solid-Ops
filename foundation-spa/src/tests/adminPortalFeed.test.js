import { describe, it, expect, beforeEach, vi } from 'vitest';

// Records every query the activity feed makes and resolves each one to the result
// registered for its table. Unregistered tables resolve empty, so no error is
// assumed unless a test sets one.
const state = vi.hoisted(() => ({ calls: [], results: {} }));

vi.mock('../supabase.js', () => {
  function builder(table) {
    const call = { table, select: null, head: false, eqs: [], order: null, limit: null };
    state.calls.push(call);
    const q = {
      select(cols, opts) { call.select = cols; call.head = Boolean(opts?.head); return q; },
      order(col) { call.order = col; return q; },
      limit(n) { call.limit = n; return q; },
      eq(col, val) { call.eqs.push([col, val]); return q; },
      then(resolve, reject) {
        const result = state.results[table] ?? { data: [], error: null, count: 0 };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return q;
  }
  return { supabase: { from: (table) => builder(table) } };
});

import { fetchActivityFeed } from '../features/admin-portal/lib/adminPortal.js';

const callsFor = (table) => state.calls.filter((c) => c.table === table);

beforeEach(() => {
  state.calls = [];
  state.results = {};
});

describe('admin portal activity feed', () => {
  it('reads audit_logs by actor_email, the column that exists, and maps it to the card field', async () => {
    state.results.audit_logs = {
      data: [{ actor_email: 'admin@rso.test', action: 'LOGIN', entity_type: 'user', created_at: '2026-10-22T00:00:00Z' }],
      error: null,
    };
    const feed = await fetchActivityFeed();
    const [logs] = callsFor('audit_logs');
    expect(logs.select).toBe('actor_email, action, entity_type, created_at');
    expect(logs.select).not.toContain('actor_name');
    expect(feed.recentLogs[0].actor_name).toBe('admin@rso.test');
  });

  it('counts FAILED Moodle syncs from moodle_enrollment_sync, not the legacy moodle_sync table', async () => {
    state.results.moodle_enrollment_sync = { data: null, error: null, count: 2 };
    const feed = await fetchActivityFeed();
    const [moodle] = callsFor('moodle_enrollment_sync');
    expect(moodle.head).toBe(true);
    expect(moodle.eqs).toEqual([['sync_status', 'FAILED']]);
    expect(callsFor('moodle_sync')).toHaveLength(0);
    expect(feed.failedMoodle).toBe(2);
  });

  it('counts pending emails from email_queue status Pending', async () => {
    state.results.email_queue = { data: null, error: null, count: 4 };
    const feed = await fetchActivityFeed();
    const [email] = callsFor('email_queue');
    expect(email.eqs).toEqual([['status', 'Pending']]);
    expect(feed.pendingEmails).toBe(4);
  });

  it('legitimate empty data is an empty state, not an error', async () => {
    const feed = await fetchActivityFeed();
    expect(feed.recentLogs).toEqual([]);
    expect(feed.failedMoodle).toBe(0);
    expect(feed.pendingEmails).toBe(0);
  });

  it('a genuine query error is still reported so the card can show it', async () => {
    state.results.audit_logs = { data: null, error: { message: 'permission denied' }, count: null };
    await expect(fetchActivityFeed()).rejects.toEqual({ message: 'permission denied' });
  });
});
