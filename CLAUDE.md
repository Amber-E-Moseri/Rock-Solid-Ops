# CLAUDE.md — Foundation School Platform

> This file lives at the project root so Claude reads it automatically on every session.
> Keep it updated as the platform evolves. See `/ai/*.md` for extended reference docs.

---

## What this project is

Foundation School is an internal staff operations platform backed by Supabase. It manages
student registration, teacher scheduling, attendance, notifications, Moodle enrollment, and
batch cohort management. It is NOT a public SaaS product — it is an internal tool used by
admins and teachers.

**Current state (May 2026):** Backend migration to Supabase is complete. Legacy Google Apps
Script backend is archived and non-operational. The platform is in stabilization and
hardening mode, moving toward a pilot launch.

---

## Before you write a single line

Read these files in order:

1. `/ai/constraints.md` — hard engineering constraints (never violate these)
2. `/ai/statuses.md` — canonical status enums for registration, batches, teachers, email
3. `/foundation/docs/ARCHITECTURE.md` — current backend and frontend canonical state
4. `/foundation/docs/KNOWNBUGS.md` — open bugs; do not introduce workarounds that conflict
5. `/foundation/docs/NEXT_STEPS.md` — current release priorities
6. `/ai/refactor-roadmap.md` — phased stabilization plan; respect the phase order

If you are working on a specific subsystem (auth, registration, notifications, retry, teacher
portal, admin portal), also read the relevant edge function source before touching anything.

---

## Architecture rules (non-negotiable)

### Backend
- **Supabase is the only backend.** Never reintroduce Apps Script, Google Sheets, or any
  legacy backend call. `archive/apps-script-legacy/` is read-only historical reference.
- All data lives in Postgres tables in the `public` schema unless explicitly scoped otherwise.
- All auth uses Supabase Auth sessions and JWTs. Never bypass or mock auth.
- All access control uses RLS policies on Supabase tables. Client-side role checks are
  supplementary UI hints only — they are never the enforcement point.
- All business logic belongs in Supabase Edge Functions or Postgres RPCs. Never add business
  logic to frontend JS files.
- All audit events write to `public.audit_logs`. Never create a parallel audit table.
- Canonical registration pipeline is `registration-processor` edge function only. There is
  no second registration path.

### Frontend
- Canonical app root: `/foundation`
- Admin/staff pages: `/foundation/staff/`
- Teacher pages: `/foundation/teacher/`
- Auth pages: `/foundation/auth/`
- Do not create pages outside these paths or add new top-level routes to `vercel.json`
  without explicit instruction.

### Migrations
- Every schema change needs a migration file in `/supabase/migrations/`.
- Naming: `YYYYMMDDHHMMSS_short_description.sql`
- Migrations must be additive. Never drop or rename columns without a compatibility migration.
- Every new user-facing table needs RLS enabled and policies for each role that touches it.
- Test idempotency: use `IF NOT EXISTS`, `IF EXISTS`, `OR REPLACE` throughout.

---

## What you are allowed to change

Unless explicitly told otherwise:

| Area | Allowed |
|---|---|
| `/foundation/staff/*.html` | Yes — UI fixes, refactors, shell adoption |
| `/foundation/js/*.js` | Yes — modularization, bug fixes |
| `/foundation/ui/*.css` | Yes — token fixes, shared component work |
| `/foundation/auth/` | Yes — but preserve auth flow exactly |
| `/supabase/functions/*/index.ts` | Yes — but preserve all API contracts |
| `/supabase/migrations/` | Add new files only — never edit existing |
| `/foundation/js/config.js` | **Never commit real credentials here** |
| `/archive/` | Read-only. Never modify. |
| `/ai/*.md` | Update only when architecture decisions change |
| `vercel.json` | Only with explicit instruction |

---

## What you must never do

- **Never commit real Supabase URLs or anon keys.** `config.js` is gitignored — if you
  write it, use the placeholder from `config.js.example`.
- Never reintroduce dual-backend logic. No `if (mode === 'legacy')` branches anywhere.
- Never add a new registration pipeline. One pipeline, one truth.
- Never enroll a WAITLISTED student in Moodle. Only ASSIGNED students get Moodle enrollment.
- Never silently overwrite a duplicate registration. DUPLICATE status must be preserved and
  surfaced to admins.
- Never drop RLS from a table. If you add a table, you must add RLS policies.
- Never do a giant rewrite. Work incrementally. Preserve working flows.
- Never create a new design system. The design system is `batch-management.html`.
- Never add a duplicated nav/topbar. Use `admin-shell.js` for admin pages.

---

## UI standards

**Canonical visual reference:** `foundation/staff/batch-management.html`

