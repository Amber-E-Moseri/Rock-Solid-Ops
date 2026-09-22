# Supabase Migrations Guide

> **Purpose:** Explain migration conventions, naming, idempotency, and testing for Rock Solid Ops.  
> **Audience:** Engineers working on database schema changes.  
> **Last Updated:** 2026-09-22

---

## Overview

This directory contains all Postgres schema migrations for Rock Solid Ops. Every schema change (table creation, RLS policy, function definition, index) is captured as a migration file.

**Canonical State:** Migrations are the source of truth for the database schema. The production database state must match the HEAD of this directory.

---

## Migration Naming Convention

**Format:** `YYYYMMDDHHMMSS_descriptive_slug.sql`

**Example:**
```
202609221530_add_attendance_records_table.sql
202609221545_add_rls_policy_attendance.sql
202609221600_add_index_applicants_email.sql
```

**Rules:**
- Timestamp: Use UTC. The timestamp order determines execution order.
- Slug: Short, lowercase, hyphenated description of the change.
- Extension: Always `.sql`.

---

## Idempotency Rule (Critical)

**Every migration must be idempotent.** Running the same migration twice must not fail or corrupt data.

**Idioms:**

### Table Creation
```sql
-- ✅ GOOD: Idempotent
CREATE TABLE IF NOT EXISTS applicants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- ❌ BAD: Will fail on second run
CREATE TABLE applicants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

### Adding Columns
```sql
-- ✅ GOOD: Idempotent
ALTER TABLE applicants
ADD COLUMN IF NOT EXISTS middle_name VARCHAR(255);

-- ❌ BAD: Will fail on second run
ALTER TABLE applicants
ADD COLUMN middle_name VARCHAR(255);
```

### Dropping Columns (Compatibility)
```sql
-- For backward compatibility, avoid dropping columns. Instead, mark unused:
ALTER TABLE applicants
RENAME COLUMN obsolete_field TO _obsolete_field;

-- Or create a deprecation migration that swaps out the column:
ALTER TABLE applicants
ADD COLUMN IF NOT EXISTS email_new VARCHAR(255);

-- Backfill data, then drop old column in a subsequent migration
-- (This allows clients to migrate code independently)
```

### RLS Policies
```sql
-- ✅ GOOD: Idempotent (no error if already exists)
CREATE POLICY IF NOT EXISTS applicants_admin_all ON applicants
AS PERMISSIVE FOR ALL
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin');

-- ❌ BAD: Will fail on second run if policy exists
CREATE POLICY applicants_admin_all ON applicants
AS PERMISSIVE FOR ALL
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin');

-- ✅ ALTERNATIVE: Drop and recreate (if you need to change the policy)
DROP POLICY IF EXISTS applicants_admin_all ON applicants;
CREATE POLICY applicants_admin_all ON applicants
AS PERMISSIVE FOR ALL
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin');
```

### Indexes
```sql
-- ✅ GOOD: Idempotent
CREATE INDEX IF NOT EXISTS idx_applicants_email ON applicants (email);

-- ❌ BAD: Will fail on second run
CREATE INDEX idx_applicants_email ON applicants (email);
```

### Functions
```sql
-- ✅ GOOD: Idempotent with OR REPLACE
CREATE OR REPLACE FUNCTION get_applicant_status(applicant_id UUID)
RETURNS VARCHAR
AS $$
  SELECT registration_status FROM applicants WHERE id = applicant_id;
$$ LANGUAGE SQL;

-- ❌ BAD: Will fail on second run
CREATE FUNCTION get_applicant_status(applicant_id UUID)
RETURNS VARCHAR
AS $$
  SELECT registration_status FROM applicants WHERE id = applicant_id;
$$ LANGUAGE SQL;
```

---

## Content Guidelines

### 1. Start with a Comment Block

```sql
-- Migration: Add attendance_records table
-- Reason: Track class attendance for each applicant per session
-- Tables affected: attendance_records (new)
-- RLS: Enabled (admin/teacher read, admin write)
-- Idempotency: Uses IF NOT EXISTS and OR REPLACE
-- Rollback: Manual: DROP TABLE attendance_records; (data loss)

-- ========================================

-- Create attendance_records table
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  attended BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(applicant_id, class_id, session_date)
);

-- Index for query performance
CREATE INDEX IF NOT EXISTS idx_attendance_applicant ON attendance_records(applicant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance_records(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(session_date);

-- Enable RLS
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY IF NOT EXISTS attendance_admin_all ON attendance_records
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'superadmin'));

CREATE POLICY IF NOT EXISTS attendance_teacher_read ON attendance_records
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'teacher'
    AND class_id IN (
      SELECT id FROM classes WHERE teacher_id = auth.uid()
    )
  );

