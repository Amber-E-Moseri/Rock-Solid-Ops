import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulates PostgREST column validation against a fixed column set, as the staging database behaves:
// selecting an unknown column returns 400 / 42703 whatever the caller's role.
const { schema } = vi.hoisted(() => ({ schema: { tables: {} } }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => ({
      select: (proj) => ({
        limit: async () => {
          const known = schema.tables[table];
          if (!known) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
          const cols = proj.split(',').map((c) => c.trim());
          const unknown = cols.find((c) => !known.columns.includes(c));
          if (unknown) return { data: null, error: { code: '42703', message: `column ${table}.${unknown} does not exist` } };
          return { data: known.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null };
        },
      }),
    }),
  },
}));

import { fetchStaff, fetchTeachers } from '../features/admin-management/lib/adminManagement.js';

// Authoritative profiles columns (supabase/migrations/202605060900_auth_rbac.sql): keyed by user_id, no id.
const PROFILE_ROW = {
  user_id: 'u-1', full_name: 'Ann Admin', email: 'ann@example.com', role: 'admin',
  is_active: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  schema.tables = {
    profiles: {
      columns: ['user_id', 'full_name', 'email', 'role', 'is_active', 'created_at', 'updated_at'],
      rows: [PROFILE_ROW],
    },
    teachers: {
      columns: ['teacher_id', 'full_name', 'email', 'phone', 'group_id', 'subgroup_id', 'status', 'active', 'deleted_at', 'teacher_user_id', 'updated_at'],
      rows: [{ teacher_id: 't-1', full_name: 'Tia Teacher', email: 't@example.com', group_id: 'G1', status: 'ACTIVE', active: true }],
    },
  };
});

describe('fetchStaff against the authoritative profiles schema', () => {
  it('reads staff keyed by user_id and never requests the non-existent id column', async () => {
    const result = await fetchStaff();

    expect(result.idKey).toBe('user_id');
    expect(result.cols).not.toContain('id');
    expect(result.rows).toEqual([expect.objectContaining({ user_id: 'u-1', full_name: 'Ann Admin', role: 'admin' })]);
  });

  it('keeps the first database error when every projection fails, so the UI can show why', async () => {
    schema.tables.profiles.columns = [];

    await expect(fetchStaff()).rejects.toThrow('profiles: column profiles.user_id does not exist (42703)');
  });

  it('still reports a missing table as a missing table', async () => {
    delete schema.tables.profiles;

    await expect(fetchStaff()).rejects.toThrow('Table "profiles" does not exist');
  });
});

describe('fetchTeachers against the authoritative teachers schema', () => {
  it('reads teachers keyed by teacher_id', async () => {
    const result = await fetchTeachers();

    expect(result.idKey).toBe('teacher_id');
    expect(result.rows).toEqual([expect.objectContaining({ teacher_id: 't-1', full_name: 'Tia Teacher' })]);
  });
});