When building or updating any staff page, match this page's:
- Typography: Manrope font, loaded from Google Fonts
- CSS: import `premium-theme.css`, `components.css`, `layout.css`, `admin-shell.css`
- Color tokens: use `var(--color-*)` CSS variables from `tokens.css`; never hardcode hex
- Dark mode: every page must respect `data-theme="dark"` on `<html>`; toggle via moon emoji
- Shell: admin pages use `admin-shell.js` for nav, topbar, auth handling, and theme toggle
- Cards: rounded (`--r-xl`), soft shadow (`var(--sh-xs)`), warm surface background
- Status badges: use `.fs-badge` + a variant class (`.fs-badge-success`, `.fs-badge-warning`,
  `.fs-badge-danger`, `.fs-badge-info`, `.fs-badge-neutral`, `.fs-badge-primary`) from
  `primitives.css`. `class="chip"` is banned by the pre-commit hook and by
  `foundation/docs/CSS_MIGRATION_GUIDE.md` — do not reintroduce it.
- Loading: skeleton states before data loads; never blank pages
- Toasts: use shared toast system; never `alert()`
- Mobile: tables must have a card-view fallback at narrow viewports (< 640px)

**Avoid:**
- Generic Tailwind CDN dashboards
- Inline `style=""` blocks for anything that belongs in shared CSS
- Per-page nav markup
- `font-family` declarations outside the shared CSS
- Gradients that are not in the design token set

---

## JS module rules

The goal is to reduce inline JS. When working on a staff page:

- Auth and session: use `../auth/auth-client.js` and `../auth/auth-guards.js`
- API calls: use `../js/api-client.js` (wraps Supabase client)
- Admin API helpers: use `../js/admin-api.js`
- Shell/nav: use `../js/admin-shell.js`
- Toasts: use `../js/toast.js`
- Modals: use `../js/modal.js`
- Utils: use `../js/utils.js`

Do not duplicate any of the above in a page's inline `<script>`. If a helper does not exist
in a shared module yet, add it to the correct module file — do not inline it.

When extracting JS from a page, extract one logical block at a time. Do not rewrite the
entire page's JS in one pass.

---

## Edge function rules

- Every edge function must call `createClient` with the service role key from `Deno.env`.
  Never use the anon key server-side.
- Every privileged action must verify the caller's JWT and profile role before proceeding.
  Use helpers from `shared-utils/edge-hardening.ts`.
- All writes should be idempotent. Use upsert with conflict targets where possible.
- Classification: use `classifyError()` from `shared-utils/edge-hardening.ts` to decide
  retryability. Do not invent new retry logic inline.
- Every significant workflow step must write an `audit_logs` row with `action`, `actor_id`,
  `target_id`, and `metadata`.
- CORS: set `Access-Control-Allow-Origin` appropriately; never use `*` for authenticated
  endpoints.

---

## Retry and queue rules

- `retry-worker` runs on an hourly cron (`0 * * * *`). Do not add a second retry scheduler.
- Retryable: network timeouts, transient DB errors, rate limits.
- Non-retryable: auth failures, WAF blocks, missing Moodle mapping, invalid input.
- Moodle HTTP 403 / WAF failures are classified as non-retryable — do not loop on them.
- Manual retry from the Retry Center is the operator escape hatch for stuck records.

---

## Security checklist (run before any PR)

- [ ] No real credentials in any committed file
- [ ] Every new table has RLS enabled
- [ ] Every new privileged edge function verifies JWT role server-side
- [ ] No new client-side role enforcement added as the sole guard
- [ ] No legacy backend references reintroduced
- [ ] `config.js` is not staged (`git status` check)
- [ ] Migration is additive and idempotent

---

## Status enums (never invent new values without updating `/ai/statuses.md`)

```
Registration:    PENDING | ASSIGNED | WAITLISTED | DUPLICATE | REVIEW | INACTIVE | COMPLETED
Availability:    CLASS_ASSIGNED | CLASS_FULL | NO_MATCHING_TIME | MANUAL_REVIEW_REQUIRED
Batch:           DRAFT | ACTIVE | UPCOMING | COMPLETED | ARCHIVED
Teacher avail:   PENDING | APPROVED | REJECTED | RESET
Email types:     foundation_welcome | duplicate_registration | waitlist_confirmation |
                 registration_under_review | no_suitable_times | no_class_available
```

---

## How to scope your work

Follow the AI workflow from `/ai/ai-workflow.md`:

1. **One subsystem per session.** Do not touch registration and notifications in the same pass.
2. **State what files you will change** before changing them.
3. **Return a test checklist** after every change — what should the human verify manually.
4. **Preserve behavioral parity.** If you are refactoring a page, the user should not notice
   any functional difference.
5. **When context degrades** (long session, conflicting instructions), stop and start a new
   chat. Do not keep generating with degraded context.

---

## Git workflow — branch-per-brief (standing policy, adopted 2026-07-13)

Every brief (a scoped unit of work handed to Claude, typically one subsystem pass) gets its
own branch. This replaced an earlier lock-file-based approach to avoid parallel-session
collisions on the same working tree.

1. **Create** a branch named `brief/<short-description>` off `main` before starting work.
2. **Commit** incrementally as work completes — do not batch an entire brief into one commit
   if it has logically separate parts (e.g. a feature vs. an unrelated cleanup hunk that
   happened to land in the same file).
