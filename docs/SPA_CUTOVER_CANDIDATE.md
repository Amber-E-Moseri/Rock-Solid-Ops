# SPA Cutover Candidate (2026-10-22)

Branch: `brief/spa-cutover-v2`, based on `origin/main` at `53a961c`.
Status: **HOLD. Not merged, not deployed.** Production is unchanged.
This candidate replaces the 2026-10-21 cutover work on `brief/spa-cutover`. That branch is kept as
`backup/brief-spa-cutover-pre-rebuild-2026-10-22` (`238f567`). Its 21 commits are not imported.

## 1. Baseline and ancestry

- Production baseline is `origin/main`. Its Netlify allowlist is `scripts/build-static-publish.mjs`
  (hotfix PR #3), which publishes an allowlisted directory, never the repository root.
- The candidate starts from `origin/main` and adds only:
  - `dc4070f` the teacher sign-out test (`238f567`, cherry-picked);
  - `63f484e` the static-login `next` fix (same change as `d39ed1e` on `brief/static-login-next-hardening`);
  - the SPA cutover commits listed in section 9.
- `brief/teacher-portal-ux` is not imported. Only its pure access matrix `routeRoles.js` was ported.
- Local `main` (22 commits, unpushed, including C1 and Moodle retry work) is not a base for this candidate.

## 2. Unified Netlify publish design

| Element | Setting |
|---|---|
| `netlify.toml` | `publish = "netlify-static-publish"`, build `npm --prefix foundation-spa ci && node scripts/build-spa-publish.mjs`. No `[[redirects]]`. |
| Publish inputs | `foundation-spa/dist` (SPA), `_headers`, and only the static closure of `scripts/netlify-site-allowlist.json` (50 files), plus a generated `foundation/js/config.js` written into the publish directory only. |
| Guards | Copied verbatim from `build-static-publish.mjs`: forbidden paths, forbidden content (`sb_secret_`, `service_role`, private keys, secret names such as CRON_INVOKE_SECRET and NEXUS_TASK_API_KEY), excluded files, https URL, anon-key role `anon`. |
| Bypass | `BYPASS_ROLE` and `VITE_BYPASS_ROLE` refused in **every** context. Verified: 2 negative runs fail. |
| Redirects | One source: `foundation-spa/public/_redirects`. Each retired static page has a `.html` rule and a pretty-URL rule, both forced `302!`. |
| Repository exclusion | Source, SQL, env, docs, archive, `node_modules`, source maps and `_headers`/`_redirects` as files are never copied. Repository paths answer `404!`. |
| Retention | Every static page in `foundation/` is either published or redirected. Retiring one requires an entry in `approvedRetirements`, which is empty. |

The build verifier checks that closure is complete, links resolve, the external contract URLs resolve,
redirect targets exist, and no forbidden file or value is published. Its failures stop the build.

Dropped from the production publish set (54 files, all deliberate):
- 37 staff HTML pages: replaced by SPA routes through 302 rules (`.html` and pretty URL).
- 16 staff JS modules and `foundation/ui/rocksolid-nav.js`: loaded only by those pages. Checked by grep.
  `auth-client.js` mentions some of them only in a comment.

Added: `foundation/auth/safe-next.js` (the login validator), and `foundation/js/config.js` (generated).

## 3. Static-to-SPA route matrix

| URL class | Result |
|---|---|
| `/` | 302 → `/foundation/auth/login.html` (unchanged) |
| `/auth`, `/auth/login.html`, `/auth/reset-password.html` | 302 → `/auth/login`, `/auth/login`, `/auth/reset-password` (SPA) |
| `/auth/login`, `/auth/reset-password`, `/auth/*` | SPA shell. The static `/auth/*` rewrite is removed (B2 decision, see section 4). |
| `/staff`, `/staff/*`, `/teacher/*` | SPA (`/staff` → `/staff/admin-portal`) |
| 36 staff `.html` pages and their pretty URLs | 302 → SPA route (query string preserved) |
| `/foundation/staff/login(.html)` | 302 → `/foundation/auth/login.html` |
| `/foundation/auth/login.html`, `reset-password.html`, `teacher-register.html`, `/foundation/index.html` | Static, published |
| `/foundation/teacher/index.html`, `roster.html`, `teacher-attendance.html`, `teacher-availability.html`, `teacher-progress.html` | Static, published |
| `/foundation/registration/class-selection.html`, `registration-form.html`, `canada_sr.png` | Static, published (email and Edge links) |
| `/foundation/staff/TeacherAttendancePortal.html`, `env-check.html` | Static, published |
| **Eight legacy pages, kept (see section 5)** | Static, published |
| `/foundation/docs/*`, `/supabase/*`, `/ai/*`, `/archive/*` | 302 → login (unchanged) |
| Repository paths (README, CLAUDE, package.json, netlify.toml, `.env*`, `scripts/*`, `docs/*`, `foundation-spa/*`, `foundation/sql/*`, `foundation/archive/*`, `_headers`, `_redirects`, `netlify-static-publish/*`) | 404, forced |
| Other `/foundation/*` with no file | 404 |

## 4. Authentication, landing and logout

- **Hard reload of `/auth/login`** now loads all assets (verified in the emulator, section 7). The static
  `/auth/*` rewrite is removed. Its relative assets (`../js/…`) resolved to `/js/…` and 404'd, so the
  page showed "Configuration is missing". This is also broken on production today.
- **Decision B2 (recorded here, owner may reverse):** the SPA owns `/auth/*`. Teachers and Edge links keep
  using the static `/foundation/auth/login.html`. There are still two login pages, as before.
- **Teacher landing (B1):** `postLoginPath` sends a teacher to `/teacher/index` always. Staff roles
  follow a validated `next`, then the role landing from the shared matrix (`src/routing/routeRoles.js`,
  ported from `brief/teacher-portal-ux`). `HomeRedirect` handles `/` and unknown paths the same way.
  Roles with no landing go to `/staff/dashboards`, where `ProtectedRoute` shows the pending or unauthorized notice.
- The matrix is not yet the single source for every `App.jsx` guard. `/staff/data-exports`,
  `/staff/attendance`, `/staff/at-risk-students` and others are guarded only in `App.jsx`. Migrating them is a follow-up.
- **Next handling:** `LoginPage` no longer decodes `next` a second time. `safeNextPath` rejects
  whitespace, control characters, backslashes, protocol-relative and absolute targets, and encoded bypasses.
- **Reset password:** the SPA `redirectTo` is `/auth/reset-password`, now served by the SPA. The static reset
  page (`/foundation/auth/reset-password.html`) also still works. Both must be in the Supabase redirect allowlist (B3).
- **Logout:** SPA logout goes to `/auth/login`. Static logout (`auth/logout.js`) goes to the static login
  with `next` set to the current page. Both were checked in code. Neither was run with a session.
- **Dev showcase:** the `/dev/showcase` route is registered only in development builds (`import.meta.env.DEV`). The lazy showcase module (`ShowcasePage`) still appears in the production bundle, so this is a route gate, not code removal. Not yet verified in a browser.

## 5. Legacy pages (eight retained, none retired)

| Page | Status | Required assets |
|---|---|---|
| `staff/_template.html` | 200 | Loads `../js/your-page.js`, a placeholder that already 404s on production (`knownMissingReferences`) |
| `staff/shell.html` | 200 | All in closure |
| `staff/acceptance-tests.html` | 200 | All in closure |
| `teacher/sections/attendance.html` | 200 | All in closure |
| `teacher/sections/availability.html` | 200 | All in closure |
| `teacher/sections/my-class.html` | 200 | All in closure |
| `teacher/sections/teacher-home.html` | 200 | All in closure |
| `teacher/sections/teacher-messages.html` | 200 | All in closure |

Retiring any of them needs owner approval, recorded in `approvedRetirements`. None is approved.

## 6. Legacy URL inventory (who points at what)

- Edge Functions: `class-selection` and `waitlist-processor` link to `/foundation/registration/class-selection.html`; `report-generator` links to `canada_sr.png`.
- Migrations (email templates): `/foundation/auth/login.html` (8 references), `/foundation/registration/class-selection.html` (4), `canada_sr.png` (27), and the root of `https://rocksolid.lwcanada.org/` (10).
- **`rocksolid.lwcanada.org` (audit, 2026-10-22):** the root returns 200 with the title "Rock Solid — BLW Canada Foundation School". Its `/foundation/...` paths (TeacherAttendancePortal, class-selection, auth login) return 404. It is a different deployment. The `attendance-reminder` default TEACHER_PORTAL_URL points at it, and it is not served by this site. The owner must confirm which host is canonical.

## 7. Verification

**Automated (this branch, `53a961c` plus candidate commits):**
- SPA tests: `vitest run`, 24 files, 161 tests, all passing. Includes the sign-out test and `postLoginPath` tests.
- Node tests: `node --test tests/netlify-publish.test.mjs tests/safe-next.test.mjs tests/teacher-signout.test.mjs`, 110 tests, all passing.
  Covers guard parity with the baseline, bypass and key refusals, `_redirects` rules (pretty URLs included),
  `_headers`, the allowlist, published-output exposure, and emulator route and asset checks.
- Build: `node scripts/build-spa-publish.mjs` with staging placeholder configuration. 116 files, closure 50.
- Negative guards (each fails the build): `BYPASS_ROLE`, `VITE_BYPASS_ROLE` (with `CONTEXT=deploy-preview`),
  `sb_secret_` anon key, service-role JWT, `http://` Supabase URL.

**Browser (local emulator `scripts/netlify-emulator.mjs` on the built output, not a Netlify deploy):**
- Hard reload `/auth/login`: SPA login renders at 375px and 1280px; all assets 200; no console errors except service worker (below).
- `/auth/reset-password` (no token): renders the expected "invalid or already used" state.
- `/foundation/auth/login.html`: renders at 1280px with no console errors.
- `/foundation/teacher/index.html` (unauthenticated): redirects to the static login with `next`.
- `/staff/dashboards` (unauthenticated): redirects to `/auth/login?next=%2Fstaff%2Fdashboards`.
- `/foundation/registration/class-selection.html` (no token): "invalid link" state at 375px. The "Loading…" label
  stays visible. This is pre-existing and not changed here.
- **Not verified:** service worker registration. The browser pane fails to register `/sw.js` even when the script loads as a page
  (`curl` returns 200). Check on a Netlify Deploy Preview.

**Not verified (no staging identities):** teacher and admin sign-in, teacher landing at `/teacher/index`, logout with a session,
reset-password with a real recovery link, role gates, and attendance workflows. Nothing here is authenticated certification.

## 8. Remaining blockers

1. **Authenticated staging tests** (B7) with staging-only identities, including the teacher landing and reset-password link.
2. **Supabase redirect allowlist** (B3): add `…/auth/reset-password` and `…/foundation/auth/reset-password.html` for the production and preview hosts.
3. **Netlify precedence and duplicate headers:** `_headers` sets `X-Frame-Options: DENY` on `/foundation/*` and `SAMEORIGIN` on `/*`. Confirm on a Deploy Preview which one is served. Confirm that the single `_redirects` source behaves as expected.
4. **Service worker registration** in a real browser (section 7).
5. **Owner decision on the `lwcanada` host** and the attendance-reminder link (section 6).
6. **Owner approval of the static-login security change** (`brief/static-login-next-hardening`, `d39ed1e`). It is included here by cherry-pick, but it is not merged to `origin/main`.
7. **Toast binding fix:** `72531a3` (`useToast()` bound in 11 SPA pages) is on local `main` only. Decide whether the cutover needs it.
8. **Teacher attendance parity:** `brief/teacher-portal-ux` has attendance safeguards not on `origin/main`. They are not imported. The static teacher pages stay in use.
9. Full `App.jsx` guard migration to the shared matrix (follow-up).

## 9. Commits on this branch

- `dc4070f` test(spa): cover teacher sign-out from the shared shell (cherry-pick of `238f567`)
- `63f484e` fix(auth): validate static login next redirects (cherry-pick of `d39ed1e`)
- Feature commits for the SPA landing and routing, the unified publish design and this document (see `git log`).

Nothing is pushed or merged. No production Netlify, Supabase or DNS setting was changed. C6 and PR #6 are untouched.

## 10. Rollback (corrected)

The 2026-10-21 rollback step ("Publish deploy" on the static root publish) is wrong. It would re-publish
the repository root, which the hotfix removed.

1. Before any cutover, record the current production deploy ID and its commit (`origin/main` at or after `8de0948`).
2. Roll back by publishing that deploy again in Netlify. No code change is needed.
3. Clear `rso-pwa-*` caches (or bump `SW_VERSION`) for browsers that visited the SPA.
4. Keep the 302 rules until production is verified. Switch to 301 in a separate change.

## Decision record

- **Static-login open redirect:** a leading `/` followed by a tab or newline bypassed the `//` check, giving a
  protocol-relative redirect. Fixed by `safe-next.js` (`63f484e`). Verified against the WHATWG URL parser in tests.
- **Teacher dead-end (B1):** fixed in the SPA login (`postLoginPath`) and in `HomeRedirect`.
- **Two login pages (B2):** the SPA owns `/auth/*`. The static login remains at `/foundation/auth/`.
- **`BYPASS_ROLE` guard:** applied in every context, matching the hotfix.
- **Eight legacy pages:** retained, not retired.

**Recommendation: NO-GO for production.** The candidate is ready for a git-triggered Deploy Preview and for
authenticated staging tests. Blockers 1 to 7 in section 8 must be closed first.
