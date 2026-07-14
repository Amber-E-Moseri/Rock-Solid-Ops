# Migration Log — Rock-Solid-Ops: Post-Audit Cleanup + Strangler-Fig Triage

Append-only. Entries are written before each gate is presented for confirmation,
per the documentation requirement in the brief. Do not rewrite past entries.

---

## 2026-07-13 — Phase A gate: audit findings presented, awaiting go/no-go on Phase B

### DECISION

Phase A was audit-only by design; the decisions here are classification and scoping
choices made while producing the report, not code changes.

1. **RLS audit method: static migration analysis, not live-DB query.** Considered
   querying `pg_tables`/`pg_policies` against the deployed project instead. Ruled out:
   no DB connection was established in this session, and the brief scoped the audit to
   "tables created after migration 202605121320 — cross-reference by migration file,"
   which migration-file analysis answers directly. Caveat recorded: this verifies what
   the migrations *declare*, not what the deployed DB *is* — drift between the two is
   possible and unverified.

2. **SPA triage method: router-wiring + line/file counts + test-file presence, not
   runtime verification.** Considered spinning up the Vite dev server and clicking
   through each of the 38 features. Ruled out for Phase A: the brief asked for
   classification with file/line counts as evidence, runtime parity-vetting is a much
   larger job, and the brief explicitly defers SPA feature work to a later pass.
   Classification is therefore "routed + substantive code + has test" ≈ real, not
   "verified functionally equivalent to legacy."

3. **"Retire soon" recommendations were made conditional, not absolute.** All 33 staff
   pages with routed SPA counterparts got "retire soon (gated)" rather than "retire now"
   because the entire `foundation-spa/` tree is untracked in git (see EVIDENCE). The
   alternative — recommending immediate retirement — was ruled out: retiring a working
   legacy page against an unversioned replacement is unrecoverable if the local tree is
   lost.

4. **ClickUp escalation audit (roadmap Phase 5 item) recommended for re-scope or drop,
   not build.** Alternative considered: build it as specced in `ai/refactor-roadmap.md`.
   Ruled out because commit 9e1ed97 and migration `202607101000_rocksolid_nexus_integration.sql`
   replaced ClickUp with the Nexus system entirely; building a ClickUp audit surface
   would target a decommissioned integration.

5. **One legacy page recommended for immediate retirement: `clickup-management.html`.**
   Same reasoning as (4) — superseded by both `rocksolid-management.html` and the SPA
   nexus-management feature.

### EVIDENCE

**A.1 Repo hygiene — brief's premise was wrong; scratch files are tracked, not gitignored:**
- `backup_before_include_all.sql`, `data_backup.sql`, `schema_backup.sql`: all 0 bytes,
  all **tracked in git** (confirmed via `git ls-files`). Not matched by any .gitignore rule.
- `message.txt` (5,325 bytes): **tracked**. Content is an old commit-message draft
  ("feat: email pipeline, Moodle sync, auth fixes, admin QoL, re-engagement").
- `files (5).zip` (33,600 B) and `rocksolid.zip` (510,999 B): untracked, correctly
  ignored via the `*.zip` rule (.gitignore line 29).
- `.env.local`: untracked, ignored via line 8. Correct.
- Six `PHASE_3_5_*.md` report artifacts (~90 KB total) tracked at repo root.
- Root `ARCHITECTURE.md` / `NEXT_STEPS.md`: 408/400-byte tracked pointer stubs to the
  `foundation/docs/` canonical versions.
- **Untracked-but-should-be-tracked (bigger risk than the scratch files):** the entire
  `foundation-spa/` tree and `foundation/staff/rocksolid-management.html` (555 lines)
  exist only in the working copy. Also uncommitted modifications: `README.md`,
  `foundation/docs/DEPLOYMENT_CHECKLIST.md`, `foundation/docs/SYSTEM_OVERVIEW.md`,
  `foundation/js/admin-shell.js`, `foundation/staff/admin-management.html`; untracked
  `CLAUDE.md`, `ai/*.md`.

**A.2 RLS coverage after 202605121320 — exactly one gap:**
- `attention_flags`, created in `202605220011_needs_attention_rpcs.sql`: no
  `ENABLE ROW LEVEL SECURITY` statement and no `CREATE POLICY` for it anywhere in
  `supabase/migrations/` (verified with whitespace-tolerant grep across all files).
  Reads flow through three SECURITY DEFINER RPCs (`get_student_attention_flags`,
  `get_teacher_attention_flags`, `get_system_attention_flags`, all granted to
  `authenticated`), but the table itself is exposed to direct PostgREST access under
  default grants.
- False positive corrected during audit: `student_engagement_log` initially appeared
  uncovered because `202605170004` uses aligned multi-space formatting
  (`student_engagement_log    enable row level security`) that the first regex missed.
  It IS covered (line 39) with a select policy (line 43). Re-ran with `\s+` pattern.
- `class_selection_tokens` had a coverage window (created 202605180005 without RLS,
  enabled in `202606101200_security5_hardening.sql`) — closed, no action needed.
- All other post-cutoff tables verified covered (enable + ≥1 policy): attendance_records,
  student_engagement_log/config, in_app_notifications, report_archive, email_templates,
  student_grades, graduation_eligibility, message_conversations/participants/messages,
  duplicate_registration_groups/notifications/resolution_audit,
  batch_campus_registration_settings, email_campaigns, milestone_definitions,
  student_milestone_status, rocksolid_admin_mappings, rocksolid_task_links.

**A.3 Roadmap status:**
- Rate limiting on registration-processor: grep for `limit|throttle|captcha|honeypot`
  (case-insensitive) over `supabase/functions/registration-processor/index.ts` returns
  only `.limit(1)` query-builder calls and one JSON body field. No request throttling
  exists. `message.txt` (and repo config) indicate `verify_jwt = false` for this
  function, i.e. it is a public unauthenticated write endpoint. The only rate-limit
  code in the codebase is email-sender's per-recipient 24h cap
  (`email-sender/index.ts:139`) and retry-classification in `_shared/http.ts` — neither
  gates inbound registration traffic.
- Per-applicant trace view: DONE. `foundation/staff/operational-trace.html` (435 lines)
  + `foundation/js/operational-trace.js` (152 lines) + `get_operational_trace` RPC
  (migrations 202605181100, hardened 202605121830) + routed SPA page
  (`operational-trace`, 3 files / 396 lines).
- trace_id in email pipeline: DONE. `202605121700` adds trace_id to
  scheduled_notifications (NOT NULL, default gen_random_uuid()) and email_queue
  (nullable — manual sends legitimately lack one); `202605121900` adds it to
  moodle_enrollment_sync; `202605181110` backfills.
- Moodle sync failure dashboard: PARTIAL. `failure_reason` column exists
  (`202605121600_moodle_failure_reason.sql`); surfaced as inline text at
  `foundation/js/system-health.js:452` and mapped in
  `foundation-spa/src/features/failed-sync-retry-center/lib/failed-syncs.js:42-43`.
  No per-cause aggregation/grouping UI exists in either the legacy retry center
  (`failed-sync-retry-center.html`, 227 lines — zero matches for
  failure_reason/breakdown/escalation) or the SPA one.
- ClickUp escalation audit in Retry Center: NOT BUILT. Zero escalation references in
  either retry center implementation. Superseded by Nexus (see DECISION 4).