-- Audit log entry
INSERT INTO audit_logs (action, actor_id, target_id, metadata, created_at)
VALUES (
  'migration_applied',
  NULL,
  NULL,
  '{"migration": "202609221600_add_attendance_records_table.sql", "tables_created": 1}',
  now()
);
```

### 2. RLS on Every New Table

If a table is user-facing (not internal), it **must** have RLS enabled:

```sql
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

-- Then define policies for each role that touches it
CREATE POLICY ... ON <table_name> ...
```

### 3. Audit Logging

For schema changes that affect how data is processed (e.g., new column affecting registration logic), add a line to `audit_logs`:

```sql
INSERT INTO audit_logs (action, actor_id, target_id, metadata, created_at)
VALUES (
  'schema_change',
  NULL,
  NULL,
  '{"table": "applicants", "change": "added_source_field"}',
  now()
);
```

### 4. Constraints & Backfill

If adding a NOT NULL column to an existing table with data:

```sql
-- Step 1: Add column as nullable
ALTER TABLE applicants
ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10);

-- Step 2: Backfill existing rows
UPDATE applicants
SET preferred_language = 'en'
WHERE preferred_language IS NULL;

-- Step 3: Add NOT NULL constraint
ALTER TABLE applicants
ALTER COLUMN preferred_language SET NOT NULL;
```

---

## Testing Migrations Locally

### Fresh Bootstrap (Clean DB)

Test that all migrations apply cleanly from scratch:

```bash
# Remove local Supabase state (if using local dev)
supabase stop
supabase start

# Apply all migrations
supabase db push

# Verify schema
supabase db pull  # Downloads current schema; should match your local files
```

### Rollback Testing

Supabase does not auto-rollback. To test rollback safety:

1. Apply migration: `supabase db push`
2. Manually verify the change.
3. If rollback is needed (only on dev, never production):
   ```bash
   -- Manually revert the migration in Postgres
   DROP TABLE <table_name>;  -- or equivalent
   ```
4. Re-run: `supabase db push` — migrations will re-apply.

### Data Integrity Testing

For migrations that modify data (backfills, transformations):

```bash
-- In Supabase console (dev only), run spot checks:
SELECT COUNT(*) FROM applicants WHERE preferred_language IS NULL;
-- Should return 0 after backfill migration

SELECT COUNT(*) FROM applicants WHERE preferred_language = 'en';
-- Should return > 0 after backfill
```

---

## Migration Checklist

Before committing a migration, verify:

- [ ] Filename follows `YYYYMMDDHHMMSS_slug.sql` format
- [ ] All operations use `IF NOT EXISTS` / `OR REPLACE` / `DROP IF EXISTS` for idempotency
- [ ] New user-facing tables have `ENABLE ROW LEVEL SECURITY` and at least one policy per role
- [ ] New columns referencing users have appropriate `ON DELETE` behavior (CASCADE, RESTRICT, SET NULL)
- [ ] Indexes added for foreign keys and frequently filtered columns
- [ ] Migration has a comment block explaining purpose, tables, RLS, and rollback
- [ ] Migration tested: `supabase db push` runs without error on clean DB
- [ ] If modifying data: backfill logic tested with sample data
- [ ] Migration is **not** dropped into production without testing on staging first

---

## Production Deployment

**Never manually edit production schema.** Always:

1. Write migration file in repo.
2. Test on local/staging.
3. Commit to main.
4. Deploy via: `supabase db push --linked` (connects to production).

**Monitoring:**
```bash
# Check applied migrations
supabase migration list --linked

# View specific migration history
supabase db push --dry-run --linked  # Preview without applying
supabase db push --linked  # Apply (careful!)
```

---

## Common Pitfalls

| Mistake | Impact | Fix |
|---|---|---|
| Missing `IF NOT EXISTS` | Migration fails on re-run; blocks deployment | Add `IF NOT EXISTS` to all DDL |
| RLS not enabled | Unauthenticated users can read/write | Enable RLS; add policies |
| Missing foreign key index | Query performance degradation | Add index on FK columns |
| DROP COLUMN in production | Data loss; irreversible | Avoid; rename to `_deprecated_*` instead |
| Constraint violation on backfill | Migration hangs or fails | Test backfill logic on sample data first |
| Duplicate migration timestamp | Unpredictable execution order | Use unique timestamps; increment seconds |

---

## Reference

- **Supabase Docs:** https://supabase.com/docs/guides/database/migrations
- **Postgres DDL:** https://www.postgresql.org/docs/current/ddl.html
- **RLS:** https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- **Archive:** Historical migrations stored in `/docs/archive/` (read-only reference)
