# Testing — Foundation School Platform

Wave 2A establishes a permanent, layered test infrastructure that re-certifies Wave 1
security guarantees on every change. There are three test layers with distinct prerequisites.

---

## Quick reference

| Command | Needs DB | What it verifies |
|---|---|---|
| `bash scripts/test-unit.sh` | No | Deno edge-function units + SPA Vitest |
| `bash scripts/test-migration.sh` | Yes (resets!) | Migration chain reproducibility + schema invariants |
| `bash scripts/test-security.sh` | Yes | Wave 1 auth boundaries (full suite) |
| `bash scripts/test-nexus.sh` | Yes | Nexus upstream isolation only |
| `bash scripts/test-ci.sh` | Yes (resets!) | All three layers in sequence |

All scripts that touch a live database require `LOCAL_INTEGRATION_TEST=true` in env.
This gate prevents accidental runs against a production environment.

---

## Prerequisites

### Always required
- **Deno v2** — `deno --version`
- **Node 20 + npm** — `node --version`
- **foundation-spa deps** — `cd foundation-spa && npm ci`

### For DB-layer tests
- **Docker** — running
- **Supabase CLI** — `supabase --version`
- **psql** — `psql --version` (PostgreSQL client, not server)
- **Local Supabase running** — `supabase start` (one-time; not needed again unless stack is stopped)
- **Local dev keys exported** — run once per shell session:
  ```bash
  eval "$(supabase status --output env)"
  ```
  This sets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` for
  the local stack. These are deterministic local dev values, not production credentials.

---

## Layer 1 — Unit tests

No running database or Docker required.

```bash
bash scripts/test-unit.sh
```

**What runs:**
- 8 Deno edge-function unit test files (mock clients, no live DB)
- All 22 foundation-spa Vitest files (jsdom, all mocked)

**Known exclusion:** `supabase/functions/moodle-sync/moodle-sync.test.ts` — pre-existing
structural break (top-level `Deno.serve()` in index.ts prevents import). Tracked separately.

---

## Layer 2 — Migration gate

**WARNING: This destroys and recreates the local database.**

```bash
LOCAL_INTEGRATION_TEST=true bash scripts/test-migration.sh
```

**What runs:**
1. `supabase db reset --local` — replays all migrations from `supabase/migrations/` in order
2. Five schema invariant checks via psql:
   - `anon` does not have EXECUTE on `override_graduation_eligibility`
   - `anon` does not have EXECUTE on `admin_create_teacher_direct`
   - Stale `audit_log_staff_select` policy is absent from `audit_logs`
   - `audit_logs` has RLS enabled
   - `service_role` has SELECT on `profiles` (Wave 2A grants applied)

Run this whenever you add or modify a migration.

---

## Layer 3 — Security regression

```bash
LOCAL_INTEGRATION_TEST=true \
  eval "$(supabase status --output env)" && \
  bash scripts/test-security.sh
```

**What runs:**
1. `supabase/tests/security/wave1-regression.ts` — 4 suites:
   - **ACL** — verifies anon/PUBLIC cannot execute privileged functions; checks RLS config
   - **Teacher** — 4-role authorization matrix against `admin_create_teacher_direct`
   - **Graduation** — 5-role matrix against `override_graduation_eligibility`
   - **Audit** — SELECT/INSERT/UPDATE/DELETE assertions for 4 roles on `audit_logs`
2. `supabase/functions/nexus-users-search/nexus-upstream.test.ts` — Nexus isolation

**Note:** The security regression uses `psql` (via `Deno.Command`) for all DB setup
(fixture creation, role setting) and REST + user JWTs for authorization assertions.
It does not use PostgREST with the service key for setup — this avoids the clean-DB
service_role 42501 issue documented in `supabase/migrations/202609190000_wave2a_role_grants.sql`.

---

## Full local CI run

```bash
LOCAL_INTEGRATION_TEST=true \
  eval "$(supabase status --output env)" && \
  bash scripts/test-ci.sh
```

Runs unit → migration → security in order. Prints a per-suite PASS/FAIL summary.

---

## GitHub Actions CI

The workflow at `.github/workflows/ci.yml` runs on every push to `main` and on every
pull request targeting `main`. Three jobs:

| Job | Depends on | What it does |
|---|---|---|
| `unit` | — | Installs Deno + Node, runs `test-unit.sh` |
| `migration` | — | Starts local Supabase, runs `test-migration.sh`, stops stack |
| `security` | `migration` | Starts local Supabase, exports local keys, runs `test-security.sh`, stops stack |

**No production credentials are used.** The security job exports keys via
`supabase status --output env` — these are the deterministic local dev keys that only
work against the local stack spun up in that CI runner. They are not stored as GitHub
secrets and never touch production.

---

## Wave 1 security boundaries (what these tests protect)

| Boundary | Test | Migration |
|---|---|---|
| `anon` cannot call `override_graduation_eligibility` | ACL suite, Graduation suite | `202609181500_wave1_graduation_acl_hardening.sql` |
| `anon` cannot call `admin_create_teacher_direct` | ACL suite, Teacher suite | `202609180000_wave1_p0_admin_create_teacher_direct_remediation.sql` |
| Stale `audit_log_staff_select` policy removed | ACL suite, Audit suite | `202609181400_wave1_audit_logs_rls_remediation.sql` |
| Nexus rejects non-admin callers | Nexus test | `nexus-users-search/index.ts` (code, not migration) |
| Teacher RBAC: only admin/superadmin can create teachers | Teacher suite | `202609180000_...` above |

---

## Adding new tests

**Edge-function unit test:** add a `*.test.ts` file alongside the function source. Add it
to the `DENO_UNIT_TESTS` array in `scripts/test-unit.sh`.

**Security regression test:** add a new suite function in
`supabase/tests/security/wave1-regression.ts` following the existing pattern (`suiteAcl`,
`suiteTeacher`, etc.) and call it from `main()`.

**Migration invariant:** add a psql check in `scripts/test-migration.sh` with the same
`echo -n "  [N] description: "` / `FAIL=1` pattern.

**New Wave boundary:** document it in the table above, add assertions to the security
regression, and add a migration invariant check.