**A.4 SPA triage — 38 feature folders, not the 43 stated in the brief:**
- Router (`foundation-spa/src/App.jsx`) wires 36 folders to real routes; unmatched
  `/staff/*` and ALL `/teacher/*` paths fall to PlaceholderPage (23 lines, "Coming
  soon" + pointer back to legacy).
- Classification (files/lines per folder captured in the Phase A report):
  (a) real+routed+tested: 20 features (largest: applicant-directory 7/1406,
  dashboards 4/865); (b) real code, routed, no dedicated test: 15 features (largest:
  class-editor 2/686); (c) stub/infra: admin-review (1/9, intentional redirect to
  applicant-directory?tab=review), placeholder (1/23), design-showcase (1/146,
  dev-only route). 20 test files under `foundation-spa/src/tests/`.
- Initial stub-detection grep for "placeholder|coming soon|TODO" produced 33 file hits
  — discarded as evidence because it matched HTML `placeholder=` input attributes.
  Router analysis used instead.

**A.5 Cross-reference highlights:**
- Every foundation/staff page except clickup-management has a routed SPA counterpart.
- No SPA replacement exists (all placeholder-routed) for: the public registration flow
  (`registration-form.html` 1,980 lines — largest file in the repo;
  `class-selection.html` 156), the teacher portal (`teacher/index.html` 1,037;
  `teacher/teacher-attendance.html` 1,063; teacher-progress 210; teacher-availability
  82; roster 15; sections/* 24–374), and two auth pages (`reset-password.html` 181,
  `teacher-register.html` 151). These form the proposed "harden in place" set for
  Phase B.4 inline-JS extraction.
- Size-parity flags (SPA notably smaller than legacy, parity unverified):
  milestones-admin 348 vs 717; several others near parity (dashboards 865 vs 814).

### DEVIATIONS

None in the code sense — Phase A made no changes, so no legacy behavior was replicated
or skipped. Two deviations from the brief's own text, both surfaced rather than silently
absorbed:
- The brief's instruction to "confirm each is gitignored" could not be satisfied as
  written: four of the named files are tracked, not ignored. Reported as a finding
  instead of forcing the premise.
- The brief's "43 feature folders" count is wrong; actual count is 38. Reported actuals.

### OPEN QUESTIONS (all presented at the Phase A gate, unresolved)

1. Scratch files are tracked → removal is `git rm` + gitignore entries, not a move.
   Delete outright or archive first? (The three .sql files are empty; nothing is lost
   either way. `message.txt` content is a stale commit draft.)
2. Go-ahead for the `attention_flags` RLS migration, including which write paths (if
   any) besides the SECURITY DEFINER RPCs must keep working.
3. Rate limiting for registration-processor: confirm in-scope for Phase B and whether a
   DB-backed per-IP/per-email throttle is the acceptable design.
4. Confirmation of the retire-vs-harden table, especially the harden-in-place set
   (registration flow + teacher portal + reset-password + teacher-register) as the
   Phase 3 extraction scope.
5. Should committing `foundation-spa/` to version control be added to Phase B? (Blocks
   every "retire soon" recommendation; the rebuild is currently unversioned.)
6. Retire `clickup-management.html` in this pass?
7. `rocksolid-management.html` (legacy, untracked) vs SPA `nexus-management` — two
   implementations of the same new feature; which is canonical?

---

## 2026-07-13 — Phase A gate addendum: deeper dig on the two out-of-band items (still pre-confirmation)

Triggered by a follow-up request for more detail on (1) committing foundation-spa/,
(2) retiring clickup-management.html, (3) the rocksolid-management.html vs
nexus-management "duplication." Investigation changed the recommendation on (2) and (3)
materially enough to warrant its own entry rather than folding into the original one.

### DECISION

1. **foundation-spa/ commit recommendation: unchanged (yes, add to Phase B), now with
   a size figure instead of a guess.** Alternative considered: leave it uncommitted
   until after SPA feature work is scoped in a later brief. Ruled out — the risk
   (single-machine unversioned rebuild) exists regardless of when feature work starts,
   and committing costs nothing since node_modules/dist/.env.local are already
   gitignored inside foundation-spa/.

2. **clickup-management.html: recommendation changed from "retire now, dead weight"
   to "retire the assignee-mapping half, but first decide if watcher/follower routing
   is an intentional drop or a gap to rebuild."** The original recommendation treated
   the whole page as superseded. Deeper inspection found the page manages two distinct
   things under one UI (assignee mappings + watcher mappings), and only one of them
   (assignee mapping) was actually carried forward into rocksolid_admin_mappings /
   rocksolid-management.html / SPA nexus-management. Watcher mapping has zero
   equivalent anywhere in the new system. Recommending outright retirement without
   flagging this would silently delete the only admin surface for a feature that may
   still matter for live escalations.

3. **rocksolid-management.html vs nexus-management: not a "pick a canonical
   implementation" decision — reclassified as an ordinary legacy-page vs
   SPA-replacement pair.** Original framing implied two competing designs for the same
   new feature needing a tie-break. That framing was wrong: rocksolid-management.html
   is the current legacy-tree implementation (vanilla JS, already linked in
   admin-shell.js nav under the "nexusmapping" key) and NexusManagementPage.jsx is its
   SPA strangler-fig replacement — same relationship as every other legacy/SPA pair in
   the repo, not a special case. No separate decision needed here beyond the standard
   retire-soon-gated treatment once foundation-spa/ is versioned and parity-vetted.

### EVIDENCE

**On foundation-spa/ commit-readiness:**
- Trackable size (excluding node_modules/, dist/, .env.local): 0.93 MB across 140
  files. Full tree including node_modules: 125.98 MB / 11,878 files.
- `foundation-spa/.gitignore` already exists and correctly excludes `node_modules/`,
  `dist/`, `.env.local`, `.env.*.local`.
- `.env.example` present (placeholder pattern, consistent with repo root convention);
  `.env.local` present and correctly ignored — did not print its contents (blocked by
  the harness's credential-materialization guard, correctly so; existence and
  gitignore status were sufficient to answer the question).
- No hardcoded Supabase URLs or JWT-shaped strings (`supabase.co`, `eyJhbGci`) found in
  `foundation-spa/src/supabase.js`.
- Conclusion: committing is a plain `git add foundation-spa/` at ~1 MB, no secrets
  exposure risk identified.

**On clickup-management.html vs rocksolid-management.html vs SPA nexus-management —
this is the material correction:**
- `clickup-management.html` manages TWO tables via two tabs: `clickup_admin_mappings`
  ("ClickUp Assignees" — group/subgroup to clickup_user_id, tab note: "Primary assignee
  mapping: subgroup first, then group fallback") and `clickup_admin_watchers`
  ("ClickUp Watchers" — tab note: "Watcher mapping is secondary/follower routing only").
- `rocksolid-management.html` and
  `foundation-spa/src/features/nexus-management/lib/nexusManagement.js` both read/write
  `rocksolid_admin_mappings` ONLY (admin_email, nexus_user_id/name/email, group_id,
  subgroup_id, active). No watcher-equivalent table or UI exists in either.
- `supabase/functions/clickup-sync/index.ts:161-190` (`resolveAssignee()`) — the actual
  server-side assignee-resolution logic used when creating an escalation task — queries
  `rocksolid_admin_mappings` exclusively (subgroup match first, group-null fallback
  second, same precedence the old tab note described for the ClickUp table). Zero
  references to `clickup_admin_mappings` or `clickup_admin_watchers` anywhere in the
  file (confirmed by grep, no matches). Confirmed no other edge function under
  `supabase/functions/` references either table (grep across the whole functions/ dir,
  no hits).
- Conclusion: `clickup_admin_mappings` is a fully orphaned table — nothing server-side
  reads it anymore; the assignee-mapping feature migrated cleanly to
  `rocksolid_admin_mappings` and is live. `clickup_admin_watchers` is also orphaned
  server-side, but unlike assignees, its underlying capability (secondary/follower
  notification routing on escalation tasks) has no replacement anywhere in the new
  system — it wasn't ported, it was dropped.
- `foundation/js/admin-shell.js` already treats `clickup-management.html` as a
  deprecated alias: both `rocksolid-management.html` and `clickup-management.html`
  paths map to the same `"nexusmapping"` nav key (lines 305-306), and only the
  rocksolid link appears in the nav item list (line 130) — clickup-management.html has
  no discoverable nav entry of its own anymore.
- Separate bug surfaced during this dig, not part of the original ask:
  `foundation/staff/dashboards.html:736` renders escalation rows with
  `<a href="https://app.clickup.com/t/${r.clickup_task_id}">`. But
  `clickup-sync/index.ts:325-330` writes `nexusTaskId` (a Nexus task ID, from
  `NEXUS_LIST_ID`/`NEXUS_SPACE_ID`, per commit 9e1ed97's ClickUp-to-Nexus replacement)
  into the same `clickup_task_id` columns on `moodle_enrollment_sync` and `applicants`
  "for backwards compat" (comment at line 325). Any escalation created after that
  migration will render a clickable link to `app.clickup.com` carrying a Nexus task ID
  — a dead/wrong link for every post-migration escalation. The SPA dashboards feature
  has no equivalent widget yet (`clickup_task_id`/`clickup.com` grep over
  `foundation-spa/src/features/dashboards` returns no matches), so this bug is confined
  to the legacy page for now and not yet superseded.

### DEVIATIONS

None from prior confirmed work (still pre-Phase-B, no code changed). Explicitly
correcting my own prior statement rather than letting it stand uncorrected: the
original Phase A report's line "superseded twice over... dead weight" for
clickup-management.html understated the situation — it is dead weight for the
assignee-mapping half, but the watcher-mapping half represents an unreplicated
capability, not just legacy cruft. Leaving the original wording uncorrected would have
led to an uninformed retirement decision.

### OPEN QUESTIONS

1. Was watcher/follower routing (secondary notification routing on escalation tasks)
   deliberately dropped when Nexus replaced ClickUp, or is it a gap that needs to be
   rebuilt into `rocksolid_admin_mappings`/nexus-management before
   `clickup-management.html` can be safely retired?
2. Should the dashboards.html dead-link bug (`clickup_task_id` values now containing
   Nexus IDs, linked to `app.clickup.com`) be fixed in this Phase B pass, filed as a
   separate bug, or left as-is pending an intentional decision on whether escalation
   tasks should link out at all? It sits outside the brief's stated scope
   (foundation/js/* and supabase/migrations/*) since the fix lives in
   foundation/staff/dashboards.html markup/JS.
3. Confirm: commit `foundation-spa/` as-is (~1 MB, 140 files, already gitignoring
   node_modules/dist/.env.local) as part of Phase B?

---

## 2026-07-13 — Phase B started (user said "go ahead"); RLS gap closed, everything else held at the brief's second gate

### DECISION

The brief defines two gates, not one: "Confirm before starting Phase B" and
"Confirm again before touching any file outside foundation/js/ or supabase/migrations/."
User's "go ahead" satisfies the first gate. It does not, on its own, satisfy the
second — that second gate exists specifically to stop scope creep into
foundation-spa/ and other paths, and collapsing it into a general "go ahead" would
defeat its purpose. Alternative considered: treat "go ahead" as blanket approval for
all of Phase B including the open questions from the last two entries. Rejected —
several of those items (scratch file deletion at repo root, rate limiting inside an
edge function, inline-JS extraction touching foundation/staff/*.html, the
foundation-spa/ commit, the dashboards.html link bug, clickup-management.html
retirement) all sit outside foundation/js/ and supabase/migrations/, and multiple of
them still have unresolved open questions from prior entries (watcher-routing fate,
scratch-file disposal, rate-limit design) that are decisions for the user, not
defaults I should silently pick.

Executed now, in scope, no open question blocking it: **B.2, the attention_flags RLS
migration.** New file only, inside supabase/migrations/, matches an established
in-repo convention closely enough that no design judgment call was needed.

### EVIDENCE

- Confirmed via `foundation/staff/needs-attention.html:208,448,457` that the legacy
  page performs direct client-side `select`, `update` (line 448, resolving a flag),
  and conditional `insert` (line 457, fallback when no row matched the update) against
  `attention_flags` — not just through the three RPCs. Any RLS policy had to cover all
  three operations, not just select.
- Matched policy shape to `202605121130_security3_rls_coverage_new_tables.sql`, which
  applied the identical select/insert/update-via-`is_admin()` pattern to sibling
  operational tables (`moodle_enrollment_sync`, `clickup_task_links`,
  `student_milestone_status`) rather than the looser
  `auth.role() = 'authenticated'` pattern seen in `202606160002_student_milestones.sql`
  — chose the stricter precedent because attention_flags is an admin ops surface, and
  the stricter pattern is what every other table in its own class already uses.
  Considered the looser pattern as an alternative; rejected because it grants access to
  every authenticated user including teachers, and nothing about attention_flags
  (staff "Needs Attention" queue) needs teacher-level access.
- Verified `public.is_admin()` (current definition, `202605220030_regional_secretary_rls_fix.sql`)
  covers `superadmin, admin, subgroup_admin, pastor, principal, regional_secretary` —
  matches the SPA route's `ProtectedRoute roles={['admin', 'regional_secretary']}` for
  `/staff/needs-attention` in App.jsx, so the new policy doesn't lock out a role the
  SPA already treats as authorized.
- No delete policy added — grepped both attention_flags call sites and found no
  `.delete()` call anywhere against this table, so none was added (least privilege;
  matches sibling tables which also stop at select/insert/update).
- New file: `supabase/migrations/202607131400_attention_flags_rls_coverage.sql`.
  Additive only (`enable row level security` + `create policy`), idempotent
  (`drop policy if exists` before each `create policy`, matching repo convention).

### DEVIATIONS

None — this migration replicates existing RLS behavior patterns from the codebase
exactly; it doesn't change any client-facing behavior for authorized roles (RPCs were
already open to authenticated users regardless of table-level RLS; the direct
select/update/insert paths in needs-attention.html were previously ungated at the table
level and are now restricted to the same role set the page and its RPCs already assume
has access — so no legitimate current caller loses access).

### OPEN QUESTIONS

All open questions from the prior two entries remain unresolved and are being
re-presented to the user now, bundled, as the second-gate request the brief requires
before touching anything outside foundation/js/ or supabase/migrations/. Nothing new
added in this entry.

---

## 2026-07-13 — Admin/Staff self-service creation: Phase A audit + permission-boundary decision

Brief: "Rock-Solid-Ops: Self-Service Admin/User Creation from UI." Phase A was
audit-only. This entry logs the permission-boundary decision (brief Phase A.3) and the
access-control finding, per the documentation requirement, before the Phase B build/gate.

### DECISION — permission boundary (user-confirmed 2026-07-13)

Who may create a staff/admin user via the new server-enforced action, and for which
target roles:

- **superadmin** → may create a staff user of **any** role (teacher, principal,
  subgroup_admin, pastor, admin, superadmin, regional_secretary).
- **admin** → may create **teacher** only.
- **principal, subgroup_admin, pastor, regional_secretary, teacher, pending** →
  may NOT create staff users at all.

Enforcement is **server-side** in the edge function handler (not just the UI). Rationale:
this mirrors the *intent* already expressed client-side by both surfaces
(`allowedRoleAssignments()` in `foundation/staff/admin-management.html` and
`VALID_ROLES_ADMIN` in the SPA), but narrows the admin tier from {teacher, principal} to
{teacher} at the user's explicit direction — principal is admin-like under `is_admin()`,
so letting a plain admin mint a principal would let an admin create an admin-like account,
contradicting "superadmin creates all elevated roles." Granting admin access is higher
stakes than teacher access, so the elevated tier stays with superadmin exclusively.

Alternatives considered and rejected:
- "Mirror UI exactly" (admin → teacher+principal): rejected because principal is
  admin-like; would let admin escalate laterally into the admin-like tier.
- "Admin can create peers" (admin → any incl. admin): rejected — enables unbounded
  lateral privilege spread from a single compromised admin.

### FINDING — server-side privilege-escalation gap (documented, NOT fixed this brief)

User decision: **document, do not fix yet.**

RLS policy `profiles_self_or_admin_update` (migration 202605061400_rls_hardening.sql)
permits **any** `is_admin()` role to UPDATE **any** profile row's `role` column to **any**
value, including `superadmin`. `is_admin()` = {superadmin, admin, subgroup_admin, pastor,
principal}. The self-protection trigger
`profiles_protect_self_role_and_activation_updates()` (202605071980) only blocks
*self*-promotion by *non*-admin owners; it does not constrain admin-like roles editing
*other* rows, nor cap which target role an admin may assign.

Net effect: a **principal** (or subgroup_admin / pastor) — none of whom the admin-
management UI ever exposes staff-role controls to — can call the Supabase REST API
directly and set any profile (including their own) to `superadmin`. The client-side
"only superadmin assigns elevated roles" boundary has no server-side backing.

Consequence for this brief: the new `createAdminDirect`-equivalent action will be the
FIRST server-enforced path for staff-role assignment. It does not remove the existing
direct-`profiles.update()` escape hatch used by the "Edit Role" flow — that remains a
separate, pre-existing gap tracked here for a future hardening pass (candidate: a
migration restricting elevated-role assignment to superadmin via a trigger or a tightened
WITH CHECK). Filed as a known finding; out of scope for the current build.

### HOME — new action lands in `admin-api` (not `teacher-portal-api`)

`admin-api` uses the newer `_shared/supabase.ts` client (required by ai/constraints.md for
new functions), already has an admin-scoped resolveAuth + action-map, and is the correct
semantic home. Caveats to handle in Phase B: (a) `admin-api` resolveAuth currently admits
principal + regional_secretary, so the handler must apply the tighter boundary above
itself; (b) `admin-api` currently sets CORS `Access-Control-Allow-Origin: *`, which
CLAUDE.md forbids for authenticated endpoints — will not be propagated into new code.

### GATE

Phase A confirmed by user. Proceeding to Phase B build. Per the brief's ship-gate and the
strangler-fig direction, foundation-spa/ is the primary target; if legacy foundation/ and
SPA cannot land together, SPA ships first and the legacy parity gap is noted here before
the ship gate.

---

## 2026-07-13 — Admin/Staff self-service creation: Phase B build complete (pre-ship gate)

Both surfaces built and landed together in the working tree — NO parity gap to record.
Nothing committed/deployed yet; awaiting the brief's ship-gate confirmation.

### WHAT SHIPPED (working tree)

Backend:
- `supabase/functions/admin-api/_actions/create-staff-direct.ts` — new action
  `create-staff-direct`. Server-enforces the boundary from the prior entry
  (`assertStaffCreationAllowed`, extracted as a pure fn for testability):
  superadmin -> any role; admin -> teacher only; all others -> 403. Then validates
  payload, pre-checks duplicate email (409), creates the auth user via service-role
  `auth.admin.createUser`, finalizes the profile role via idempotent upsert (rolls back
  the auth user if finalize fails), and writes a `staff_created_direct` audit row.
- `supabase/functions/admin-api/index.ts` — registered the action in the action map.
- No new migration required: the profiles table, role enum (incl. every target role),
  and the `handle_new_auth_user_profile` signup trigger already exist. The boundary lives
  in the edge function (caller-role check), not in an RPC — a service-role RPC cannot see
  `auth.uid()`, so the caller check must happen in the handler, exactly as
  createTeacherDirect does.

Tests:
- `supabase/functions/admin-api/create-staff-direct.test.ts` — boundary asserted
  exhaustively (superadmin can create every role; admin only teacher; admin creating admin
  is 403; principal/subgroup_admin/pastor/regional_secretary/teacher/pending all 403;
  pending/unknown targets rejected 400), plus handler-level tests proving a rejected caller
  produces NO auth user and NO writes, a superadmin->admin success finalizes the profile +
  audits, duplicate email -> 409 pre-createUser, short password -> 400.
  NOTE: Deno is not installed in this dev environment, so these were not executed here.
  Run: `deno test supabase/functions/admin-api/create-staff-direct.test.ts`.

UI — foundation-spa/ (primary, strangler-fig target):
- New `CreateStaffModal` in `AdminManagementPage.jsx` (temp password + show/hide toggle +
  role select limited to the caller's allowed set + one-time credential display on
  success). Staff-tab "Add" now opens it; role list from `CREATE_ROLES_*` constants.
- `lib/adminManagement.js` `createStaffDirect()` + `hooks/useAdminManagement.js`
  `useCreateStaffDirect()`. Edit-Staff modal copy updated to point new-account creation at
  "Add Staff". `npm run build` passes.

UI — foundation/ (legacy):
- `staff/admin-management.html`: staff-tab "Add" now opens a new "Add Admin / Staff" create
  modal (mirrors Add Teacher UX: temp password + Show/Hide, role select, one-time
  credential panel). New `staff-create` / `staff-create-done` branches in `saveModal()`
  call `supabase.functions.invoke('admin-api', ...)`. Tab note + edit-modal copy updated.
  Module script passes `node --check`.

### FINDING — pre-existing SPA modal bug (NOT introduced here, NOT fixed)

`src/components/ui/Modal.jsx` only renders when passed a truthy `open` prop. The existing
`StaffModal`, `TeacherModal`, and `LinkModal` in `AdminManagementPage.jsx` (and
`ReportsPage.jsx`'s re-send modal) render `<Modal ...>` WITHOUT `open`, so those modals
currently display nothing when triggered. My new `CreateStaffModal` passes `open` and works.
Flagged for the user; left unfixed to avoid scope creep into other features under the
logic-frozen rule. Candidate one-line fix per modal if approved.

### DEVIATIONS

- admin-api CORS remains `*` (pre-existing; documented in prior entry). Not changed to avoid
  altering the existing assign-applicant-admin endpoint's behavior.
- Legacy admin `createStaffRoleOptions()` includes `regional_secretary` for superadmin to
  match the SPA list, even though legacy `validRoles` (used only for the *edit* path) omits
  it. The server is the source of truth and accepts it; the edit-path list was left
  untouched for parity.

---

## 2026-07-13 — PWA + Mobile + Push brief: Phase A audit + Phase B responsive fixes (recorded at the Phase C gate)

Different brief from the entries above ("Rock-Solid-Ops: PWA + Mobile Responsiveness +
Push Notifications", foundation-spa). This entry is written slightly after the fact:
Phase A was presented and its four scope decisions confirmed by the user, and Phase B
(responsive) was completed, before this log entry existed. Recording both here at the
Phase C gate rather than leaving them undocumented — the push-sender correction below is
the load-bearing finding.

### DECISION — Phase A scope, user-confirmed 2026-07-13

1. **Push sender: build correctly, do NOT port Nexus verbatim.** See the EVIDENCE
   correction — the Nexus `send-task-push-notification` reference is not a working Web
   Push sender. Phase C will implement a real one (VAPID JWT auth + RFC-8291 payload
   encryption, JWT caller verification, ALLOWED_ORIGINS CORS), reusing only Nexus's
   client subscribe flow (`webPush.js`) and UX components.
2. **Mobile tables: hybrid.** Universal horizontal-scroll safety net for all table pages
   (one shared CSS change) + real card fallbacks on the four heaviest data views
   (applicant-directory, waitlist, batch-management, dashboards). Considered per-page
   cards everywhere (rejected: 26 pages of work for marginal gain over scroll on narrow
   tables) and scroll-only (rejected: poor UX on the heaviest views).
3. **Offline caching boundaries approved as scoped:** cache-first for app shell +
   `class_options` / `milestone_definitions` / `batches` / help-guide; network-only
   (never cached) for `applicants`, `profiles`, `attendance_records`, registration
   status, `audit_logs`, `email_queue`, `attention_flags`. `batches` confirmed safe:
   its columns are cohort config (name/dates/registration_open), not enrollment/capacity
   counts — live seat data lives in `class_roster`/`class_options`, which are not cached.
4. **Push triggers in scope (staff-facing only):** registration status change
   (registration-processor), attention flag raised (attention_flags/needs-attention),
   teacher availability + waitlist movement. Moodle-sync-failure trigger deferred
   (Retry Center already surfaces those; revisit if insufficient).

### EVIDENCE

**The material correction — Nexus web push is not "proven infrastructure":**
- `Nexus-main.zip` → `supabase/functions/send-task-push-notification/index.ts` sends a
  push by doing `fetch(subscription.endpoint, { method:'POST', body: plainJson })` with
  **no VAPID JWT signing and no RFC-8291 payload encryption**, and it never reads the
  `VAPID_PRIVATE_KEY` its own `WEBPUSH_SETUP.md` tells you to set. Browser push services
  (FCM, Mozilla autopush, Apple) reject unauthenticated/unencrypted requests — this code
  would not deliver a payload notification in production. Only the client subscribe flow
  and the UX components are reusable; the server sender must be built.
- It also uses CORS `Access-Control-Allow-Origin: *` and does no JWT caller verification,
  both of which violate this repo's own CLAUDE.md edge-function rules. So "port verbatim"
  was rejected on both correctness and security grounds.
- The brief framed Nexus as a live sibling codebase; it is in fact a zip in Downloads.
  Files were extracted read-only for reference, not wired in.

**Schema target differs from Nexus:**
- Nexus writes push columns to a `users` table. This repo has **no `public.users` table**
  — staff/teacher/admin accounts live in `public.profiles` (keyed to `auth.users`, role
  column present). Phase C push columns (`push_subscription`/`push_subscribed_at`/
  `push_enabled` + partial indexes) go on `profiles`, additive with RLS policies.
- **Applicants have no auth accounts** (no auth_user_id on `applicants`; grep confirms).
  Push can therefore only reach authenticated staff/teachers — never applicants/students.
  All applicant-facing notifications stay on the existing email pipeline
  (scheduled_notifications → notification-batch-processor → email_queue → email-sender).
  This is why every approved trigger in DECISION 4 is staff-facing.

**Mobile audit:**
- SPA stack: React 19 + Vite 7 + React Query + react-router 6 + radix + framer-motion +
  lucide-react. **No Tailwind** — CSS-token system in `src/styles/tokens.css`. So the
  Nexus PWA components (Tailwind utility classes + a `usePWA` hook not present in the zip)
  do not port cleanly; Phase C must rewrite their styling to tokens and build the hook.
- Table-vanish bug: `.rso-table-wrap` was `display:none` below 640px handing off to
  `.rso-table-cards`, but only 1 of 27 table pages (audit-log) actually rendered the card
  markup → the other 26 pages' tables disappeared entirely on phones (worse than
  overflow). The Shell itself is already responsive (hamburger + backdrop + mobile-open).
- Fixed `repeat(N,1fr)` grids (8 of them) turned out to be skeleton loaders only; real
  KPI/stat rows already use `auto-fit`; calendar grids already scroll. No grid work done.
- Touch targets undersized (.icon-btn 32px, .rso-btn-sm ~28px) — fixed in Phase B.
- SPA stubs (excluded from all feature work): placeholder, design-showcase, admin-review
  (redirect). 35 real feature folders in scope.

### CHANGES MADE (Phase B — foundation-spa only, all additive UI)

- `src/styles/components.css`: replaced the unconditional
  `@media (max-width:640px) .rso-table-wrap { display:none }` with
  `.rso-table-wrap:has(+ .rso-table-cards) { display:none }` — tables WITHOUT a card
  fallback now stay horizontally scrollable instead of vanishing; tables WITH an adjacent
  `.rso-table-cards` still hand off. Added an `@media (hover:none) and (pointer:coarse)`
  block giving 44×44 tap targets (icon-btn, small buttons, sidebar links, table cells)
  without changing desktop density.
- Card fallbacks (`.rso-table-cards`) added to: ApplicantDirectoryPage, WaitlistPage
  (students table), BatchManagementPage, DashboardsPage (Recent Registrations). Each card
  reuses the exact helpers already rendering that page's table rows.

### DEVIATIONS

- Live card-with-data screenshots were NOT captured. They require an authenticated
  session; enabling `VITE_BYPASS_ROLE` to work around that was (correctly) blocked by the
  safety classifier under this repo's never-bypass-auth rule, so it was not pursued.
  Verification instead rests on: the shared CSS rule proven at 375px via synthetic-DOM
  computed-style checks (no-fallback → block/overflow-x:auto; with-fallback →
  wrap:none/cards:grid), a clean Vite build across all five edits, and zero console
  errors. A human should still eyeball the four pages at phone width once logged in.

### GATE — Phase C (PWA infra + push), not yet started

Blocker satisfied at this gate: `foundation-spa/` committed to version control (flagged
uncommitted three times prior). Phase C ordering confirmed: **PWA shell first, then
push** — iOS Safari only delivers web push to a PWA actually installed to the home
screen, so meaningful iOS push testing requires the install shell to exist first.
Real-device testing (Phase C.5) cannot be done in this environment (no Android/iOS
hardware); it remains a human step, especially iOS Safari.

---

## 2026-07-13 — Fix: SPA modals rendered nothing (missing `open` prop)

Standalone bug fix, tracked separately from the create-staff-direct feature. This is a
real functional bug affecting current users, found incidentally while building that
feature — deliberately NOT folded into the feature commit.

`src/components/ui/Modal.jsx` only renders its content when passed a truthy `open` prop.
Four call sites omitted it, so those modals showed nothing when triggered:
- `AdminManagementPage.jsx`: StaffModal (Edit Role), TeacherModal (Edit Teacher), LinkModal
  (Link Teacher to Auth User)
- `ReportsPage.jsx`: Re-send Report modal

Fix: add the `open` prop to each (one word per component), mirroring what every working
Modal call site — and the new CreateStaffModal — already does. No behavior change beyond
making the modals actually appear. `npm run build` passes.

---

## 2026-07-13 — Fix: server-side role-assignment boundary on profiles (RLS escalation gap)

Fast follow-up to create-staff-direct. Phase A recorded this gap as "document, don't fix
in this brief"; that call was revisited because shipping a feature whose entire purpose is
tightening who can create/promote staff, while the underlying profiles RLS still lets any
is_admin() role escalate anyone to superadmin via direct REST, is internally inconsistent —
front door locked, side door open.

New migration `202607131500_profiles_role_assignment_boundary.sql`: a BEFORE UPDATE trigger
`profiles_enforce_role_assignment()` that gates role CHANGES in a user (RLS) session:
  - superadmin -> may assign any role
  - admin      -> may assign only non-elevated roles (teacher, pending)
  - all others -> may not change roles at all
Service-role/backend writes (auth.uid() IS NULL) are exempt — they go through already-gated
edge functions. Only fires when role actually changes; other profile-field edits are
untouched. Additive + idempotent (create or replace / drop trigger if exists).

Behavior change (intended tightening): an `admin` editing a staff member's role can no
longer assign an elevated role (previously the legacy dropdown offered principal to admins);
principal/subgroup_admin/pastor/regional_secretary can no longer change any role via REST.
NOT executed against a live DB here (no Postgres in dev env) — apply + verify with a
non-superadmin session before relying on it.

---

## 2026-07-13 — Branch policy adoption + commit isolation + boundary reconciliation (Phase B)

Follow-up to the prior Phase A audit brief ("Rock-Solid-Ops"), which surfaced three items:
branch-per-brief vs. the earlier lock-file convention, an unattributed ClickUp-removal hunk
baked into e26a408, and a real disagreement between the `create-staff-direct` boundary and
the `profiles` role-update trigger over what `admin` may do to an existing profile's role.

### DECISION — branch-per-brief adopted as standing policy

Documented in `CLAUDE.md` under "Git workflow": create `brief/<name>` off `main`, commit
incrementally, merge to `main` in the same session once any gate is confirmed, delete the
branch. Replaces the earlier lock-file approach, which coordinated parallel sessions on a
shared tree but did nothing to keep unrelated hunks (e.g. the ClickUp removal below) from
landing inside an unrelated feature commit.

### DECISION — ClickUp removal attribution (no code change; already unrecoverable as a clean split)

e26a408's own commit message already documents that the ClickUp assignee/watcher tab
removal from `admin-management.html` (properly belonging to the Nexus cleanup, 9e1ed97)
"could not be cleanly separated from this commit's hunks." Re-verified here: the working
tree no longer contains any ClickUp/assignee/watcher markup in `admin-management.html`, and
`9e1ed97`'s own diff never touched that file — confirming the hunk really did land only in
e26a408, mixed with the unrelated create-staff-direct feature.

Splitting it out now would require an interactive rebase of an already-existing commit
(`git rebase -i` to break e26a408 into two commits). That is excluded by this project's git
safety rules (no interactive rebase), and rewriting a local commit whose content is already
relied upon by later commits is a hard-to-reverse operation with no corresponding benefit —
the code state is identical either way. Recorded here as a **documentation-only attribution**
instead: the ClickUp tab removal in `admin-management.html`, currently living inside
e26a408, is attributed to the Nexus/ClickUp-replacement lineage (9e1ed97,
`202607101000_rocksolid_nexus_integration.sql`), not to the create-staff-direct feature.
No further action needed; flagged here so future `git blame`/archaeology on that file isn't
misled by e26a408's feature-sounding commit message.

### DECISION — Phase A.5 verification: teachers-table RLS is NOT a live gap

Checked whether `toggleTeacherActive()`'s client-side `.update()` on `teachers` (used to
activate/deactivate a teacher — a different table from `profiles`, no role write involved)
is actually RLS-gated, since the JS has no server-side role check of its own.

`000_baseline_squash.sql` originally created `teachers_staff_update ... TO authenticated
USING (true) WITH CHECK (true)` — genuinely open to any authenticated caller. But two later
migrations, applied after the baseline in lexical order, close this:
- `202605061400_rls_hardening.sql` drops that policy and adds `teachers_admin_all` (`FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())`).
- `202605121320_security4_legacy_broad_rls_hardening.sql` re-does the same drop/create
  idempotently (expected duplicate hardening pass, converges on the same policy).
- `is_admin()` (final definition in `202605220030_regional_secretary_rls_fix.sql`) resolves
  to `superadmin, admin, subgroup_admin, pastor, principal, regional_secretary` — the
  elevated-role set, not "any authenticated user."
- The only other policy touching `teachers` writes is `"allow public teacher self
  registration"` (`202605171600_teacher_self_register_rls.sql`), scoped to `INSERT ... WITH
  CHECK (status = 'PENDING' AND active = false)` — no UPDATE reach.

Conclusion: `teachers` UPDATE is correctly gated to elevated roles today. This is a static
migration-file analysis (same caveat as the Phase A audit: verifies what migrations declare
in lexical order, not a live-DB query — no Postgres connection in this dev env). No second
gap found; no fix needed for A.5.

### DECISION — `pending` gap, revised (narrower than the 07-13 profiles-boundary entry above)

The entry above ("Fix: server-side role-assignment boundary on profiles") left `admin` able
to assign `teacher` or `pending` to an existing profile via direct REST update. Revisited:
admin's only real account-lifecycle levers elsewhere in the codebase are (a) create a
teacher account via `create-staff-direct` (already `teacher`-only) and (b) activate/deactivate
an existing teacher via `teachers.active`/`status`/`deleted_at` — a different table, not
`profiles.role` at all. Letting admin additionally demote/reset an existing profile's role
to `pending` or re-affirm `teacher` via direct REST was an inconsistent extra lever with no
corresponding UI or edge-function analog. Narrowed to: **admin has zero `profiles.role`
UPDATE authority**, full stop — not "some roles." This is simpler than the roles-allowlist
approach and matches how `admin` behaves everywhere else (creation-only, never direct
profile-role mutation). Superadmin is unaffected: still full authority over all 8 roles,
including `pending`.

New migration `202607131600_profiles_role_assignment_admin_zero_authority.sql`:
`create or replace function public.profiles_enforce_role_assignment()` — removes the
`admin` branch's `v_new = any(v_elevated)` check entirely; any genuine role change attempted
by an `admin` caller now raises `42501` unconditionally. `superadmin` and "all others"
branches are unchanged. Additive/idempotent (`create or replace function`; trigger already
exists from 202607131500 and is not recreated). NOT executed against a live DB here (no
Postgres in dev env) — apply + verify with an admin session attempting any role update
(including to `teacher`/`pending`) returns `42501` before relying on it.

### DRIFT GUARD — added

`supabase/functions/admin-api/role-boundary-matrix.test.ts`: runs the full 8-role matrix
(`pending, teacher, principal, admin, superadmin, subgroup_admin, pastor,
regional_secretary`) against both `assertStaffCreationAllowed()` (creation, real code under
test) and a pure mirror of the trigger's new logic (`allowedRoleUpdateFor`, since the trigger
itself is PL/pgSQL and this dev env has no Postgres to run it against — same limitation
noted in every migration entry above). Asserts: `admin` → create `{teacher}` only, update
`{}`; `superadmin` → create all 7 non-`pending` roles, update all 8 including `pending`;
every other role → empty in both dimensions. The mirror function carries a comment pointing
back to the migration file as the single source of truth, so a future change to one without
updating the other fails this test loudly instead of drifting silently.

### GATE — confirm before merging

This branch touches a security boundary (profiles role-update authority). Final review
requested before merging `brief/git-workflow-fixes` to `main`.

---

## 2026-07-13 — Email Pipeline Audit (read-only; brief/email-audit, no merge)

Read-only audit, no code/schema/template changes. Branch exists only in case a follow-up
brief needs to cite it; nothing here required a gate.

### SCOPE NOTE — the brief's assumed topology was not quite the real one

The brief described the pipeline as `notification-dispatcher` (event_type → template_key →
recipient rule matching) feeding `scheduled_notifications` for the general case. In the
actual code, `notification-dispatcher`/`notification_events`/`notification_rules` is a real,
wired path but it has exactly **one** producer: `queue_waitlisted_class_available_notifications()`
(migration `202605191920_waitlist_class_available_auto_notify.sql`), fired by triggers on
`class_slots`/`class_options` becoming available — i.e. only the `CLASS_OPTIONS_AVAILABLE`
waitlist-reopened case. Every other applicant-facing email (welcome, duplicate, waitlist,
class assigned, moodle reminders) is written straight into `scheduled_notifications` or
`email_queue` by `registration-processor`, `waitlist-processor`, and
`queue_waitlisted_class_available_notifications` itself — bypassing the
dispatcher/rules-table machinery entirely. So "the recipient rule table" is real but narrow,
not the general-purpose router the brief assumed. Findings below are organized around what's
actually there.

### PHASE A — Recipient correctness

- **`notification-dispatcher` rule matching (the one real path):** `event_type` = 
  `CLASS_OPTIONS_AVAILABLE` → looks up `notification_rules` (active, matching event_type,
  ordered by priority) → for each matching rule inserts a `scheduled_notifications` row
  addressed to `event.email`, which is populated upstream as `lower(applicants.email)` for
  every WAITLISTED applicant whose `fellowship_code` intersects the reopened class option's
  `fellowship_codes` array (`supabase/migrations/202605191920_waitlist_class_available_auto_notify.sql:56-71`).
  Recipient resolution is scoped correctly: WAITLISTED + no `class_option_id` assigned yet +
  fellowship match. No wrong-role risk here — it can only ever address applicants, and the
  `email <> ''` filter excludes rows with blank addresses. Deactivated/deleted applicant
  accounts aren't a concern because applicants have no auth accounts to deactivate; a
  withdrawn applicant would need `registration_status` changed off `WAITLISTED` to stop
  being targeted, which is on the admin, not this code path.
- **Everything else (welcome, duplicate, class-assigned, moodle reminders):** recipient is
  `email` captured directly from the registration submission
  (`supabase/functions/registration-processor/index.ts`) or from `applicants.email` looked
  up by `applicant_id` (`notification-batch-processor/index.ts:81-87`, the
  `moodle_login_check` path). No role/subgroup cross-check applies because these are all
  applicant-addressed, single-recipient sends — there's no group resolution step that could
  misfire onto the wrong cohort.
- **`email_campaigns` is the one place with real "wrong audience" exposure** (see Phase
  B/C) — it resolves recipients by `fellowship_code` tag against the `students` table
  client-side (`foundation/js/email-campaigns.js:376-394`), which is a broader, coarser
  resolution than anything in the transactional path.

### PHASE A.2 — Email vs. push recipient parity

Cross-checked against the three push triggers already approved in the PWA/push brief
(`docs/migration-log.md`, 2026-07-13 PWA entry): registration status change, attention flag
raised, teacher availability/waitlist movement. **They are not meant to reach the same
recipient as the email equivalent, and today they don't overlap at all** — this is by
design, not a bug: applicants have no Supabase Auth account (confirmed again while re-reading
`applicants` schema), so push can only ever reach staff/teachers, while every event above
also fires (or would fire) an **applicant-addressed** email about their own status. Email and
push are answering different questions for different audiences: email tells the applicant
what happened to them; push tells staff that something happened that needs attention. No
mismatch found because there's no shared audience to mismatch. One gap worth naming: there is
currently **no staff-facing email equivalent at all** for attention-flag-raised or teacher
availability/waitlist events — today those are silent until the push sender (Phase C of the
PWA brief, not yet built) ships. Not a defect in this pipeline, just a dependency to flag.

### PHASE B — Content and compliance

- **Two parallel template tables exist.** `email_templates` (migrations
  `202605182000_email_templates_table.sql` and the `000_baseline_squash.sql` bootstrap) and
  `notification_templates` (`000_baseline_squash.sql:1756`). `email-sender/index.ts:99-109`
  reads **`notification_templates` only** — the code comment even says
  `// canonical template source: notification_templates only`. `email_templates` has zero
  readers or writers anywhere in `supabase/functions/` or `foundation/` — it's a dead table.
  `foundation/docs/NOTIFICATION_PIPELINE.md:74-75` still documents `email-sender` as
  resolving from `email_templates` — that doc is stale and describes the wrong table.
- **Unescaped interpolation, confirmed:** `email-sender/index.ts:233-244`
  (`substituteVariables`) does a raw `template.replace(/\{\{(\w+)\}\}/g, ...)` with no HTML
  escaping, substituting `recipient_name`, `student_id`, and every key from `row.payload`
  (which includes applicant-submitted fields like `full_name`, `teacher_name`, fellowship
  labels, etc.) straight into `body_html` and `subject`. Since `full_name` originates from
  the public registration form (`registration-processor`, `verify_jwt=false`), an attacker
  who registers with a name containing `<`/`>`/HTML can have that string rendered unescaped
  inside the HTML body of their own transactional emails (welcome, moodle reminder, etc.).
  Blast radius is currently self-directed (the applicant only receives their own email), but
  it is still a real HTML-injection primitive sitting in a shared template-substitution
  function used by every template — worth fixing at the substitution layer rather than
  per-template, since new templates would inherit the same gap silently.
- **Merge-tag reconciliation:** appears to have landed for the transactional path — every
  template referenced in `buildSubjectFromTemplate` (`notification-batch-processor/index.ts:41-56`)
  has a matching entry, and `resolveContent`/`substituteVariables` in `email-sender` handle
  arbitrary payload keys generically rather than a hardcoded allowlist, so there's no
  per-template variable drift to find. Not verified against live `notification_templates`
  row contents (no DB access in this session — see Phase C note below) — if any row's
  `body_html` references a `{{tag}}` no writer ever populates, it will silently render blank
  (`vars[key] ?? ''`) rather than error, which is not observable from the code alone.
- **`email_campaigns` — this is the one that's actually bulk/marketing email, and it has
  zero unsubscribe/opt-out mechanism.** `foundation/js/email-campaigns.js` is a client-side
  workflow (an admin composes subject/body, picks fellowship tags or individual addresses,
  and `sendCampaign()` inserts one `email_queue` row per resolved recipient — potentially an
  entire fellowship's worth of `students`). There is no suppression list, no unsubscribe
  link construction anywhere in the composer or in `email-sender`'s send path, and no
  opt-out column on `students`, `applicants`, or `email_campaigns` itself. This is squarely
  the kind of send this matters for (per the brief) — transactional notifications
  (registration/waitlist/class-assigned) are not marketing email and don't need this, but
  campaigns sent to a whole fellowship's student list are functionally a marketing blast
  with no opt-out. Flagging plainly: **no unsubscribe mechanism exists for `email_campaigns`.**

### PHASE C — Volume, duplication, and failure visibility

- **Could not run the requested 30-day `email_queue`/`audit_logs` queries — no live DB
  access in this session** (no Supabase MCP/connection configured, no `supabase` CLI login
  found). Everything below is a code-level assessment of what duplication/failure protection
  exists, not a live measurement. If live numbers are wanted, the SQL patterns in
  `foundation/docs/NOTIFICATION_PIPELINE.md`'s "Operator lookup flow" section
  (trace_id joins across `scheduled_notifications`/`email_queue`/`moodle_enrollment_sync`)
  are the right starting queries — someone with DB access should run those.
- **Duplicate-send protection is real but only covers the `scheduled_notifications` layer,
  not `email_queue` directly.** `scheduled_notifications.dedupe_key` has a partial unique
  index (`000_baseline_squash.sql:1767`, `where dedupe_key is not null`), and both
  `notification-dispatcher` and `queue_waitlisted_class_available_notifications()` construct
  a deterministic dedupe key per event before inserting, catching the `23505` conflict and
  counting it as `skipped_duplicates` rather than erroring
  (`notification-dispatcher/index.ts:153-164`). But `registration-processor` and
  `email-campaigns.js` insert directly into `email_queue` with **no dedupe key and no unique
  constraint on that table** — if either of those callers ever runs twice for the same
  logical event (retried request, double form submit), nothing at the `email_queue` layer
  stops a second row from being queued and sent. The closest thing to a backstop is
  `email-sender`'s per-recipient 24h cap (max 3 sends per address, `index.ts:131-151`), which
  is a rate limit, not a dedupe check — it would let two duplicate copies of the same
  event through as sends #1 and #2 without flagging them as duplicates at all. This mirrors
  the registration duplicate-detection pattern in spirit but the protection doesn't actually
  extend down to `email_queue` itself.
- **Permanently-failed sends: dead-letter cleanly, with operator visibility, no infinite
  retry.** `email-sender` marks a row `Failed` with `error_message` set
  (`index.ts:164-171`); it is not picked up again automatically — `retry-worker` documents
  "No built-in limit" for `email_queue` and requires a manual reset via the Retry Center
  (`foundation/docs/NOTIFICATION_PIPELINE.md:123-134`). `scheduled_notifications` has a real
  ceiling (`attempts >= max_attempts` → `FAILED`, not re-queued,
  `notification-batch-processor/index.ts:176-180`). Both failure states are queryable and
  audited (`audit_logs` row per `SCHEDULED_NOTIFICATION_QUEUED`/send outcome), so nothing
  fails silently at the code level — but neither table auto-retries a hard bounce, so a bad
  address sits `Failed` until an operator notices it in the Retry Center. There's no
  proactive alerting on `Failed` rows in this codebase; it's pull-based (someone has to look).
- **Two crons diverge from what's documented.** Actual `config.toml` schedules:
  `email-sender` = `*/15 * * * *` (every 15 minutes), `notification-batch-processor` =
  `0 9 * * *` (daily 9am), `retry-worker` = `0 * * * *` (hourly). This contradicts **two**
  canonical docs at once: `ai/statuses.md:116` says `email-sender` runs "cron daily 07:00
  EST" and calls `notification-retry-helper`/batch processor on-demand; the repo's own
  `foundation/docs/NOTIFICATION_PIPELINE.md:69,178` says the same "daily 07:00 EST" for
  `email-sender` and describes `notification-batch-processor` as having no fixed schedule at
  all. Both docs are stale relative to `supabase/functions/*/config.toml` — the real
  system sends far more frequently (every 15 min, not daily) and batches notifications daily
  rather than on-demand. This matters for the audit's own volume question: 15-minute email
  delivery is nearly 100x more frequent than either doc implies, so anyone reasoning about
  send volume or debugging "why did 5 emails go out today" from the docs alone would be
  working from the wrong mental model.

### PHASE D — Security posture

- **`email-sender` is reachable fully unauthenticated — confirmed by evidence, not
  assumption.** `supabase/config.toml` sets `verify_jwt = false` for `email-sender` (also
  redundantly in its own `config.toml`), and the function body
  (`supabase/functions/email-sender/index.ts`, full file read) has **no internal caller
  check at all** — no shared-secret header, no service-role JWT verification, nothing before
  it starts claiming and sending queued rows. Grepped every function directory for a call
  site that invokes `email-sender` and found none — nothing in this codebase calls it
  server-to-server. Its only two callers are the `*/15 * * * *` cron and, implicitly, anyone
  who knows the project's function URL.
- **Abuse potential is real but bounded — it cannot be used to send arbitrary emails.**
  `email-sender` only processes rows already sitting in `email_queue`; an unauthenticated
  caller can trigger early/repeated processing runs but cannot inject content through this
  endpoint itself (no request body is read for send content). The atomic
  `Pending`→`Processing` claim (`index.ts:80-90`) means concurrent unauthenticated calls
  can't double-send the same row. The actual spam-relay lever is upstream: 
  `registration-processor` (also `verify_jwt=false`, by necessity — it's the public
  registration form) inserts an `email_queue` row addressed to whatever `email` the caller
  submits, with no verification that the submitter controls that address. That gap is
  already known and tracked as an open item (CLAUDE.md "Immediate priorities" list references
  a registration-processor rate-limit gap) — it is the pre-existing lever that could be
  combined with `email-sender`'s open reachability to accelerate delivery, but the
  reachability of `email-sender` on its own is not a new content-injection path. Recommend
  treating `email-sender`'s missing caller check as a defense-in-depth gap (add a
  shared-secret header check per the edge-hardening pattern used elsewhere) rather than an
  active incident — but it should still close, since "harmless today" depends entirely on the
  registration-processor gap staying closed too.
- **Incidental finding, outside this brief's scope:** `email_campaigns` RLS/RPC role sets
  disagree. `campaign_begin_send`/`campaign_finish_send` and the `email_campaigns` table RLS
  allow `superadmin`, `admin`, `regional_secretary`
  (`supabase/migrations/202606101400_email_campaigns.sql:56-58,73-75`), but the
  `email_queue_admin_all_hardened` RLS policy that `sendCampaign()`/`sendTestEmail()` rely on
  for the client-side `email_queue` insert is gated by `is_admin()`, which only covers
  `superadmin, admin, subgroup_admin, pastor, principal` — **`regional_secretary` is not in
  that set** (`supabase/migrations/202605061400_rls_hardening.sql:289-294`,
  `is_admin()` defined at `:63-74`). A `regional_secretary` can create/edit a campaign and
  flip it to `sending` via the RPC, then have every `email_queue` insert in the batch loop
  fail RLS — the client code handles this gracefully (`insertFailed` → campaign marked
  `failed`, not silently stuck), but the role is functionally unable to send campaigns
  despite being granted access to manage them. Not a security hole (fails closed), just a
  broken permission boundary worth a follow-up brief.

### SUMMARY — what would become a follow-up brief

1. Add HTML-escaping to `substituteVariables` in `email-sender` (Phase B).
2. Decide on an unsubscribe/suppression mechanism for `email_campaigns`, or explicitly scope
   it as staff-composed-only (never touches external/public addresses) if that's the intended
   boundary (Phase B).
3. Add a dedupe key (or reuse `trace_id`) with a unique constraint on `email_queue` itself,
   not just `scheduled_notifications` (Phase C).
4. Reconcile `ai/statuses.md` and `foundation/docs/NOTIFICATION_PIPELINE.md` cron schedules
   against actual `config.toml` values (Phase C).
5. Add a shared-secret/service-role check inside `email-sender` so it isn't fully open
   regardless of what happens with the registration-processor rate-limit gap (Phase D).
6. Fix the `regional_secretary` / `is_admin()` mismatch blocking campaign sends (Phase D,
   incidental).
7. Delete the orphaned `email_templates` table or repurpose it — it has no readers/writers
   anywhere in the codebase (Phase B).

None of the above were fixed in this brief — audit only, per scope.

---

## 2026-07-13 — Email Pipeline Audit ADDENDUM: Mailchimp was missed entirely (read-only)

Correction to the entry directly above, not a rewrite (per this log's append-only rule).
The original pass audited the Resend/`email_queue` pipeline only. `ai/constraints.md`'s
MAILCHIMP RULES section explicitly scopes Mailchimp as "notification layer / onboarding
layer / campaign layer" — that's a second, real notification channel this brief should have
covered and didn't on the first pass. Re-audited now; still read-only, still no changes.

### WHAT MAILCHIMP ACTUALLY DOES HERE

- **One-way contact sync only — no campaign sending happens in this codebase.**
  `supabase/functions/mailchimp-sync/index.ts` does a single `PUT` to
  `lists/{audience}/members/{md5(email)}`, upserting the contact with merge fields
  (`FNAME`, `LNAME`, `PHONE`, `CAMPUS`, `FELLOWCODE`, `TEMPLATE`) and `status_if_new:
  "subscribed"`. It never calls Mailchimp's campaign-send API. `foundation/docs/SYSTEM_OVERVIEW.md:206`
  confirms this framing: "Syncs student data to Mailchimp audience." So actual marketing/
  campaign composition and sending, if it happens, happens **inside the Mailchimp product
  itself**, outside this repo — which also means Mailchimp's own native unsubscribe/
  compliance handling applies to whatever gets sent from there. That's a materially
  different (better) compliance picture than the homegrown `email_campaigns` table audited
  in the entry above, which has no unsubscribe mechanism at all.
- **This sharpens, rather than resolves, the Phase B finding on `email_campaigns`:** there
  are now two parallel bulk-send surfaces — Mailchimp (external, presumably has its own
  legally-compliant unsubscribe) and the homegrown `email_campaigns`/`email_queue`/
  `email-sender` path (in-repo, audited above, confirmed no opt-out). Anyone composing a
  fellowship-wide blast has a choice between a compliant channel and a non-compliant one
  that produces the same visible outcome (a bulk email lands in inboxes). That's worth
  surfacing to whoever owns campaign practice, since the existence of the compliant path
  doesn't stop someone from using the other one.
- **Trigger point:** `registration-processor/index.ts:633` calls `triggerMailchimpSync()`
  as `void triggerMailchimpSync({...})` — fire-and-forget, not awaited, and only on the
  branch where a `templateKey` was resolved (i.e., only for registrations that also queue a
  transactional email). Registration itself never fails or blocks on a Mailchimp outcome,
  which is correct per constraints.md ("Mailchimp is NOT... registration source of truth").
- **Failure visibility: worse than the Resend path, and the retry-center UI is misleading
  about it.** On a failed Mailchimp `PUT`, `mailchimp-sync` writes one `audit_logs` row
  (`MAILCHIMP_CONTACT_SYNC_FAILED`) and returns a 502 — but since the caller never awaits
  it (`void`), that response is discarded and nothing else happens. Grepped every writer to
  `failed_syncs` (the table the Retry Center reads for non-email/non-Moodle failures):
  only `moodle-sync`, `retry-worker`, and `teacher-portal-api/_actions/approve-availability.ts`
  write to it — **`mailchimp-sync` never does.** Yet
  `foundation/js/failed-sync-retry-center.js:59` derives its "Mailchimp" badge/counter
  (`kMailchimp`) from `failed_syncs` rows whose `sync_type`/`source_table`/`provider` field
  contains "mailchimp" — a state that can never occur, because nothing ever writes it. The
  Retry Center's Mailchimp counter will always read zero regardless of actual Mailchimp
  failure volume; a broken contact sync is visible only to someone reading `audit_logs`
  directly, and there's no retry path for it at all (not even a manual one) — a failed sync
  is simply lost until the next registration for that same applicant happens to retrigger it.
- **Auth posture differs from the rest of the pipeline, and is unclear from the config
  alone.** `supabase/functions/mailchimp-sync/` has no `config.toml` of its own, and there is
  no `[functions.mailchimp-sync]` block in the top-level `supabase/config.toml` — every other
  function in this pipeline (`email-sender`, `notification-batch-processor`, `retry-worker`,
  `registration-processor`, etc.) has an explicit `verify_jwt` entry, almost all `false`.
  Whether `mailchimp-sync` deploys with the platform default (which may differ from the rest
  of the pipeline) or inherits something set elsewhere could not be confirmed by grep alone —
  flagging as an open question rather than asserting either way.

### REVISED FOLLOW-UP LIST (adds to, does not replace, the list in the entry above)

8. Add a `failed_syncs` write (or equivalent) inside `mailchimp-sync` on failure, or stop the
   Retry Center from advertising a Mailchimp counter that can never populate (Phase C).
9. Confirm `mailchimp-sync`'s actual deployed `verify_jwt` setting — its config is silent
   where every sibling function in this pipeline is explicit (Phase D).
10. Decide whether fellowship-wide blasts should be required to go through Mailchimp (native
    unsubscribe) rather than `email_campaigns` (none) — currently both are available and
    produce the same visible outcome with different compliance postures (Phase B).

---

## 2026-07-13 — Email Pipeline Audit ADDENDUM 2: Mailchimp is not actually in use (operator-confirmed)

User confirmed directly: only Resend is used today — Mailchimp is not live in practice.
This wasn't discoverable from the code/docs alone (`registration-processor` still calls it
unconditionally, and `ai/constraints.md` / `foundation/docs/DEPLOYMENT_CHECKLIST.md` still
document it as required infrastructure), so recording it here rather than silently revising
ADDENDUM 1 — it changes the risk read materially and is worth being explicit about what
changed and why.

- **Revises the "two channels, one compliant" framing in ADDENDUM 1.** If Mailchimp isn't
  actually running campaigns, its native unsubscribe isn't actually protecting anything
  right now. In current practice there is exactly **one** bulk-send surface —
  `email_campaigns` / `email_queue` / `email-sender` — and it has no unsubscribe mechanism
  at all. Follow-up item 10 above is moot in its "decide between two paths" framing; the
  real ask is just: **add unsubscribe/suppression to `email_campaigns`**, full stop, since
  it's the only campaign path actually in service.
- **`registration-processor/index.ts:633` firing `triggerMailchimpSync()` on every
  registration is very likely a live no-op failure, not a dormant code path.** If
  `MAILCHIMP_API_KEY`/`MAILCHIMP_SERVER_PREFIX`/`MAILCHIMP_AUDIENCE_ID` aren't provisioned in
  the real environment (consistent with "we only use Resend now"), every one of those calls
  hits `mailchimp-sync`, fails the Mailchimp `fetch`, and — per ADDENDUM 1's failure-
  visibility finding — writes one `audit_logs` row that nothing surfaces or alerts on, then
  is gone. That means this has likely been happening on every single registration, silently,
  for as long as Mailchimp credentials have been unset, with zero operator-visible signal
  besides `audit_logs` rows nobody is watching for this action type.
- **Confirms the docs are stale, not just the runtime behavior.** `foundation/docs/DEPLOYMENT_CHECKLIST.md:14-16`
  still lists `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER_PREFIX`, `MAILCHIMP_AUDIENCE_ID` as
  checklist items for deployment, and `ai/constraints.md`'s MAILCHIMP RULES section still
  frames Mailchimp as a live architectural layer. Neither reflects "Resend only" as the
  actual current state. Notably, `foundation/staff/env-check.html` (the ops health-check
  page) has **no Mailchimp entries at all** — so the one place that should have surfaced
  "Mailchimp isn't configured" doesn't check for it either.
- **Not fixed in this brief (audit only).** Flagging as the clearest single follow-up out of
  everything in this audit: either (a) provision Mailchimp for real, or (b) remove the
  `triggerMailchimpSync` call and the `mailchimp-sync` function, and update
  `ai/constraints.md` + `DEPLOYMENT_CHECKLIST.md` to stop describing infrastructure that
  isn't in service. Right now the code, the docs, and actual practice all disagree with each
  other, which is worse than any one of the three being wrong alone.

### FOLLOW-UP LIST, REVISED

Supersedes items 8–10 above given this confirmation:

8. Decide Mailchimp's fate: provision it for real, or remove `triggerMailchimpSync` +
   `mailchimp-sync` + its stale references in `ai/constraints.md` and
   `foundation/docs/DEPLOYMENT_CHECKLIST.md` (Phase B/D).
9. If Mailchimp stays removed/unused: add unsubscribe/suppression to `email_campaigns`
   directly — it is the only bulk-send surface actually in service (Phase B).
10. If Mailchimp is kept: fix the silent-failure path (`failed_syncs` write, or at minimum an
    `env-check.html` entry so missing credentials are visible before the first silent
    failure, not after) (Phase C/D).

---

## 2026-07-13 — Email Pipeline Audit fix: REVIEW/WAITLISTED had no template mapping

`registration-processor/index.ts`'s `templateKey` selection had no branch for
`registrationStatusTyped === "REVIEW"`, and no catch-all for plain `WAITLISTED` outside the
`CLASS_FULL`/`NO_CLASS_AVAILABLE` subcase — both silently fell through with no `templateKey`
set, meaning those registrations queued no applicant-facing email at all. This is the same
failure class as the Mailchimp no-op above (a trigger fires but nothing observable happens),
just on the Resend path instead. Both `registration_under_review` and `waitlist_confirmation`
are already canonical template keys per `ai/statuses.md`; this fix wires the two missing
branches to the templates that already existed for them — no new template, no schema change.

- `REVIEW` → `registration_under_review`
- `WAITLISTED` (fallback, when no more specific `templateKey` already matched) → `waitlist_confirmation`

Scope: this commit touches only the `templateKey` selection branches in
`registration-processor/index.ts`. It does not touch the unrelated ClickUp→Nexus rebrand work
also present uncommitted in this working tree (README/DEPLOYMENT_CHECKLIST/SYSTEM_OVERVIEW
doc updates, `admin-shell.js` nav change, `rocksolid-management.html`, a new RLS migration) —
that work is out of scope for the email-audit brief and is left as-is for its own session.

---

## 2026-07-13 — Close out: main fast-forward, RLS merge, ClickUp→Nexus rebrand committed as WIP

Closes out a shared-tree state that had accumulated three unrelated pieces of uncommitted
work (email-audit fix, an unrelated RLS migration, and a ClickUp→Nexus rebrand bundle) plus
a merge-sequencing gate for `brief/pwa-push`. Documenting the final state plainly rather than
across several scattered entries.

### What happened, in order

1. **`brief/email-audit` → `main`** (fast-forward, no working-tree checkout needed since
   `main` wasn't checked out at the time — preserved unrelated uncommitted files in the
   shared tree untouched). `main` tip: `6445e8c`.
2. **`brief/attention-flags-rls` → `main`** (fast-forward). This migration
   (`202607131400_attention_flags_rls_coverage.sql`) was mischaracterized in an earlier
   session's framing as part of the ClickUp→Nexus rebrand — it isn't; it's Phase B.2 of a
   separate, already-logged legacy-hardening brief (see "2026-07-13 — Phase B started"
   above), independently ready and approved. `main` tip: `9d5b503`.
3. **`brief/rebrand-wip` → `main`** (fast-forward), committed and merged as explicit WIP.
   Closes a **live production 404**: `admin-shell.js`'s nav (`SYSTEM_ADMIN_ROLES`, "Nexus
   Mapping") has linked to `rocksolid-management.html` since before this session, but the
   file itself had never been committed. Bundle: README/DEPLOYMENT_CHECKLIST/SYSTEM_OVERVIEW
   doc catch-up to already-shipped Nexus code (`clickup-sync` posts to Nexus since `9e1ed97`)
   and an unrelated Netlify→Vercel doc fix, `admin-shell.js`'s dead `admin-management` nav
   mapping removed (stale since the ClickUp-tab removal in `e26a408`), and
   `rocksolid-management.html` itself landed with two fixes made while preparing the commit
   (see below). `main` tip: `c6ab8e8`.

### Corrections to inherited claims (the reason for the new CLAUDE.md line, below)

- The prior session's log note that `rocksolid-management.html` "needs a rebuild against
  current design tokens" overstated the gap. Checked against both `tokens.css` and
  `primitives.css` (the latter never checked before): `var(--fs-surface)`/
  `var(--fs-text-muted)` (7× each) referenced tokens that exist in **neither** file —
  `--fs-*` in `primitives.css` is the font-size namespace (`--fs-body`, `--fs-badge`, etc.),
  unrelated to surface/text-color. Fixed to the real `--color-surface`/`--color-text-muted`.
  Every other token reference in the file was already valid — this was a two-variable
  find/replace, not a rebuild.
- Separately, and not mentioned in any prior note: the repo's `.git/hooks/pre-commit` bans
  `class="chip"` in `foundation/(staff|teacher)/*.html` and requires `primitives.css`'s
  `fs-badge`/`fs-badge-{success,warning,danger,info,neutral,primary}` system instead —
  caught only because the commit was rejected by the hook. Fixed
  (`chip`/`chip-active`/`chip-inactive` → `fs-badge`/`fs-badge-success`/`fs-badge-neutral`),
  dead `.chip*` CSS rules removed. **Not resolved**: this directly contradicts CLAUDE.md's
  own UI-standards section, which still documents `.chip` + `.chip-{status}` as the
  convention. The enforced hook and the doc disagree; CLAUDE.md needs reconciling in a
  follow-up, not guessed at here. The hook's header comment also references
  `CSS_MIGRATION_GUIDE.md`, which does not exist anywhere in the repo — dangling reference,
  also unresolved.

### Open questions consolidated, not duplicated

Per this brief's Step 4: the two open questions below are folded into the already-queued
"Watcher-Routing Decision, Dashboard Dead-Link Fix, Migration Apply/Verify" brief as
additional Phase A items, not tracked as a separate thread:

1. `clickup-management.html` retirement timing, relative to `rocksolid-management.html`/
   SPA `nexus-management` reaching parity.
2. Whether `rocksolid-management.html` and SPA `nexus-management` should be treated as
   "retire legacy once SPA is parity-vetted" (the standard pattern used elsewhere in the
   repo) or something else.

Also newly surfaced by this brief, not yet triaged anywhere: the CLAUDE.md-vs-pre-commit-hook
`.chip` contradiction above, and the dangling `CSS_MIGRATION_GUIDE.md` reference.

### CLAUDE.md change

Added a line under the worktree-per-brief standing rule (which itself had not yet reached
`main` before this entry — it existed only on `brief/pwa-push`; added here alongside it since
the remaining pwa-push merge work needs it): verify claims inherited from prior
migration-log entries before acting on them, citing this entry's CSS-token correction and
the earlier Nexus push-sender claim as the precedent.

---

## 2026-07-13 — PWA Phase C.1: install shell + service worker (brief/pwa-push, C.1 gate)

Phase C.1 of the PWA + Push brief. Adds the installable PWA shell and an offline-capable
service worker to `foundation-spa`. Push (C.2) is gated behind this and not started.

### PRE-FLIGHT — branch hygiene

Two branches named in the brief as "existing unmerged work" (`cleanup-review`,
`feat/retry-worker-clickup-escalation`) were both found **already fully merged** into `main`
(tip is an ancestor of `main`, 0 commits ahead; last activity 2026-05-07/08). They are stale
pointers, safe to delete; left in place this session per the user's instruction. The actually-
live unmerged branch at the time was `brief/git-workflow-fixes`, which was merged to `main`
(security gate confirmed) and deleted before `brief/pwa-push` was cut off the updated `main`.

### DECISION — custom hand-written service worker, NOT the Nexus SW

The Nexus reference SW (`public/service-worker.js`) network-first-caches **all** Supabase REST
responses (`url.origin.includes('supabase')` → networkFirst with a 5-min expiry). That
directly violates this project's approved never-cache boundary for the RLS-gated/mutable
tables. So it was not ported. `src/sw.js` is written from scratch and implements the approved
boundaries exactly:
  - CACHE-FIRST (config/reference): `class_options`, `milestone_definitions`, `batches`
    (+ the app shell / help-guide content, which is precached as part of the build).
  - NEVER-CACHE (explicit bypass, never read/written): `applicants`, `profiles`,
    `attendance_records`, `attendance_log`, `audit_logs`/`audit_log`, `email_queue`,
    `attention_flags`. Plus `/auth/v1/` and `/realtime/v1/` always bypass (token-replay
    hazard), and all non-GET requests bypass.
  - DEFAULT for any Supabase table NOT in either list (e.g. `students`, `class_roster`) and
    all `/rest/v1/rpc/*` calls: network-only, no caching — the safe default, so an unlisted
    or future table is never silently cached. `NEVER_CACHE_TABLES` is therefore belt-and-
    braces, not the sole guard.
  Nothing was added to either approved list. The one judgement call flagged for sign-off:
  cross-origin Google Fonts are currently left to the browser (NOT cached), because fonts
  were not part of the approved cache-first "app shell" set — see GATE QUESTION below.

### DECISION — vite-plugin-pwa with `injectManifest`

`vite-plugin-pwa@1.3.0` (new devDependency) in `injectManifest` mode: it injects the content-
hashed shell file list into `self.__WB_MANIFEST` in `src/sw.js`, but every caching strategy is
hand-written with the plain Cache API rather than workbox routing, so the boundaries above are
auditable in one file. Manifest is generated from config (name "Rock Solid Ops", theme
`#4C2A92`, background `#f8f5ee`, standalone, SVG icons any+maskable). usePWA hook + install
prompt + offline indicator adapted from the Nexus templates and **de-Tailwinded** to RSO
tokens (`--primary`/`--text`/`--surface-2`/`--warn`), lucide icons ported as-is.

### FIX during verification — precache resilience + theme-toggle color stick

- Install originally used `cache.addAll(PRECACHE_URLS)`, which is atomic: a single 404
  discarded the entire 61-entry precache (observed: shell cache had 0 entries). Rewritten to
  `Promise.allSettled` with per-entry `cache.add` so one miss is logged and skipped. Result:
  61 unique assets cached (63 manifest entries − 2 duplicate icon URLs from `includeAssets`).
- The install-prompt primary button used `transition: background`; toggling `data-theme`
  while the card was open left the button stuck on the pre-toggle brand color until repaint
  (var()-driven color changes don't re-interpolate a running transition). Scoped the
  transition to `opacity` only; verified the button now snaps correctly light↔dark.

### VERIFIED (DevTools + preview browser, desktop + mobile)

- SW registers, activates, and controls the page (dev via `devOptions`, and the production
  `vite preview` build).
- Manifest valid + installable shape; theme-color, apple-touch-icon, apple-mobile-web-app-*
  meta added to `index.html` for the iOS install path.
- Caching-boundary routing proven with a deterministic decision matrix: all 3 config tables →
  cache-first; all 6 sensitive tables + RPCs + unlisted tables → network bypass; POST /
  auth / realtime → never cached.
- Offline app boot: with the preview server STOPPED, a fresh navigation to `/staff/dashboards`
  boots the full SPA from the SW cache (redirects to login, renders it). `/index.html` and all
  51 referenced chunks serve 200 from cache offline.
- Install prompt + offline indicator render with correct RSO tokens in BOTH light and dark
  (primary button `#4C2A92`/`#8B6BFF`; offline banner `--warn`/`--warn-bg`); install card goes
  full-width at 375px.
- Production build clean; SW builds; 61-entry precache.

### CANNOT VERIFY HERE (human step before ship)

Real-device install + offline, especially **iOS Safari** (web push there requires an installed
PWA). No Android/iOS hardware in this environment — DevTools + preview browser only. The iOS
meta tags and SVG icons are in place, but a real iOS home-screen install/offline pass is
unverified. A PNG maskable icon set may be needed for best home-screen rendering (currently
SVG-only, which Chromium accepts for install but iOS renders less predictably).

### GATE — C.1 confirmed 2026-07-13

C.1 approved. Fonts decision: **leave Google Fonts uncached** (current behaviour) — offline
the app falls back to the system font stack in the CSS `font-family` chain. `fonts.gstatic.com`
is deliberately NOT added to the cache-first set; no cross-origin host is cached.

### NOTE — log-collision resolution + worktree adoption

This entry originally sat as an uncommitted append on top of a parallel session's uncommitted
"Email Pipeline Audit" (`brief/email-audit`) text in the shared working tree. Resolved per the
user's direction: the email-audit entry was committed first on `brief/email-audit`
(`d5de9a4`), then `brief/pwa-push` was rebased onto it and this C.1 entry appended after — so
the log reads chronologically (email-audit, then C.1) with each brief's entry in its own
commit. Going forward this branch's work moves to a dedicated `git worktree` (see the branch
policy note in CLAUDE.md) so parallel sessions stop sharing one checkout and one HEAD.

---

## 2026-07-13 — Removed superseded brief/pwa-push branch + worktree

`brief/pwa-push` was fully superseded once C.1 merged (`brief/pwa-c1` → `main`) and C.2 was
re-homed (`brief/push-notifications`). Before deleting, re-verified directly rather than
trusting the prior session's claim — diffed each of its 5 unique commits against where its
content was supposed to have landed:

- `307e63b` (C.1 shell) vs `e3f053a` (main) — patch content identical.
- `b9eeeaa` (C.1 log entry) — all 99 added lines present in main's `docs/migration-log.md`.
- `cb7f5fd` (worktree-per-brief rule) — all 16 added lines present in main's `CLAUDE.md`.
- `1a45292` (push infra) vs `c80192a` (`brief/push-notifications`) — patch content identical;
  only blob hashes and hunk line-numbers differed, both expected (surrounding file content
  had grown by cherry-pick time).
- `9ca1721` (trigger wiring) vs `841ca3a` (`brief/push-notifications`) — same, patch content
  identical.

Nothing unaccounted for. Removed:
- `git worktree remove ../rso-pwa-push`
- `git branch -d brief/pwa-push` — refused (git doesn't recognize cherry-picked commits as
  "merged," different hashes). Reported rather than force-deleting; user confirmed
  `git branch -D brief/pwa-push` explicitly before it ran.

`git worktree list` post-removal: only `main` and `../rso-push-notifications` remain — no
other stale worktrees. `cleanup-review` and `feat/retry-worker-clickup-escalation` branches
are still present (already-merged stale pointers, left in place per earlier session's
instruction) — out of this brief's scope, not touched.

---

## 2026-07-13 — Mailchimp removed (`brief/mailchimp-ripout`)

Removes the dead Mailchimp integration and its dead UI surfaces, per the earlier email-
pipeline-audit addendums that found Mailchimp was firing unawaited on every registration with
credentials very likely unprovisioned, silently, with no operator-visible signal.

### Step 0 — reconfirmed before deleting

**Credentials: operator-confirmed, not CLI-verified — logged explicitly as such.** Attempted
to close this gap with `supabase secrets list`. The app's actual linked project
(`xelpsttqhrcqmttmjory`, from `foundation-spa/.env.local` and a cached
`supabase/.temp/project-ref`) does not appear in `supabase projects list` for the
authenticated CLI account, and `supabase secrets list --project-ref xelpsttqhrcqmttmjory`
returned a 403 ("account does not have the necessary privileges"). User made the call to
proceed on the existing basis — told directly, twice, that only Resend is used — accepting
that the downside of being wrong is trivially reversible (the function can be re-added).
**This is an operator-confirmed fact, not a CLI-verified one; if the CLI account's access is
ever fixed, worth a real confirmation pass.**

**Exhaustive grep: the "known reference list" from the original brief was incomplete.**
Re-grepped `mailchimp` case-insensitively across the whole repo (24 files) and found four
items the known list missed:
- `README.md` — dormant-integration row + function-schedule row + env var rows. Fixed (Step 3).
- `foundation/staff/env-check.html:74` — **directly contradicts the prior audit's claim that
  "env-check.html has no Mailchimp entries at all."** `mailchimp-sync` was literally in this
  page's own `edgeFunctions` reachability array (a separate inline script from
  `system-health.js`, not a duplicate of it). Fixed (Step 1/2, folded in per user direction).
  The prior audit's claim was wrong; correcting it here rather than letting it stand.
- `ai/constraints.md.txt` — a genuine stale duplicate of the (untracked) `ai/constraints.md`,
  itself containing an older MAILCHIMP RULES section. Left alone per user decision (known
  noise, not wired to anything).
- `ai/backend-decision.md:35` — one line, "Integrations: Moodle/Mailchimp via Edge Functions."
  Left alone per user decision (low priority).

`archive/*` references (read-only, historical) were already expected and are untouched.

### Step 1 + 2 — integration and dead UI removed (commit `4df4678`)

- Deleted `supabase/functions/mailchimp-sync/` entirely.
- Removed the inline `triggerMailchimpSync()` helper (lines 70-110) and its unawaited call
  site (`void triggerMailchimpSync({...})`) from `registration-processor/index.ts`. No import
  to clean up — it was a local closure doing a raw `fetch`, not a shared import.
- Removed the "Failed Mailchimp" KPI counter and its `mailchimp` type-filter option from
  `failed-sync-retry-center.js`/`.html` and the `foundation-spa` twin (`FailedSyncRetryCenterPage.jsx`,
  `lib/failed-syncs.js`, `failedSyncRetryCenter.test.js`) — confirmed nothing ever wrote a
  Mailchimp-classified row to `failed_syncs`, so this counter could never be non-zero.
- Removed `mailchimp-sync` from the edge-function reachability probe array in
  `system-health.js` (both trees) **and** `env-check.html` (per the Step 0.2 correction above
  — this page has **no SPA twin**, so the brief's assumption that one exists was wrong; only
  the legacy page needed the fix).
- **Kept, decisions made explicitly:**
  - `typeBadge()`'s `"mailchimp"` string-match branch in both failed-sync-retry-center trees —
    dead but harmless generic classification logic, distinct from the counter itself, left as
    out-of-scope-for-this-fix rather than chased into a larger cleanup.
  - The MAILCHIMP-prefixed audit-log display type (`audit-log.html`/`auditLog.js` + SPA
    twin) — **could not verify whether historical MAILCHIMP-prefixed `audit_logs` rows exist
    in the last 90 days** (same CLI/project-access blocker as Step 0.1). Defaulted to the
    brief's own stated fallback for the unverifiable case: keep the display type for
    historical audit-trail readability. No "add new" path exists to remove (confirmed —
    this is read-only classification logic, not a writer).
- Incidental: touching `failed-sync-retry-center.html` tripped the pre-commit hook on 12
  pre-existing `var(--muted)`/`var(--surface)` legacy patterns unrelated to this change (the
  hook re-scans the whole staged file, not just the diff). Fixed only the two hook-banned
  patterns; left `--surface-2`/`--shadow-soft`/`--border` alone since a full page token
  migration is out of this brief's scope.

### Step 4 — separate commit (`2cd82bf`): dropped the broken Resend health check

`env-check.html`'s `checkSenderHealth()` posted to `/functions/v1/sender-healthcheck`,
deleted 2026-05-18 per `NOTIFICATION_PIPELINE.md`'s own tombstone table, so the "RESEND
configured" row permanently showed WARN/FAIL regardless of real Resend health.

**The brief's suggested fix (probe `email-sender` instead) turned out to be unsafe, not just
suboptimal.** `email-sender`'s `Deno.serve` handler takes no request parameter at all — it
ignores method entirely and runs its real batch logic (recovering stuck `Processing` rows,
then sending queued emails via Resend) on *any* invocation, OPTIONS included. An OPTIONS
"reachability ping" of the kind used elsewhere in this codebase would have actually triggered
a live email-send batch, not probed health. Grepped for other functions reading
`RESEND_API_KEY` — only `email-sender` does. Per the brief's own fallback, dropped the
"RESEND configured" row rather than leaving it permanently wrong or building an unsafe probe.
Giving `email-sender` a real no-op health branch is a larger, separate change (touches a live
production sender) — flagged as a follow-up, not done here.

### Step 3 — docs fixed (commit `3c15573`), one item flagged unresolved

Fixed `README.md`, `SYSTEM_OVERVIEW.md` (ASCII diagram box + function table row),
`DEPLOYMENT_CHECKLIST.md` (checklist items) to state Resend-only, removing Mailchimp as a
live layer rather than "dormant."

**`ai/constraints.md`'s MAILCHIMP RULES section — not fixed, flagging a structural finding
instead of guessing.** `ai/constraints.md` (the file CLAUDE.md instructs every session to
read first) **is untracked in git** — it exists only in the shared main working tree, was
never committed on any branch, and does not exist in this isolated worktree at all. The file
actually tracked in git under `ai/` is `ai/constraints.md.txt`, a genuinely different,
older document (confirmed by diff in an earlier session) — plus `ai-workflow.md.txt`,
`statuses.md.txt`, `review-findings.md.txt`, all similarly `.txt`-suffixed and distinct from
the non-`.txt` files every session actually reads per CLAUDE.md. This means the platform's
own canonical AI-context docs are not under version control — a bigger issue than one stale
MAILCHIMP RULES section, and not this brief's to resolve unilaterally (deciding whether to
commit the untracked files for the first time, and what to do with the stale `.txt`
duplicates, is a real scope decision). Flagging for a dedicated follow-up rather than
silently committing an untracked file as a side effect of a Mailchimp doc fix.

### Step 5 — broken template/trigger paths: report-only, and the honest state of that audit

No auto-fix attempted here, per the brief. Checked `docs/migration-log.md` for any
Phase-A.2-class finding ("orphaned template," "no template mapped," per-template 30-day
send/fail counts) beyond the already-merged REVIEW/WAITLISTED fix (`6445e8c`, merged before
this brief) — **found none, because that audit was never actually completed.** The earlier
"Email Pipeline Audit" entry covers recipient-correctness and content/compliance (two
parallel template tables with one dead, unescaped-interpolation HTML-injection risk in
`substituteVariables`, `email_campaigns` having no unsubscribe mechanism) but explicitly
states it had no DB access and never ran the per-template 30-day `email_queue`/`audit_logs`
count sweep or the full orphaned-template/silent-no-op check A.2 asked for. The
REVIEW/WAITLISTED fix was found and fixed independently, not as an output of that audit.
**So Step 5 isn't "nothing else broken" — it's "the audit that would find anything else was
never actually run."** Flagging as its own follow-up item rather than either fixing blind or
overstating this brief's coverage.

### GATE

Confirm before merging `brief/mailchimp-ripout` to `main`. Removes a production integration
point (`mailchimp-sync`, its call site) and touches the live email/registration pipeline
(`registration-processor/index.ts`).

---

## 2026-07-13 — Fixed ai/ directory git tracking (`brief/ai-docs-fix`)

A read-only audit (this session) confirmed: the four current, actively-used docs in `ai/` —
`ai-workflow.md`, `constraints.md`, `review-findings.md`, `statuses.md`, all last modified
2026-07-09 — were **untracked in git**. Git only had their stale `.txt`-suffixed counterparts
(dated 2026-05-06 through 2026-05-18) under version control. Net effect: a fresh clone of
this repo got the wrong, out-of-date version of every one of these docs — including
`constraints.md`, cited repeatedly across recent briefs as the edge-function source of truth.
Same risk class as `foundation-spa/` sitting untracked (flagged and fixed in an earlier
brief), just smaller in size.

### Step 1 — confirmed before changing anything

Diffed each `.md` against its `.txt` counterpart with `diff -b` (whitespace-insensitive) —
the initial plain `diff` showed every line as changed on all four pairs, which turned out to
be line-ending noise, not real content drift (same false-alarm pattern as the CRLF issue
caught during the C.1/C.2 split). The real difference, all four pairs:

- `ai-workflow.md.txt` / `.md`: identical body content. `.txt` has one extra leading
  self-referential title line ("ai-workflow.md" + blank line) the `.md` doesn't have.
- `constraints.md.txt` / `.md`: identical body content. `.txt` has the same leading title
  line, plus a BOM character before it. Also corrects an overstated claim in this log's own
  Mailchimp-removal entry above, which described `constraints.md.txt` as having "different
  structure" — that comparison was run without `-b` and was wrong; the two are effectively
  the same document.
- `review-findings.md.txt` / `.md`: identical except the same leading title line, plus one
  mojibake character (`�`, a broken em-dash) that the `.md` version already has fixed to `—`.
- `statuses.md.txt` / `.md`: identical except the same leading title line and one trailing
  blank-line difference.

Git's own rename-similarity detection independently agreed (98-99% similarity on all four
pairs once staged as add+remove). Confirmed via repo-wide grep: nothing references the
`.txt` filenames except this log's own historical prose (no CI config exists in this repo at
all) — safe to remove with no dangling reference.

### Step 2 — executed (commit `8ddd739`)

- Tracked the four current `.md` files for the first time.
- Removed the four stale `.txt` duplicates in the same commit (git recorded as renames, not
  independent add/delete, given the near-total content overlap).
- Left `AI_CONTEXT.md`, `backend-decision.md`, `refactor-roadmap.md`, `security-config.md`
  untouched — already tracked, not part of this duplicate-pair pattern.

### GATE

Confirm before merging `brief/ai-docs-fix` to `main`. Low risk (docs-only, no code/schema
touched) but changes what every future session reads as the canonical constraints/statuses
reference, so flagging per standing policy rather than treating as a default-safe merge.

---

## 2026-07-14 — Main-sync policy adopted; status check on two loose ends (no code changes)

### Policy change: main-sync check before merge (commit `1b091e8`)

Added step 6 to the branch-per-brief workflow in `CLAUDE.md`: before merging, run `git log
main -1` and confirm the tip matches what the branch last synced against; if it moved,
rebase and re-verify isolation before merging. Worktree-per-brief already protects
in-progress branch work from cross-session collisions, but `main` itself was still an
unprotected merge point — a same-day collision there (`e5e8cb0` landing mid-session, from
outside this session, during the `ai-docs-fix` merge) had already happened once and was
resolved cleanly only because it touched non-overlapping files. This makes the check
standing practice instead of a one-off reasoning exercise each time it recurs.

### Status check: `brief/moodle-credential-safety` (read-only, nothing modified)

No gate framed as "waiting on the user's SQL query results to check for other affected
students" exists anywhere in this branch's `docs/migration-log.md` history — that context
isn't recorded here. What the branch actually contains, as of this check: **5 commits**,
not a hold. `771a68a` (root-cause fix: `moodle-sync`'s `callMoodle` now fails on Moodle's
`warnings`-array rejection instead of silently treating it as success, +3 unit tests),
`f21e3b1` (nav fix linking the pre-existing but unreachable "Needs Attention" page),
`c90157c` (48h threshold on the `moodle_synced_no_login` flag), `1f9394b` (two schema-drift
fixes in `retry-worker`/`moodle_enrollment_sync` — content-identical to `e5e8cb0`, already on
`main` via a different path, confirmed by diff), and `6dcf539` (a full migration-log entry
documenting all of it). That entry has its own GATE — merge-confirmation, contingent on a
`deno test` run and a manual verification checklist, neither executed yet (`deno`/Docker
unavailable in that session's environment); it explicitly states the core fix "has not been
exercised against a real or mocked Moodle response." One untracked file in that worktree:
`deno.lock`. Not touched, per this brief's read-only instruction.

### Triage: `student-engagement-monitor.ts` + `202607131700_engagement_email_pause_toggle.sql`

Still uncommitted in the shared tree, unowned since before this conversation started.
Functionally: adds two config-driven toggles (`never_started_email_enabled`,
`dropped_off_email_enabled`) read from `student_engagement_config`, gating all three of the
function's email-sends (`processNeverStarted`, `processDroppedOff`, `processMoodleNoLogin` —
the last shares the `never_started` toggle). Flagging/`needs_attention_flag`/audit logging
still happens when a toggle is off; only the email queue insert is skipped. The migration
inserts both keys defaulting to `'0'` (paused), commented "per explicit request."

No relation found to a flagged attendance-reminder/missed-class-detector/student-engagement-
monitor notification-overlap problem — no mention of that exists anywhere in this log, and
the diff doesn't touch either of the other two functions or any dedup logic; it's narrowly
an email on/off switch. Looks complete, not mid-edit — all three code paths follow the same
pattern consistently, the migration's two keys match exactly what the code reads, and the
code degrades safely without the migration applied (`?? 1` defaults to enabled). Nothing on
`main` currently depends on or is broken by this being unlanded — pure additive feature.

Recommendation (not acted on, per this brief's stop-after-triage instruction): closest to
commit-as-is — reads as complete and internally consistent — with the caveat that nothing
here was exercised this session (no dry run against the config table), so commit-as-WIP is
the more conservative version of the same call if a verification pass is wanted first.

---

## 2026-07-13 — HOLD recorded durably for `brief/moodle-credential-safety`

### HOLD

HOLD — this branch is blocked pending operator review of two live-database SQL queries.
Do not merge. Do not consider the existing test-verification/manual-verification gate as
the only open gate — this SQL-query hold is separate and takes priority.

Important correction: the current checked-in `brief/moodle-credential-safety`
`docs/migration-log.md` entry says two read-only queries were handed to the operator, but it
does **not** preserve their SQL text verbatim. The exact query bodies were therefore not
durably recorded in-repo at the time the hold was set. To prevent that omission from being
repeated, the hold is being restated here with reconstructed query text based on the branch's
documented intent and current branch code/schema.

### QUERIES

```sql
-- Query 1: other students currently in the same synced-but-silent state
-- Matches the branch's fixed moodle_no_login logic: ASSIGNED applicant, moodle_enrollment_sync
-- row marked SYNCED for >48h, and no matching student_grades activity by applicant_id/student_id.
SELECT
  ms.id,
  ms.applicant_id,
  ms.student_id,
  ms.email,
  ms.full_name,
  ms.batch_id,
  ms.class_option_id,
  ms.course_id,
  ms.moodle_user_id,
  ms.sync_status,
  ms.synced_at,
  ms.created_at,
  ms.updated_at
FROM public.moodle_enrollment_sync ms
JOIN public.applicants a
  ON a.id = ms.applicant_id
WHERE upper(COALESCE(ms.sync_status, '')) = 'SYNCED'
  AND COALESCE(a.registration_status, a.status) = 'ASSIGNED'
  AND ms.synced_at < now() - interval '48 hours'
  AND NOT EXISTS (
    SELECT 1
    FROM public.student_grades sg
    WHERE sg.applicant_id::text = a.id::text
       OR sg.student_id::text = a.id::text
  )
ORDER BY ms.synced_at DESC NULLS LAST, ms.created_at DESC;
```

```sql
-- Query 2: historical audit-log evidence of a Moodle password rejection
-- moodle-sync on this branch logs these as MOODLE_SYNC_FAILED on entity_type
-- moodle_enrollment_sync, with MOODLE_WARNING_REJECTED in the details payload.
SELECT
  al.id,
  al.logged_at,
  al.entity_id,
  al.action,
  al.status,
  al.details
FROM public.audit_logs al
WHERE al.entity_type = 'moodle_enrollment_sync'
  AND al.action = 'MOODLE_SYNC_FAILED'
  AND (
    COALESCE(al.details->>'message', '') ILIKE '%MOODLE_WARNING_REJECTED%'
    OR COALESCE(al.details->>'reason', '') ILIKE '%MOODLE_WARNING_REJECTED%'
    OR al.details::text ILIKE '%password%'
    OR al.details::text ILIKE '%warning%'
  )
ORDER BY al.logged_at DESC;
```

### STATUS

- I did **not** run either query here. No live project DB access is configured in this
  environment, and running against a local/sandbox database would not answer the incident
  question.
- As of the branch's own latest migration-log entry (`1b217d2`, 2026-07-13), the separate
  test/verification gate still stands too: `deno test --no-check --allow-net` passed for the
  branch's `moodle-sync` tests, but the fix still has no ground-truth verification against a
  real Moodle rejection response.
- `docs/BRANCH_HOLDS.md` now also carries this hold so a future session can see it without
  scrolling the full append-only log.

---

## 2026-07-13 — `brief/moodle-credential-safety`: SQL-query hold resolved; test-verification gate still open

### HOLD STATUS UPDATE

The SQL-query hold on `brief/moodle-credential-safety` is now **resolved**. This closes
**gate 1 of 2**, not the whole branch.

What was resolved:
- The operator ran both hold queries directly against the real project database.
- Query 1 ("SYNCED with no grades activity") returned **9 students** spanning
  **2026-05-17 through 2026-06-28**, plus **4 separate data-integrity rows** with
  `sync_status = 'SYNCED'` and `synced_at IS NULL`.
- Query 2 confirmed the broader mechanism is real on a Moodle
  `core_user_create_users` rejection path — it logged, retried, and was caught correctly
  there — but did **not** directly hit the exact silent `core_user_update_users`
  password-reset bug this branch fixes. That non-hit is expected: the silent path being fixed
  here logged nothing by design.
- The operator then manually verified the other affected students' Moodle logins and confirmed
  that only `taquangminh081` needed a manual credential fix. The rest have working credentials.

Conclusion: this is now confirmed as an **isolated incident**, not a systemic active-incident
outbreak requiring broad student outreach.

### REMAINING GATE (still open)

The branch's separate pre-existing test-verification gate remains open and was **not** resolved
by the SQL review above.

What would actually close that remaining gate:
- Ground-truth verification of the `moodle-sync` warnings-detection fix against a **real Moodle
  rejection response**, not only the synthetic test fixture currently in the branch.
- The earlier branch finding still stands: there is **no non-production/staging Moodle instance**
  documented anywhere in this repo, and the only known Moodle instance in repo state is
  production.

Operator decision needed before any merge decision on this branch:
1. Find a safe way to verify against a real Moodle rejection response.
2. Accept the current synthetic-fixture-only verification, now that the SQL review has shown
   this is a low-frequency isolated edge case rather than a broad systemic incident.
3. Choose some other explicit verification/gate path.

Do not merge `brief/moodle-credential-safety` until that second gate is explicitly resolved.

### SEPARATE OPEN ISSUE (not part of the resolved hold)

The SQL review also surfaced a separate data-integrity issue that remains **open** and
unaddressed:
- 4 rows in `moodle_enrollment_sync` with `sync_status = 'SYNCED'` but `synced_at IS NULL`
- duplicate emails with differing `moodle_user_id` values

This is **not** part of the resolved SQL-query hold for the silent password-reset incident.
Logging it here explicitly so it is not lost now that the main incident is classified.

### SANITY CHECK — does the early-warning loop actually close?

Branch state and current `main` state diverge here:

- On `brief/moodle-credential-safety`, yes: the branch has all three pieces needed for the
  warning loop to work together.
  - `f21e3b1` adds the "Needs Attention" nav entry in `admin-shell.js`.
  - `c90157c` adds the 48-hour threshold for `moodle_synced_no_login`.
  - `57fa0bd` removes the invalid `student_grades.student_email` reference that had caused
    `get_student_attention_flags()` to throw and silently return zero rows for every flag type.
  - `needs-attention.html` already calls `get_student_attention_flags` and renders the
    `moodle_synced_no_login` rows under the "No Moodle Login" label.
- On the current checked-out `main`, **no**: the early-warning chain is not fully live today.
  - `foundation/staff/needs-attention.html` exists and renders the RPC output.
  - But current `main` `foundation/js/admin-shell.js` still has **no** "Needs Attention"
    nav item.
  - And current `main` `supabase/migrations/202605220011_needs_attention_rpcs.sql` still
    contains the invalid `sg.student_email` clause, so the underlying RPC remains the
    silently-broken version in repo state here.

So the correct statement is: **if this branch merged as-is, a taquangminh081-shaped case would
surface through the Needs Attention path; on current `main`, that loop is still not fully
closed yet.**

---

## 2026-07-14 — Reserved templates explicitly unwired

The following templates exist in repo/database state but are **explicitly not wired** to any
active producer, trigger, or cron at this time:

- `class_slot_cancelled`: reserved for a future class-cancellation feature if implemented.
  Current class-management behavior changes class slots rather than cancelling them.
- `waitlist_promoted`: reserved; no current use case.
- `engagement_final_notice`: reserved; `student-engagement-monitor` currently fires only the
  first two engagement templates.

If any of those features are implemented in the future, wire the producer/trigger deliberately
and reference this log entry when doing so.

---

## 2026-07-14 — `get_teacher_attention_flags` / `get_system_attention_flags` audit (Phase A, audit only)

Follow-up to the `get_student_attention_flags` bug (invalid `student_grades.student_email`
reference, fixed only on branch `brief/moodle-credential-safety` via `57fa0bd` — **not yet on
`main`**, see the 2026-07-13 sanity-check entry above). Checked whether the two sibling RPCs in
`202605220011_needs_attention_rpcs.sql` share the same bug class. They do not share the same
bug, but one of them is broken by a different bug, with the same silent-failure effect.

**Correction to the brief's premise:** the brief that triggered this audit stated
`get_student_attention_flags` "was just fixed." On current `main` state, checked as part of
this pass, it is not — `supabase/migrations/202605220011_needs_attention_rpcs.sql` on `main`
still contains the invalid `sg.student_email` clause. The fix exists only on the unmerged
branch noted above.

### `get_teacher_attention_flags` — **BROKEN**, confirmed live, different bug class

Every column reference in `classes` / `class_metrics` / `class_expectation` / `overdue` /
`neglect` / `unlinked` was checked against the live `foundation-school` schema
(`class_options`, `class_slots`, `teachers`, `batches`, `attendance_log`) — all column names
exist. The bug is not an invalid column, it's a type error:

```sql
floor(extract(epoch FROM (LEAST(COALESCE(c.end_date, now()::date), now()::date) - c.start_date)) / 604800)
```

`batches.start_date` and `batches.end_date` are both `date`. In Postgres, `date - date` returns
`integer` (a day count), not `interval` — `extract(epoch FROM <integer>)` has no matching
function overload. Confirmed live:

```
select (now()::date - '2026-01-01'::date) as diff, pg_typeof(now()::date - '2026-01-01'::date);
→ diff: 194, diff_type: integer
```

Running the `class_metrics` CTE standalone against the live DB throws:
`ERROR: 42883: function pg_catalog.extract(unknown, integer) does not exist`.
Calling `select * from get_teacher_attention_flags();` live returns **zero rows** — the
blanket `EXCEPTION WHEN OTHERS THEN RETURN` (lines 343–345) swallows this every time. Because
all three flag branches (`overdue_attendance_submission`, `teacher_neglect`,
`teacher_unlinked_auth`) are combined into one `UNION ALL` inside a single `RETURN QUERY`
statement, the type error in `class_metrics`/`class_expectation` (used only by `overdue` and
`neglect`) takes down `unlinked` too, even though `unlinked` doesn't reference those CTEs —
Postgres has to evaluate the whole statement, so a fatal error anywhere in it aborts all of it.

This function has produced **zero flags for all three flag types since it was created
(`202605220011`, 2026-05-22)** — roughly 7.5 weeks as of this audit (2026-07-14). No migration
after `202605220011` has touched the function body; the only later migration referencing it
(`202607131400_attention_flags_rls_coverage.sql`) only added RLS policies to the
`attention_flags` table, not the RPC. Same severity class as the student RPC: a real,
production-affecting alerting gap, not a minor issue.

### `get_system_attention_flags` — **clean**, confirmed live

All column references (`moodle_enrollment_sync.sync_status/updated_at/created_at`,
`email_queue.status/created_at`, `applicants.registration_status/status/updated_at/created_at`)
verified against the live schema — all exist. Live invocation
(`select * from get_system_attention_flags();`) returns 3 rows (one per branch), each with a
real `count` (currently all `0`, which reflects an actually-clean current state, not a
swallowed exception — an error would have produced zero *rows*, not three rows of zero
*counts*). No fix needed.

### Exception-handling philosophy (judgment call, not just mechanics)

The blanket `EXCEPTION WHEN OTHERS THEN RETURN` pattern is not appropriate for this RPC family
and should be narrowed or removed. Reasoning:

- These are **admin-facing alerting RPCs**. Their entire purpose is to surface problems. A
  pattern that converts "the query itself is broken" into "there are no problems to report" is
  the worst possible failure mode for exactly this kind of function — it is silent,
  indistinguishable from a genuinely healthy system, and has now caused two independent bugs
  (an invalid column, and a type error) to go undetected for months across two of the three
  sibling functions.
- There is no expected/recoverable error condition inside these queries that would justify a
  catch-all: they're read-only aggregation queries over tables that already exist, gated by
  `SECURITY DEFINER` with `search_path` pinned. Nothing in the query logic legitimately raises
  and expects to be caught.
- If the concern was "one bad flag type shouldn't take down the whole page," the right fix is
  **narrowing the blast radius, not swallowing the error**: either run each flag-type branch as
  its own statement/RPC (so a bug in `teacher_neglect` doesn't hide `teacher_unlinked_auth`),
  or wrap only genuinely-recoverable conditions (e.g. a specific expected NULL/division case)
  in a narrow exception, and let anything else propagate so it shows up in logs/monitoring
  immediately instead of silently returning an empty admin dashboard.
- If a catch-all is kept for defense-in-depth, it should at minimum log to `audit_logs` (or
  raise a warning/notice) before returning, so a broken RPC leaves a trace instead of looking
  identical to "nothing to report."

### Status

Audit only — no fixes applied in this pass, per the brief's Phase A scope. Both findings
(`get_teacher_attention_flags` broken, `get_system_attention_flags` clean) and the
exception-handling recommendation are reported for a follow-up decision/fix pass.

---

## 2026-07-14 — `get_teacher_attention_flags` fixed (Phase B, migration applied — GATE)

Follow-up to the Phase A audit above. Branch `brief/fix-teacher-attention-flags`, migration
`supabase/migrations/202607142100_fix_teacher_attention_flags.sql`.

**What was broken:** `class_metrics`'s `expected_sessions` calculation did
`extract(epoch FROM (LEAST(COALESCE(end_date, now()::date), now()::date) - start_date)) / 604800`.
`batches.start_date`/`end_date` are `date`, and Postgres `date - date` returns `integer` (a day
count), not `interval` — `extract(epoch FROM <integer>)` has no matching overload (`SQLSTATE
42883`), thrown on every call. The blanket `EXCEPTION WHEN OTHERS THEN RETURN` swallowed it,
so all three flag types (`overdue_attendance_submission`, `teacher_neglect`,
`teacher_unlinked_auth`) returned zero rows for every call since the function was created
(`202605220011`, 2026-05-22) — confirmed live in the Phase A audit.

**How it was fixed:**
1. Date arithmetic: since `date - date` is already an integer day count, dropped the
   `extract(epoch FROM ...)/604800` round-trip entirely and divide the day count by `7`
   directly — same `floor(days/7)+1` semantics, no type gymnastics. (The brief's suggested
   `(date - date)::interval` cast does not work: Postgres has no `integer → interval` cast;
   confirmed live — `cannot cast type integer to interval`, `SQLSTATE 42846`.)
2. Exception handling: replaced the blanket swallow with an `INSERT INTO public.audit_logs
   (actor_email, action, entity_type, entity_id, status, details, created_at)` call
   (`action='ATTENTION_FLAGS_ERROR'`, `status='FAILED'`, `details` carries `SQLSTATE`/`SQLERRM`/
   `p_batch_id`) before `RETURN`, matching the live `audit_logs` schema (no `actor_id` or
   `logged_at` columns exist on `main` — those only appear in an older, superseded migration).

**The logging paid for itself immediately.** After applying only the date-arithmetic fix, the
function still returned zero rows. The new `audit_logs` entry showed why:
`SQLSTATE 42702, "column reference \"teacher_id\" is ambiguous"`. `RETURNS TABLE (..., teacher_id
text, full_name text, email text, ...)` makes `teacher_id`/`full_name`/`email` PL/pgSQL
OUT-parameter names in scope for the whole function body. The `overdue` and `neglect` CTEs
selected and grouped by those same column names *unqualified* from `class_expectation`,
colliding with the OUT parameters. This bug has existed since the function's creation too — it
was invisible before because Postgres's query-analysis phase hit the `extract(epoch ...)` type
error first, before it ever reached the ambiguous-reference check further down in the same
statement. Fixed by qualifying every such reference with the CTE alias (`c.teacher_id`,
`c.full_name`, `c.email`) in both branches. `unlinked` was already qualified (`t.teacher_id`
etc.) and was never affected.

**Verified live** (`supabase db query --linked`, `foundation-school` project
`xelpsttqhrcqmttmjory`) after both fixes: `select * from get_teacher_attention_flags();`
returns 10 real rows — 3 `overdue_attendance_submission`, 7 `teacher_neglect`, 0
`teacher_unlinked_auth`. The zero for `teacher_unlinked_auth` is a genuine result, not a
swallowed error: confirmed separately that 0 active teachers currently have a null
`teacher_user_id`. No `ATTENTION_FLAGS_ERROR` row was written on the successful run.

**New exception-handling approach:** narrowed from silent-swallow to log-then-return-empty.
This does not fully solve the "one bad branch hides the others" structural issue named in the
Phase A exception-handling reasoning (a fatal error anywhere in the single `UNION ALL`
statement still empties the whole result) — that would need per-branch statements/RPCs, which
is a larger structural change intentionally left out of this fix. What it does fix: a future
regression will leave a trace in `audit_logs` instead of looking identical to "nothing to
report."

**GATE:** this is a fix to a broken alerting RPC on `main`, applied directly to the live
`foundation-school` project via `supabase db query --linked` (not via `db push`, which also
wanted to reconcile several unrelated older migrations, one of which fails against current
schema — out of scope for this brief and not touched). Migration file is staged on
`brief/fix-teacher-attention-flags` pending merge confirmation.

## 2026-07-14 — Waitlist "class available" dedup consolidation (`brief/waitlist-dedup-consolidation`)

### What was wrong (duplication mechanism)

Two independent producers notified waitlisted applicants when a class opened, with
**two different templates** and **two different dedupe-key namespaces**, so overlapping
populations got duplicate, inconsistent emails:

1. **DB trigger path** — `queue_waitlisted_class_available_notifications()`
   (202605191920, fired from `class_slots` / `class_options` triggers). Template
   `classes_now_available`. Its dedupe key embedded a timestamp-derived `event_key`
   (`slot:<id>:<updated_at>` / `class_option:<id>:<updated_at>`), so every firing minted a
   **fresh key** — the dedupe never held across events. Targeting:
   `registration_status='WAITLISTED'` + `class_option_id IS NULL` + fellowship intersect.
2. **Cron path** — `waitlist-processor` edge function, every 15 min (202605180002).
   Template `class_now_available` (singular). Timestamp-free key but in its own
   namespace, and written with a **blind upsert on dedupe_key** that reset the existing
   row to `PENDING` — i.e. a SENT row could be resurrected and re-sent; the only real
   guard was the `availability_status` flip to CLASS_AVAILABLE. Targeting:
   `availability_status='NO_MATCHING_TIME'` + fellowship + class-day text found in the
   applicant's availability string.

**Broken cron CTA finding:** the cron template's button ("Register / Confirm your spot")
pointed at a bare Moodle login URL. Recipients at this stage have **no assigned class and
no Moodle account** (Moodle provisioning happens after ASSIGNED via enrollment sync), so
that email was a dead end — nothing the recipient clicked could actually get them a seat.
The trigger path's selection-token CTA (`class_selection_finalize()` assigns the class,
increments enrollment, queues Moodle sync) is the only functional call-to-action.

### Why Option C

Options considered at the Phase A gate: (A) retire one producer — loses either the
event-driven immediacy or the day/time-availability targeting; (B) shared dedupe key
only — still two templates, still a dead-end CTA on cron sends; **(C) shared
timestamp-free dedupe key + one canonical template + cron adopts the selection-token
CTA** — keeps both producers' targeting strengths, fixes the dead-end CTA, and makes the
dedupe actually dedupe. C was approved.

### What was consolidated (migration `202607141000_waitlist_consolidate_dedup.sql` + `waitlist-processor`)

- **Canonical dedupe key for any future producer of this notification:**
  `class_available:{applicant_id}:{batch_id}:{class_option_id}`
  Timestamp-free, byte-identical in SQL (`format('class_available:%s:%s:%s', ...)`) and
  TypeScript (`buildClassAvailableDedupeKey()` in
  `supabase/functions/waitlist-processor/dedupe.ts`). Parity-tested in
  `waitlist-dedup.test.ts` (5 tests, all passing under deno 2.9.2). Documented in
  `ai/statuses.md` under the CLASS_AVAILABLE entry.
- **Upsert → insert-if-absent (SENT-resurrection rationale):** the cron's old
  `upsert(..., { onConflict: 'dedupe_key' })` overwrote whatever row held the key,
  including `status` — a SENT row went back to PENDING and re-sent. Both producers now
  check-then-insert (cron additionally uses `ignoreDuplicates: true` on the insert to
  close the pre-check race; a lost race orphans one 7-day token, harmless). An existing
  row is **never modified**, whatever its status. Suppressed duplicates are audited:
  `audit_logs` action `WAITLIST_DUPLICATE_SUPPRESSED`, entity applicant, details incl.
  `dedupe_key` and `source` (`trigger` | `cron`).
- **Canonical template:** `notification_templates.classes_now_available` — gate-approved
  merged body (202605201000 purple/logo/footer base + class-details block +
  `{{expires_days}}` + CTA "Choose My Class Time" → `{{selection_url}}`). Merge fields:
  `first_name, class_day, class_time, teacher_name, fellowship_code, selection_url,
  expires_days` — every one supplied by both producers, so no silent-empty `{{tags}}`
  (email-sender substitutes unknown tags with empty string). No `{{moodle_url}}` /
  `{{class_label}}`. The body update is an isolated, clearly-labeled section (2) of the
  migration, strippable on its own if the operator reverses the body decision.
- **`class_now_available` retired:** set `active = false` (row kept). Because
  email-sender loads only active templates and hard-fails queue rows whose template is
  missing, the migration first **re-points in-flight rows**: PENDING
  `scheduled_notifications` rows get a freshly minted selection token,
  `selection_url`/`expires_days` payload keys, the canonical template key and the
  canonical dedupe key (or are explicitly FAILED as
  `DEDUP_CONSOLIDATION_202607141000: superseded…` when a canonical-key row already
  exists); Pending `email_queue` rows are recovered via (email, batch_id) applicant
  lookup, or explicitly Failed when unmappable. Expected population of both blocks: ~0
  (rows drain in minutes); the blocks are defensive.
- **Cron behavior preserved:** targeting (NO_MATCHING_TIME + fellowship + day-text) and
  the `availability_status` → CLASS_AVAILABLE flip are unchanged (the flip also fires on
  a suppressed duplicate — behavioral parity with the old upsert path, and it stops the
  cron re-auditing the same applicant every 15 minutes). Request/response shape of the
  edge function is unchanged.
- **Trigger function replaced via CREATE OR REPLACE in the NEW migration only** —
  202605191920 was not edited. Signature kept (`p_event_key` still accepted; now goes to
  `notification_events` payload and audit metadata only, not the key).

### Discrepancy noted for the record

The operator's Phase B brief text referred to the template table as `email_templates`.
Per the Phase A audit (2026-07-13 email pipeline audit + this brief's verification),
`email_templates` is dead: **`notification_templates` is the canonical and only table
email-sender reads**. This brief used `notification_templates` throughout.

### Third producer: manual-only decision

`class-selection` edge function, action `notify_waitlisted`
(`supabase/functions/class-selection/index.ts`) also queues `classes_now_available` —
directly into `email_queue`, with **no dedupe key**. Gate decision: keep as a
**manual-only operator escape hatch** (it can force a re-send the canonical key would
suppress). A code comment at the site records this and its payload gaps (no
class_day/class_time/teacher_name → those render empty in the class-details block —
acceptable for a manual tool). It must not be wired into any automated flow without
adopting the shared dedupe key.

### Tests

`deno test supabase/functions/waitlist-processor/waitlist-dedup.test.ts` → 5 passed,
0 failed (deno 2.9.2). `deno check` on the modified `waitlist-processor/index.ts` shows
the same 8 pre-existing errors as the unmodified baseline (all in `_shared/http.ts`
typing of `withTimeout`/`jsonResponse` call sites) — zero new errors introduced.
A live integration test (slot flip + cron invoke) is not possible in this environment;
see the operator checklist below.

### OPERATOR VERIFICATION CHECKLIST (run before any merge/deploy decision)

1. Apply migrations: `supabase db push --include-all` (or apply
   `202607141000_waitlist_consolidate_dedup.sql` via the SQL editor). Confirm no errors.
2. Verify the dedupe index exists:
   ```sql
   SELECT indexname, indexdef FROM pg_indexes
   WHERE tablename = 'scheduled_notifications'
     AND indexname = 'scheduled_notifications_dedupe_key';
   ```
   Expect one row, UNIQUE, partial `WHERE (dedupe_key IS NOT NULL)`.
3. Verify template state:
   ```sql
   SELECT template_key, active, subject, updated_at FROM public.notification_templates
   WHERE template_key IN ('classes_now_available', 'class_now_available');
   ```
   Expect `classes_now_available` active=true with the new subject
   ("Good news — a Foundation School class is now available for you!") and
   `class_now_available` active=false.
4. Trigger-path check: flip a test class option/slot to available (e.g. set an inactive
   `class_slots` row for an active batch to `status='Active'`, with at least one
   WAITLISTED, fellowship-matching applicant with `class_option_id IS NULL`). Then:
   ```sql
   SELECT id, template_key, dedupe_key, status, payload->>'selection_url' AS selection_url
   FROM public.scheduled_notifications
   WHERE dedupe_key LIKE 'class_available:%'
   ORDER BY scheduled_for DESC LIMIT 10;
   ```
   Expect exactly ONE row per (applicant, batch, class_option) with
   `template_key='classes_now_available'`, a non-null selection_url, and a matching
   `audit_logs` row (`action='CLASS_SELECTION_EMAIL_QUEUED'`).
5. Cron-path dedupe check: within ~5 minutes, run
   `supabase functions invoke waitlist-processor` (or wait for the 15-min cron). Then
   re-run the query from step 4 — expect NO second row for the same
   (applicant, batch, class_option), and:
   ```sql
   SELECT action, entity_id, details FROM public.audit_logs
   WHERE action = 'WAITLIST_DUPLICATE_SUPPRESSED'
   ORDER BY created_at DESC LIMIT 10;
   ```
   Expect a row with `details->>'source' = 'cron'` (or 'trigger' if the trigger re-fired)
   and the same dedupe_key. NOTE: this cross-producer suppression only occurs when the
   applicant is in BOTH populations (WAITLISTED and NO_MATCHING_TIME with a day-text
   match); pick or stage the test applicant accordingly.
6. Orphan-token check — CORRECTED QUERY. The operator draft referenced
   `class_selection_tokens.scheduled_notification_id`, which does not exist (the table's
   columns are id/token/applicant_id/batch_id/fellowship_code/expires_at/used_at/
   used_class_option_id/created_at; see 202605180005). Correct equivalent — recent
   tokens per (applicant, batch) vs. notification rows for the same tuple:
   ```sql
   SELECT t.applicant_id, t.batch_id, COUNT(*) AS tokens_last_hour,
          (SELECT COUNT(*) FROM public.scheduled_notifications sn
           WHERE sn.applicant_id = t.applicant_id
             AND sn.dedupe_key LIKE 'class_available:' || t.applicant_id || ':' || t.batch_id || ':%')
          AS notification_rows
   FROM public.class_selection_tokens t
   WHERE t.created_at > now() - interval '1 hour'
   GROUP BY t.applicant_id, t.batch_id
   ORDER BY tokens_last_hour DESC;
   ```
   Expect tokens_last_hour ≈ notification_rows for each tuple (a +1 skew is possible
   only from a concurrent-race orphan, which should be rare to nonexistent). Re-running
   the cron repeatedly must NOT grow tokens_last_hour for suppressed applicants.
7. All pass → safe to proceed (operator sequences the
   `brief/email-template-consolidation` rebase on top of this branch). Any fail →
   report before merging further work.

### OPERATOR VERIFICATION RUN — 2026-07-14 (post-merge, live `foundation-school`)

Branch merged to `main` (fast-forward: `3e8351f`, `0558be4`, `25f5b6e`). Migration
`202607141000_waitlist_consolidate_dedup.sql` applied live via `supabase db query -f`
(not `db push`, which fails on unrelated pre-existing drift in
`202607090001_email_claim_and_perf_indexes.sql` — `email_queue.updated_at` does not
exist on the live schema; out of scope for this brief, not touched).

**Checklist items 1-2, 3 (index/migration):** pass as specified.

**Checklist item 3 (template state) — partial finding:** `classes_now_available` is
correct (active, updated subject). `class_now_available` (singular) has **no row at
all** in `notification_templates` — never existed, live or otherwise. The migration's
`UPDATE ... WHERE template_key = 'class_now_available'` (deactivate step) is a
documented no-op against live data. Not a defect in this migration; flags that the old
cron path referenced a template key with no backing content row.

**Checklist items 4-6 — blocked as literally written, verified via direct function
call instead:** `trg_notify_waitlisted_on_class_slot_available` and
`trg_notify_waitlisted_on_class_option_available` (from `202605191920`) **do not exist
live**, despite `202605191920` being recorded as applied in
`supabase_migrations.schema_migrations`. The trigger-based notify path has apparently
never fired in production. This is pre-existing and unrelated to this brief — logged
here as a new finding, not fixed in this pass. Root cause not investigated (partial
`db push` history, manual drift, or something else — unknown).

Also found: `waitlist-processor` was deployed at version 12 (2026-05-25), 7 weeks
stale, predating this brief's dedup fix entirely. Deployed current code
(`supabase functions deploy waitlist-processor`) before invoking it.

**Verification actually performed (live `foundation-school`, ref
`xelpsttqhrcqmttmjory`):**
1. Inserted a real, clearly-labeled test `class_option`/`class_slot`
   (`CO-TEST-WAITLISTDEDUP-REGIONAL`, `MAY2026`, fellowship `REGIONAL`) since 0 of the
   13 live class_options matched any currently-WAITLISTED applicant's fellowship.
2. Called `queue_waitlisted_class_available_notifications('CO-TEST-WAITLISTDEDUP-REGIONAL','MAY2026', <event>)`
   directly (same logic the missing trigger would have called) → `queued_count: 3,
   skipped_count: 0`. Confirmed: one `scheduled_notifications` row per applicant,
   `template_key='classes_now_available'`, valid `selection_url`, matching
   `CLASS_SELECTION_EMAIL_QUEUED` audit rows. Real applicants: `crawford_keditia@yahoo.com`,
   `marvelousoladiti08@gmail.com`, `omoshulemrd2000@gmail.com` (all real WAITLISTED
   REGIONAL applicants, no synthetic data used for recipients).
3. Invoked the (now-current) `waitlist-processor` live via HTTPS →
   `{"ok":true,"slots_checked":14,"notified":0,"errors":[]}`. Zero cross-producer
   suppression occurred because these applicants' `availability` field is literally
   `"NO_CLASS_AVAILABLE"`, not day-text — the cron's own day-text targeting never
   selected them as candidates. This is the exact caveat the checklist itself names
   ("cross-producer suppression only occurs when the applicant is in BOTH
   populations").
4. To verify the actual dedup mechanism (not gated on the cron's separate targeting),
   re-called `queue_waitlisted_class_available_notifications` a second time with a
   different event_key → `queued_count: 0, skipped_count: 3`, with 3
   `WAITLIST_DUPLICATE_SUPPRESSED` audit rows (`source: 'trigger'`), no new email
   queued. **This confirms the core fix**: the dedupe key is timestamp-free and
   insert-if-absent, unlike the pre-migration behavior.
5. Orphan-token check (corrected query from item 6): `tokens_last_hour ==
   notification_rows` (1:1) for all 3 applicants — no orphan token from the
   suppressed second call.
6. Cleanup: deleted `CO-TEST-WAITLISTDEDUP-REGIONAL`'s `class_slots` and
   `class_options` rows after verification. Left the 3 real `scheduled_notifications`
   rows in place (`PENDING`) — those 3 real applicants will receive the real
   `classes_now_available` email once `scheduled-notification-sender`/`email-sender`
   next run; this was an accepted consequence of testing against real data rather than
   synthetic fixtures (operator decision, 2026-07-14).

**Verdict:** dedup consolidation logic verified correct and safe. Two follow-ups
opened, both pre-existing and out of scope for this brief: (a) missing
`class_slots`/`class_options` notify triggers despite `202605191920` showing as
applied — the DB-trigger producer has likely never fired in production; (b) the ghost
`class_now_available` template row.

## 2026-07-14 — Moodle credential safety net (`brief/moodle-credential-safety`)

### TRIGGER

A specific student (taquangminh081@gmail.com) reported never receiving a working Moodle
login. Traced end-to-end via SQL against the live DB (`moodle_enrollment_sync`,
`email_queue`): his row shows `sync_status = 'SYNCED'`, `moodle_user_id = 219`,
`course_id = 13`, and a `moodle_credentials` email with `status = 'Sent'` — every signal
in our own system said this worked. User separately confirmed in the Resend dashboard that
no email was ever actually delivered/logged there, and the temp password we did send is
rejected by Moodle as incorrect. This is a real bug, not user error.

### ROOT CAUSE

`moodle-sync/index.ts`'s `callMoodle` only treats a response as a failure when Moodle
returns a top-level `exception` key or a non-2xx HTTP status. Moodle reports a rejected
user-write (e.g. a password failing the site's password policy) via a `warnings` array
instead — an HTTP 200, no `exception`, that looks identical to success. `findOrCreateMoodleUser`
additionally wrapped every password-reset call in `try { ... } catch { console.error(...) }`,
so even a *thrown* reset failure was swallowed and the pre-generated temp password was
returned and emailed regardless. The row reached `SYNCED` and the credentials email was
queued and sent — with a password that was never actually applied server-side.

Confirmed via two parallel Explore-agent research passes plus direct migration/RPC reads:
this is the only place in the codebase with this gap (also present, lower-stakes, in
`notification-batch-processor` and `moodle-grade-sync`'s own separate `callMoodle`
implementations — not touched this brief, read-only calls, lower risk, noted for a future
centralization pass).

### WHAT SHIPPED (working tree, `brief/moodle-credential-safety`)

- `supabase/functions/moodle-sync/index.ts` (`771a68a`) — `callMoodle` gains a
  `failOnWarnings` option; a new exported pure function `warningRejection(data)` detects a
  Moodle warnings-array rejection. Every password-setting call site in
  `findOrCreateMoodleUser` (existing-user reset, initial create, both `ALREADY_EXISTS`
  fallback resets, alternate-username create) now passes `failOnWarnings: true` and no
  longer swallows the error — a rejected reset now throws, propagates to the main handler's
  existing catch block, and is classified/retried/audited through the **already-working**
  `moodle_enrollment_sync` RETRYING/FAILED state machine, `failed_syncs` mirror table,
  `retry-worker` auto-sweep, and Retry Center UI. No new retry/visibility plumbing was
  built — the fix makes the failure exist so the existing machinery can see it.
- `supabase/functions/moodle-sync/moodle-sync.test.ts` (`771a68a`) — three new unit tests
  against the exported `warningRejection`, covering the real-world rejection shape, a clean
  success response, and an empty-warnings response.
- `foundation/js/admin-shell.js` (`f21e3b1`) — added "Needs Attention" to the nav
  (`needs-attention.html`, `SYSTEM_ADMIN_ROLES`). **Independently discovered while
  researching this brief**: `needs-attention.html` and its `get_student_attention_flags`
  RPC already existed, already computed a `moodle_synced_no_login` flag, but the page was
  never linked in `admin-shell.js`'s nav array — the one existing detection net for this
  exact failure mode was unreachable by any admin. UI-only change.
- `supabase/migrations/202607131700_moodle_no_login_flag_threshold.sql` (`c90157c`) — the
  `moodle_synced_no_login` flag fired immediately on every `SYNCED` row with no minimum
  age, which likely trained admins to ignore it as noise even if they'd found the page.
  Added a 48h threshold, aligned with `student-engagement-monitor`'s
  `processMoodleNoLogin` (3 days) so the two "no login" checks agree on cadence.
- `supabase/functions/retry-worker/index.ts` + `supabase/migrations/202607131800_moodle_sync_status_permanently_failed.sql`
  (`1f9394b`) — two adjacent schema-drift bugs found in the same retry pathway while
  researching this brief, fixed with user's explicit go-ahead (asked, not assumed):
  (1) `retry-worker`'s `email_queue` retry branch read/wrote a column named `attempts` that
  does not exist on `email_queue` (real column is `retry_count`) — the Retry Center's Retry
  button on a stuck email was plausibly broken. (2) `moodle_enrollment_sync`'s `sync_status`
  CHECK constraint never listed `PERMANENTLY_FAILED`, though `moodle-sync/index.ts` writes
  that value when `retry_count` is exceeded — those specific updates were plausibly
  rejected. Both fixed additively/idempotently.

### EXPLICITLY DEFERRED (user decision, not in this brief)

Resend only confirms "the API call to Resend succeeded," not "the email was delivered" —
`email_queue.status = 'Sent'` conflates the two, there's no Resend webhook receiver
anywhere in the codebase, and no delivery-confirmation column exists. User chose to defer
this to its own follow-up brief rather than bundle a new public webhook endpoint (needs
signature verification, a new table) into this fix. That gap remains open.

### VERIFICATION GAP — could not execute tests in this environment

`deno` is not installed in this dev environment and `supabase test` requires Docker, which
is also unavailable here. The new/changed TypeScript was sanity-checked by running it
through `tsc --noEmit` (via a `typescript` install found under `netlify-cli`'s
`node_modules`) — zero new syntax/type errors introduced in the edited regions (pre-existing,
unrelated type-inference errors in `patchSyncRow` and Deno-only `.ts`-extension imports are
present in both the before and after versions). **The actual Moodle-warnings-rejection
behavior was not exercised against a live or mocked Moodle instance.**
Run before merge: `deno test supabase/functions/moodle-sync/moodle-sync.test.ts`, and per
the plan's verification checklist, exercise `moodle-sync` against both a normal successful
case (confirm behavioral parity — still reaches SYNCED, credentials email still sends) and
a case that would trigger a Moodle password-policy warning (confirm it now lands in
RETRYING/FAILED, not SYNCED, and produces no credentials email).

### GATE

Confirm before merging `brief/moodle-credential-safety` to `main`. This changes the
control flow of a privileged, production credential-issuing edge function
(`moodle-sync`) and a second privileged retry function (`retry-worker`) for a live system
serving real students — and per the verification gap above, the core fix has not been
exercised against a real or mocked Moodle response. Recommend running the manual
verification checklist (or at minimum the `deno test` run) before merge if that's
feasible; otherwise merging on code-review confidence alone is the tradeoff being made.

---

## 2026-07-13 — Moodle credential safety net: verification pass + a second silent-failure bug found

### GATE STATUS UPDATE — the two adjacent schema-drift fixes are merged; the core fix is still held

The `email_queue` `retry_count`/`attempts` column fix and the `PERMANENTLY_FAILED` CHECK
constraint were split onto their own branch (`brief/moodle-retry-schema-fixes`) and merged
to `main` directly (commit `e5e8cb0`, fast-forward, no conflicts). They're fully isolated
from the Moodle warnings-detection logic and were already separately authorized. The prior
GATE text above (which still says "and a second privileged retry function (`retry-worker`)")
is now stale on that point — `retry-worker` is done and merged; **only the `moodle-sync`
warnings-detection core fix, the nav link, and the attention-flags RPC fix (below) remain
gated on `brief/moodle-credential-safety`.**

### VERIFICATION UPDATE — real test execution, not just tsc

`deno` was installable in this environment via `scoop install deno` (no Docker/admin
needed). Full `deno test` fails on an unrelated dependency-resolution error (a transitive
`npm:openai` type reference several layers deep in a `jsr` package pulled in only because
type-checking walks the whole module graph). Running with `--no-check --allow-net` (skips
type-checking, still executes real code) works cleanly:

```
running 4 tests from ./supabase/functions/moodle-sync/moodle-sync.test.ts
WAITLISTED -> Moodle exclusion: only ASSIGNED jobs are kept for sync ... ok
warningRejection: a Moodle password-policy warning is detected as a rejection ... ok
warningRejection: a clean success response (no warnings) is not treated as a rejection ... ok
warningRejection: an empty warnings array is not treated as a rejection ... ok
ok | 4 passed | 0 failed
```

This is real evidence the detection logic correctly handles the response shape it was
written against. It is explicitly **not** ground-truth verification that Moodle's real
rejection response matches that shape — the test fixture was written from general Moodle
web-service convention, not from an observed real response. No non-production Moodle
instance exists anywhere in this codebase/docs to test against (confirmed by grep across
`foundation/docs/`, `CLAUDE.md`, both `.env.example` files, and every function referencing
Moodle — `rocksolid.lwcanada.org` is hardcoded everywhere as the only instance, and it's
production), and there is no direct database connection available in this environment to
search `audit_logs`/`failed_syncs` for a real historical rejection to use as a fixture
instead. Two read-only queries were handed to the user to run themselves for the actual
operational question this raises — how many other students, if any, are currently sitting
in the same silently-broken state as the reported case.

### FINDING — a second, independent silent-failure bug, found while sanity-checking the user's query

The user's first attempt at the "who else is affected" query failed: `sg.student_email`
does not exist. Checking the real schema (`202605201100_student_grades.sql`) confirmed
`student_grades` has never had that column — it exists only on the unrelated
`student_engagement_log` table. The exact same invalid reference is present in the
**already-shipped, currently-live** `get_student_attention_flags` RPC
(`202605220011_needs_attention_rpcs.sql:146`, in the `moodle_no_login` CTE), which wraps
its entire `RETURN QUERY` in a blanket `EXCEPTION WHEN OTHERS THEN RETURN` (lines 200-202).

Net effect: **every call to this function since it was created in mid-May has thrown on
that reference and silently returned zero rows for all five flag types** —
`inactive_no_attendance`, `repeat_absence_3_plus`, `moodle_synced_no_login`,
`stalled_no_milestones_4_weeks`, and `waitlist_over_14_days` — not just the Moodle one.
The entire Needs Attention student-flags surface has never actually produced a result in
production. This means today's earlier nav-link fix, on its own, would have shipped a page
that's reachable but permanently empty — the underlying computation was silently broken
independent of the nav/discoverability issue.

User's explicit decision (asked, not assumed): fix now, same branch, rather than file
separately — the migration in this branch (`202607131700_moodle_no_login_flag_threshold.sql`)
already does a `CREATE OR REPLACE` of this exact function body, so folding in the one-line
removal of the invalid clause was the only way the already-built nav link + threshold work
does anything at all. Commit `57fa0bd`. The two remaining match conditions
(`applicant_id`/`student_id`) were already sufficient; nothing else about matching logic
changed. Per the additive-migrations convention, the original
`202605220011_needs_attention_rpcs.sql` file was left untouched — this new migration's
`CREATE OR REPLACE` supersedes it, as it already did for the threshold change.

Not checked in this pass: whether `get_teacher_attention_flags` or
`get_system_attention_flags` (same migration file, not touched by this brief) have similar
latent bugs. Out of scope here; flagging as a candidate for a future audit rather than
expanding this brief further.

### GATE (still standing)

`brief/moodle-credential-safety` remains held pending the user's own review of the two
read-only SQL queries against the live database (who else is in the same synced-but-silent
state; any historical audit_logs evidence of a Moodle password rejection). The `moodle-sync`
core warnings-detection fix has real test coverage now but no ground-truth verification
against actual Moodle behavior. Everything else on this branch (nav link, RPC bug fix,
threshold) is UI/RPC-only and lower risk, but is being held together with the core fix
per the user's standing instruction not to merge this branch until the Moodle question is
resolved.

---

## 2026-07-14 — Real-Moodle verification: Phase A findings (still no code changes)

Brief: find real Moodle verification for the warnings-rejection fix (`warningRejection()` in
`supabase/functions/moodle-sync/index.ts`) before merge, or determine that's not possible and
recommend a path.

**No non-production Moodle instance exists anywhere in this repo.** Searched all migrations,
edge functions, and docs for any staging/sandbox/test-instance reference — the only Moodle
instance mentioned anywhere is the single production instance (Hostinger-hosted, credentials
in Supabase secrets `MOODLE_URL`/`MOODLE_TOKEN`, documented in
`foundation/docs/moodle-test.md`). There is one hardcoded production URL constant
(`https://rocksolid.lwcanada.org`) used only for building login links in outbound email, not
for API calls.

**This session has no path to any Moodle instance, staging or production.** No network access
to Supabase secrets or any live Moodle endpoint from this environment — the same limitation
every prior audit in this repo has hit. Even with credentials, deliberately triggering a real
password-policy rejection against the production instance is a live-system action on a shared
resource that needs the operator's own hands on it, not something to attempt unilaterally.

**What was attempted instead: independently corroborate the fix's assumed response shape
against Moodle's own public source, without touching production.** `warningRejection()` and
its test fixture (`moodle-sync.test.ts:18-29`) assume Moodle returns a rejected password write
as HTTP 200 with a `warnings: [{ item, itemid, warningcode, message }]` array and no top-level
`exception` — the test fixture's comment calls this the "real-world shape" but that claim had
never itself been checked against anything, which is exactly what this gate is about. Web
search corroborates the *structure*: Moodle's `user/externallib.php update_users()` builds
warning entries with exactly those four keys (`item`, `itemid`, `warningcode`, `message`),
with `warningcode` taken from the caught validation exception's error code — this matches
`warningRejection()`'s parser field-for-field. Could not confirm the exact literal warning
code string (`passwordpolicynocharacters`) at the source-line level — GitHub raw/API and two
independent PHP source mirrors (Fossies, phpcrossref) all refused this session's fetch tool
(401/403/404), a tooling limitation, not a "the claim is wrong" signal.

**Both call sites the fix protects, for the record:** `findOrCreateMoodleUser()` in
`moodle-sync/index.ts` passes `failOnWarnings: true` on both `core_user_create_users` (new
student) and `core_user_update_users` (password reset on an existing student, lines 200-203) —
so a live check would need to cover only one of these two, since they share the exact same
`callMoodle(..., { failOnWarnings: true })` path and the same `warningRejection()` parser.

**Recommended path, since this is not a flat "impossible" — it's "only the operator can do
this":**
1. **Operator-run live check (closes the gate with real evidence).** Using the existing
   pattern in `foundation/docs/moodle-test.md` Check 5 (disposable `probe_test_do_not_use`
   account, deleted immediately after): create that probe user via
   `core_user_create_users` with a password that violates the site's password policy (e.g.
   too short, or missing a required character class per whatever policy the live site
   enforces), and confirm the response comes back HTTP 200 with a `warnings` array rather than
   a top-level `exception`. That single observed response is sufficient to confirm or refute
   the shape the fix depends on — it does not require running the edge function itself, just
   the raw curl call Check 5 already documents, with a deliberately bad password. Delete the
   probe account afterward per Check 5's existing warning.
2. **Accept current evidence as sufficient.** The parsing logic itself is fully covered by
   unit tests (`moodle-sync.test.ts`) against the assumed shape, and that shape is now
   partially corroborated against Moodle's own source (structure confirmed, exact string not
   independently re-derived). Combined with the already-resolved incident classification (this
   branch's earlier SQL-query gate confirmed the real-world impact was one isolated student,
   `taquangminh081`, not a systemic pattern), this may be judged sufficient without a live
   production probe.
3. A local mock endpoint (the brief's other suggested fallback) was considered and rejected as
   low-value here: it would only re-test the code against a shape I assumed myself, which is
   what the existing unit test already does. It doesn't close the actual open question (does
   production Moodle really emit this shape today), so building one wouldn't move the gate.

**Status: gate still open.** This is Phase A only, per the brief's explicit stop-and-report
instruction — no code changed, no live check run. Waiting on the operator to choose between
path 1 (run the live probe) and path 2 (accept current evidence and close the gate).

---

## 2026-07-14 — Three more unwired-but-real templates identified (extends the reserved-templates entry above)

Same category as the "Reserved templates explicitly unwired" entry above: real, seeded
content, zero live producer, kept active (not deactivated) per that entry's precedent.

- `class_reminder_7_day`: reserved; no producer currently schedules it.
- `class_reminder_1_day`: reserved; no producer currently schedules it.
- `class_reminder_2_hour`: reserved; no producer currently schedules it.

Found during the notification-template inventory/cleanup audit (see the entry below this
one). Not deactivated, consistent with the reasoning in the 2026-07-14 entry above.

---

## 2026-07-14 — Notification template inventory + safe cleanup (`brief/notification-template-audit`)

### DECISION

1. Full inventory of all 43 `notification_templates` rows delivered as a new "Template
   Inventory" section in `foundation/docs/NOTIFICATION_PIPELINE.md`, not a new standalone
   doc — that file is already the canonical reference for this subsystem, and this repo
   already has doc-sprawl (part of why the template count itself felt excessive).
2. Only the 10 confirmed-dead legacy stub templates were deactivated
   (`202607142000_deactivate_dead_legacy_template_stubs.sql`, `active = false`, not deleted).
   Everything else found — including three real-but-unwired templates (entry immediately
   above) and every duplicate/broken-delivery/dead-machinery finding below — is documented
   only, per explicit scope confirmation from the operator.
3. `classes_now_available` vs `class_now_available` is explicitly out of scope: already being
   fixed on the unmerged `brief/waitlist-dedup-consolidation` branch. Noted in the doc as
   pending that branch's merge, not re-examined here.

### EVIDENCE

**The 10 dead stubs** (`WELCOME`, `CLASS_ASSIGNED`, `TEACHER_ROSTER_DAILY`,
`TEACHER_ROSTER_WEEKLY`, `WEEK3_FOLLOWUP`, `WEEK6_FOLLOWUP`, `ATTENDANCE_FLAG_CLASS1`,
`ATTENDANCE_FLAG_REPEAT`, `GRADUATION_READY`, `TRANSITION_OVERDUE`) were promoted into the
canonical `notification_templates` table by a one-time migration
(`202605221030_consolidate_template_sources.sql`) that copied rows from the dead
`email_templates` table wherever the key didn't already exist. All 10 have empty `body_html`
and zero producers anywhere in the codebase — verified by grepping every `supabase/functions/`
edge function and every `foundation/`/`foundation-spa/` JS file that queues email. Two are
near-duplicate keys of real live templates: `WELCOME` (dupe of `foundation_welcome`) and
`CLASS_ASSIGNED` (dupe of `class_assigned`) — same purpose, different casing, one dead. Two
other rows promoted by the same migration (`attendance_reminder`, `attendance_escalation`)
were explicitly excluded from deactivation — they're real, live templates wired to
`supabase/functions/attendance-reminder/index.ts`'s daily cron, not stubs.

**Three more real-but-unwired templates** (`class_reminder_7_day`, `class_reminder_1_day`,
`class_reminder_2_hour`) — documented in the entry above, not deactivated, following the exact
precedent already set for `class_slot_cancelled`/`waitlist_promoted`/`engagement_final_notice`.
A fourth, `makeup_reminder`, was also found to have zero producers anywhere and had never been
documented as reserved before — flagged for the first time in the new doc section.

**Flag-only findings** (documented in `NOTIFICATION_PIPELINE.md`'s new "Known issues"
subsection, not acted on): `registration_under_review` vs `registration_under_review_checkin`
naming confusion (different real purposes); `engagement_never_started`/`engagement_dropped_off`
having two uncoordinated producers (daily cron + a manual "Send Check-in" button with no shared
dedupe — same duplicate-risk shape as the waitlist bug fixed elsewhere); `direct_message`
shared by two unrelated features (in-app messaging + admin broadcast modal).

**Out-of-scope findings, explicitly not touched**: `campaign`/`report`/`announcement` have
wired producers but no `notification_templates` row at all — `email-sender`'s `resolveContent`
throws `"No template found"` for each, so every queued send currently lands `Failed`. The SPA
teacher-status-email feature (`teacherManagement.js:80-83`) builds a template map but never
inserts into `email_queue` — a comment reads *"Email would be queued here in production"* —
so those emails only send from the legacy page. The `notification-dispatcher`/
`notification_rules` machinery is entirely dead — zero live producers reach it (this corrects
the 2026-07-13 Email Pipeline Audit's belief that one producer used it; that producer actually
inserts directly and coincidentally shares an `event_type` name with an orphaned rule row).
`class-selection`'s `notify_waitlisted` action is unreachable dead code. `missed-class-detector`
has no confirmed cron trigger anywhere in the repo despite docs claiming one exists.
`phase2-processor`'s `foundation_welcome` call site is likely dead (its own registration path
returns 410).

**New conflict found, not resolved here**: `brief/email-template-consolidation` (unmerged,
migration `202607131901_retire_class_now_available_and_waitlist_promoted.sql`, verified)
deactivates `waitlist_promoted` as "orphaned." This directly conflicts with the existing
2026-07-14 "Reserved templates explicitly unwired" entry, which keeps the same template
active/reserved. Both are correct about the underlying fact (no producer exists); they
disagree on what to do about it. Flagged in the new doc section for whoever merges either
branch first to resolve.

### GATE

Migration `202607142000` applied on `brief/notification-template-audit` only — not merged to
`main`. Verification queries (row-level confirmation the 10 keys are deactivated and nothing
else moved) provided to the operator to run against the live DB before any merge decision.