3. **Merge to `main` in the same session**, once the brief's gate (if any) is confirmed.
   Do not leave briefs half-merged across sessions — a stale unmerged branch is harder to
   reconcile than a same-session merge.
4. **Delete the branch** after merging. Branches are scoped to a single brief's lifetime, not
   long-lived feature branches.
5. If a security boundary (RLS, edge-function auth, role checks) is touched, present a gate
   for confirmation before merging — see `docs/migration-log.md` for the gate format used in
   prior briefs.
6. **Before merging, confirm `main` hasn't moved**: run `git log main -1` (or equivalent) and
   check its tip against what you last synced your branch against. If it's moved, rebase your
   branch onto the new tip and re-verify isolation (the same diff-check used for the C.1/C.2
   split) before merging — don't merge against a stale assumption of what `main` contains.
   Worktree-per-brief protects in-progress branch work from cross-session interference, but
   `main` itself is still a shared, unprotected merge point — a same-day collision there
   (a commit landing mid-session, from outside it) has already happened once.
7. **Any explicit human hold or gate must be recorded durably in the repo, not just in chat.**
   Add or update a file-based marker the next session will see without conversational context:
   append the hold to `docs/migration-log.md` and, if the branch must not be merged yet,
   add/update an entry in `docs/BRANCH_HOLDS.md`. Sessions do not share chat history; a hold
   that exists only in one conversation is invisible to every other session and must be
   treated as missing until written to the repo.

### Use a dedicated worktree per brief (standing rule, adopted 2026-07-13)

Do **not** run a brief from the shared checkout. When another session is (or may be) active,
two sessions sharing one working tree share one `HEAD` — a branch switch or commit in one
lands in the other's tree, and commits can end up on the wrong branch. Instead, give each
brief its own `git worktree`:

```
git worktree add ../rso-<brief-name> brief/<brief-name>
```

Work entirely inside that worktree directory; run `git worktree remove` after the branch is
merged and deleted. This isolates each brief's `HEAD` and working files so parallel sessions
cannot collide. (Adopted after a session's commit landed on a parallel session's branch
because both were operating in the same checkout.)

Verify claims inherited from prior migration-log entries (e.g. "needs a rebuild," "reference
implementation is proven") before acting on them — this repo has had stale/overstated
descriptions corrected only after someone actually checked (the Nexus push-sender claim,
`rocksolid-management.html`'s CSS-token claim, which turned out to be a two-variable fix plus
an unrelated pre-commit-hook violation the log entry never mentioned, and `constraints.md.txt`
being described as having "different structure" from `constraints.md` when it didn't).

When comparing file contents for a tracking/duplicate decision (is this file stale, is it a
real duplicate, did a rename preserve content), diff whitespace- and encoding-insensitively
(`diff -b`, or equivalent) before concluding two files differ. Two of the corrections above
trace back to exactly this: a plain `diff` treating every line as changed because of
CRLF/LF or BOM noise, not real content drift.

---

## Current open bugs (do not make them worse)

| Bug | Location | Status |
|---|---|---|
| CLASS_OPTIONS creation failure on approval flow | `phase2-processor`, admin-review | Open |
| Multi-campus label shows only last campus | batch-management calendar header | Open |
| Large tables overflow on mobile | `admin-management.html`, others | Open |
| Moodle HTTP 403 / WAF blocks enrollment sync | `moodle-sync` edge function | External dependency |

---

## Immediate priorities (May 2026)

1. Confirm `registration-processor` is the only active pipeline in production (release blocker)
2. Rotate and never re-commit the anon key found in `config.js`
3. Apply `202605071800_audit_logs_canonicalization.sql` migration if not yet applied
4. Confirm `retry-worker` scheduled invocation is active in the deployed project
5. Fix CLASS_OPTIONS creation failure in approval flow
6. Fix mobile table overflow in `admin-management.html`
7. Complete `admin-shell.js` adoption across all staff pages

---

## Reference

| What | Where |
|---|---|
| Canonical UI | `foundation/staff/batch-management.html` |
| Auth client | `foundation/auth/auth-client.js` |
| Auth guards | `foundation/auth/auth-guards.js` |
| Admin shell | `foundation/js/admin-shell.js` |
| Shared CSS | `foundation/ui/premium-theme.css`, `components.css`, `layout.css`, `tokens.css` |
| API client | `foundation/js/api-client.js` |
| Edge hardening | `supabase/functions/shared-utils/edge-hardening.ts` |
| Retry worker | `supabase/functions/retry-worker/index.ts` |
| Registration | `supabase/functions/registration-processor/index.ts` |
| Migrations | `supabase/migrations/` |
| Architecture | `foundation/docs/ARCHITECTURE.md` |
| Known bugs | `foundation/docs/KNOWNBUGS.md` |
| Next steps | `foundation/docs/NEXT_STEPS.md` |
| Status enums | `ai/statuses.md` |
| Constraints | `ai/constraints.md` |
