# Batch campus coverage: backend contract

Status: **proposal. No migration is included.** Any migration needs owner approval and its own brief.

## Why this exists

The Batch Management page calculates Open Registration and campus coverage from `batch_campus_registration_settings`. Under the table's RLS, some roles see only some of its rows. A count built from those rows would look authoritative and be wrong.

Until this contract exists, the page does the following:

- Reads the settings table only for `superadmin`, `admin` and `regional_secretary`, which can read every row.
- For every other role, never makes the read. Open Registration and campus coverage show as unavailable (`—`, "Campus coverage unavailable"). Row labels omit campus.

## Current visibility (migration `202606101300`)

| Role | Settings rows readable | Settings rows writable | Notes |
|---|---|---|---|
| superadmin, admin, regional_secretary | all | all | Full view, so the page computes coverage. |
| subgroup_admin | rows whose campus is in the subgroup named by `auth.jwt() -> 'user_metadata' -> subgroup_id` | the same rows | See finding F1. |
| pastor | rows for the fellowship on their `teachers` row (`teacher_user_id = auth.uid()`) | none | Read-only. |
| principal | none | none | Has no settings policy at all. |
| anon | all | none | The registration form reads campus status with the anon key. See finding F2. |

## Required server contract

Provide one read-only RPC. It returns aggregate figures for the caller's scope, not batch or campus rows. This avoids exposing another campus's overrides to a partial-view role.

```
public.batch_campus_coverage()
returns table (
  scope            text,     -- 'all' | 'subgroup' | 'fellowship' | 'none'
  scope_complete   boolean,  -- true only when the figures are authoritative for the scope
  open_batches     integer,  -- batches with registration on and at least one accepting campus
  accepting_campus_count integer  -- distinct fellowship_code values still accepting
)
```

Rules:

1. `SECURITY DEFINER`, `STABLE`, `set search_path = public`. Read-only. It writes nothing.
2. The caller's role and assignment come from `profiles` and the teacher/assignment tables, never from `auth.jwt()` or `user_metadata`.
3. Eligibility follows the rules in `foundation-spa/src/features/batch-management/lib/batchCampus.js`:
   - explicit settings first (`registration_open = false` closes, `true` opens);
   - then organizational scope (a subgroup-scoped batch never widens to its group; an unmapped batch covers no campus);
   - a batch is open only if it has registration on and at least one accepting campus.
4. Per role:
   - `superadmin`, `admin`, `regional_secretary`: scope `all`, `scope_complete = true`.
   - `subgroup_admin`: scope `subgroup`. Count batches whose eligible campuses lie in the caller's subgroup. The subgroup must come from a server-side assignment (see F1). Label the result as subgroup scope.
   - `pastor`: scope `fellowship`. Count only batches reaching the pastor's fellowship. Label it as fellowship scope, never network-wide.
   - `principal`: **open question.** The data model has no principal-to-campus assignment. Until the owner defines one, return scope `none` with `scope_complete = false`. The page then keeps coverage unavailable.
5. Any error, missing assignment or unknown role returns scope `none`. The client must treat that as unavailable, never as zero.

## Client work after the contract exists

- Call the RPC for partial roles only. Keep the full-role path as it is.
- Display the returned scope label next to the figure, so a subgroup or fellowship count is never read as network-wide.
- Keep "unavailable" as the fallback for `scope_complete = false`, `scope = 'none'`, or any error.

## Constraints

- Do not add a SELECT policy for `principal` or widen any existing policy to make the client work. RLS changes need separate approval.
- Add database tests for each role's scope, including a role with no assignment.

## Findings (separate from this contract)

**F1. `subgroup_admin` policy trusts `user_metadata`.** The `bcrs_subgroup_admin_all` policy takes the subgroup from `auth.jwt() -> 'user_metadata' -> subgroup_id`. A signed-in user can edit their own `user_metadata`. A user whose profile role is `subgroup_admin` could therefore name another subgroup and gain read and write access to that subgroup's campus overrides. Fix: derive the subgroup from a server-side assignment. This needs a separate, approved migration.

**F2. Anonymous read of all override rows.** `bcrs_anon_select` lets the anon key read every row, so the public registration form can see which campuses are closed. This is intended. Record it here so the exposure is a deliberate decision.

## Out of scope for this change

No migration, no policy change, no RPC, no deployment, and no change to legacy Batch Management.
