# SPA Cutover Candidate: isolated /app/ preview (2026-10-22)

Branch: `brief/spa-cutover-v2`, based on `origin/main` at `53a961c`.
Status: **HOLD. Not merged, not pushed, not deployed.** Production is unchanged.
Supersedes the 2026-10-21 analysis. That branch is kept as `backup/brief-spa-cutover-pre-rebuild-2026-10-22` (`238f567`).

## 1. Route ownership matrix

The approved hybrid-preview scope: keep `/foundation/` working, serve compiled SPA routes under `/app/`,
and do not replace static login, registration or teacher/staff workflows before authenticated certification.

| Class | Routes | Owner in this candidate |
|---|---|---|
| **A. Required for the isolated preview** | `/app`, `/app/`, `/app/*` (SPA shell, assets, `sw.js`, `registerSW.js`, manifest, icons). SPA Vite base `/app/`, router basename `/app`. Reset-password `redirectTo` `/app/auth/reset-password`. Service-worker scope `/app/`. | SPA (new in this candidate) |
| **B. Required for eventual production cutover (not in this candidate)** | The 37 static staff pages (`/foundation/staff/*.html` and pretty URLs) → SPA routes. `/`, `/staff`, `/auth` → SPA. `/auth/*` → SPA. Production teacher landing in the SPA. Retirement of any static page. | Not changed. Each needs owner approval. |
| **C. Existing static compatibility (unchanged)** | Every `/foundation/` page and asset (the 105-file origin/main baseline). `/` → `/foundation/auth/login.html`. `/staff` → `/foundation/staff/admin-portal.html`. `/auth` → `/foundation/auth/login.html`. `/staff/*` and `/auth/*` 200 rewrites to `/foundation/`. `/supabase/*`, `/ai/*`, `/archive/*`, `/foundation/docs/*` → login. `_headers`. Repository paths are not published. | Origin/main behaviour, byte-identical baseline script |

**Changed from the previous candidate (`44e0ff0`), to match this scope:**
- Removed the 37 staff redirects. They were class B, and they replaced static workflows during preview.
- Restored `/`, `/staff`, `/auth` and `/staff/*`, `/auth/*` to the origin/main behaviour (class C).
- Removed the SPA catch-all `/*` at the root. The SPA is served only under `/app/`.
- Removed `foundation-spa/public/_redirects` and `404.html`. Vite no longer owns Netlify control files.

**Changed from production (`origin/main`):** only additions. `/app/*` is new and serves the SPA. No production URL changes.

## 2. Publish design

`netlify.toml` runs, in order:
1. `node scripts/build-static-publish.mjs`: the origin/main baseline, byte-identical to `origin/main`. It publishes the static `/foundation` tree (105 files including `_headers` and generated `config.js`) and verifies it.
2. `node scripts/build-spa-publish.mjs`: builds the SPA with base `/app/`, copies it to `netlify-static-publish/app/`, copies the root `_redirects`, and verifies the combined output (169 files).

Publish is `netlify-static-publish`, never `.`. Redirects live only in the root `_redirects` (the production rules, moved verbatim, plus `/app` fallbacks). `netlify.toml` has no redirect blocks.

Guards: forbidden paths and content (copied verbatim from the baseline and checked by a parity test), excluded files, repository and environment exclusion, https Supabase URL, anon-key role `anon`, and `BYPASS_ROLE` or `VITE_BYPASS_ROLE` refused in every context. The layer also checks that every repository static page is published, that redirect targets exist, and that the external contract URLs resolve.

## 3. Changed and preserved URLs

- **Changed for production:** none. The candidate is not deployed.
- **Preserved:** every static page under `/foundation/` (58 HTML pages in the repository, all published), including the eight legacy pages (`_template.html`, `shell.html`, `acceptance-tests.html`, five `teacher/sections/*.html`). Nothing is retired.
- **Added:** `/app/*`.
- **Dropped from the candidate:** none. The earlier candidate's 54 omitted files are published again.

## 4. Static-login security PR

- Branch `brief/static-login-next-hardening`, commit `d39ed1e`. **Not merged, not pushed, not deployed.** Needs owner approval.
- The fix: `foundation/auth/safe-next.js` validates `next`. Accepts only same-origin app paths. Rejects whitespace, control characters (C0 and C1), backslashes, protocol-relative and absolute targets, and encoded bypasses in both the raw and decoded value. `login.html` routes `next` through it.
- Tests (`tests/safe-next.test.mjs`, 8 tests, passing): accepted paths; absolute and protocol-relative; backslash ambiguities; raw whitespace and control characters (including U+2028); percent-encoded `%2F%2F`, `%5C`, `%09`, `%0A`, `%0D`, `%20`, `%00`; malformed and oversized input; non-string input; and a wiring check that `login.html` uses the validator.
- **Overlap with cutover v2:** `63f484e` on this branch is the cherry-pick of `d39ed1e`. `git range-diff` shows the two patches are identical. On integration, merge the security branch first. A rebase of the candidate then drops `63f484e` as already applied, so the fix is not duplicated.
- **Open follow-up:** `src/features/auth/postLoginPath.js` holds a copy of the same validator logic for the SPA login. Unify it with `safe-next.js` in a separate change.

## 5. Verification (this branch, `44e0ff0` plus this commit)

| Check | Result |
|---|---|
| SPA Vitest (`foundation-spa`) | 24 files, **161 / 161 pass** |
| Node tests (`tests/netlify-publish.test.mjs`, `safe-next.test.mjs`, `teacher-signout.test.mjs`) | **155 / 155 pass** |
| Baseline build (`build-static-publish.mjs`) | 105 files, allowlist verified |
| Layered build (`build-spa-publish.mjs`) | 169 files, verification passed (staging placeholder configuration) |
| Negative guards, SPA layer | `BYPASS_ROLE` fails; `VITE_BYPASS_ROLE` with `CONTEXT=deploy-preview` fails; `sb_secret_` key fails; `http://` URL fails; service-role JWT fails |
| Negative guard, baseline | `BYPASS_ROLE` fails |
| Output exposure | No repository source, SQL, env, docs, archive or source maps. Top level is exactly `foundation/`, `app/`, `_headers`, `_redirects`. No privileged key text. |
| Emulator routing | 116 route, header and asset subtests (emulator checks for production behaviour, `/app/` and sensitive paths, plus two output checks) pass. Every repository static page loads its local assets, except the known gaps in section 7. |

Browser checks (emulator on the built output, port 8788, not a Netlify deploy):
- `/app/auth/login` hard reload: renders, no console errors.
- `/app/auth/reset-password` (no token): renders, no console errors.
- `/app/staff/dashboards` unauthenticated: redirects to `/app/auth/login?next=%2Fstaff%2Fdashboards`.
- `/foundation/auth/login.html`: renders, no console errors.

Not verified: authenticated sign-in, teacher landing, logout with a session, real reset-password link, role gates, attendance. No staging identities are available. Nothing here is authenticated certification.

## 6. Service-worker findings

- `sw.js` is now at `/app/sw.js` with scope `/app/`. It no longer controls `/foundation/` pages. The earlier root-scope worker would have cache-first'd static foundation JS and `config.js` (caveat C2 of the 2026-10-21 analysis).
- The built worker is a classic script with no imports. Its shell, notification and default URLs come from `self.registration.scope`.
- **Registration fails in the built-in browser pane**, for the built `sw.js` and for a one-line probe worker on the same origin. The failure is "unknown error occurred when fetching the script" and happens inside the pane, not in the worker. Registration is therefore **unverified here**. Check it on a Deploy Preview in a normal browser: `navigator.serviceWorker.getRegistrations()` should show scope `/app/`, and the caches should be `rso-pwa-v1-*`.
- Cache invalidation: bump `SW_VERSION` in `src/sw.js` for each release that changes cached assets. Precache entries are content-hashed.

## 7. Pre-existing production defects (unchanged, not introduced here)

- `/auth/login` hard reload on production is broken. The `/auth/*` static rewrite serves the static login, whose relative assets resolve to `/js/…` and 404. Confirmed on production 2026-10-22. Fixing it changes a production route, so it needs approval.
- `foundation/staff/_template.html` loads `../js/your-page.js`, which 404s on production. Kept as a scaffold (`KNOWN_MISSING` in the tests).
- `foundation/staff/help-guide.html` loads `../images/canada_sr.png`, which 404s on production. The file lives at `foundation/registration/canada_sr.png`.
- `rocksolid.lwcanada.org` is a different deployment (title "Rock Solid — BLW Canada Foundation School"). Its `/foundation/…` paths 404. The attendance-reminder link points there.
- In the SPA, `src/features/dashboards/lib/dashboard.js:273` calls `${window.location.origin}/functions/v1/moodle-sync`. `window.location.origin` is the Netlify site, not the Supabase project, so this call looks broken. Observed in code only, not run.

## 8. Netlify Deploy Preview prerequisites

1. Git-triggered Deploy Preview from a pull request of `brief/spa-cutover-v2`. The preview is not production.
2. Preview environment variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` for a **staging** project. `BYPASS_ROLE` and `VITE_BYPASS_ROLE` unset in every context.
3. Node 22 (`netlify.toml`). The build runs `npm --prefix foundation-spa ci` first.
4. Confirm on the preview: `/app/` loads, `/app/sw.js` registers with scope `/app/`, `/foundation/auth/login.html` is unchanged, `/` redirects to login, and `_headers` applies as expected. `_headers` sets `X-Frame-Options: DENY` on `/foundation/*` and `SAMEORIGIN` on `/*`. Confirm which value the preview serves for `/foundation/…`.
5. Supabase Auth redirect allowlist for the preview host: `https://<preview>/app/auth/reset-password`, and `https://<preview>/foundation/auth/reset-password.html` for the static reset page.
6. Edge Function CORS (`ALLOWED_ORIGINS`) if authenticated preview tests are wanted (B4 of the 2026-10-21 analysis).
7. Staging identities (one admin, one teacher) for authenticated tests. None are available here.

## 9. Remaining blockers

1. Authenticated staging tests, including teacher landing at `/app/teacher/index` and a real reset-password link.
2. Service-worker registration on a real browser and a Deploy Preview (section 6).
3. Netlify header and redirect precedence on the preview (section 8, item 4).
4. Supabase redirect allowlist entries for each host (section 8, item 5).
5. Owner approval of the static-login security PR (`d39ed1e`) before merge.
6. Decide whether the local-main toast fix `72531a3` (11 SPA pages, `useToast()` binding) is needed. It is not on `origin/main`.
7. Teacher and staff branches are not integrated. `brief/teacher-portal-ux` (attendance safeguards) needs separate review.
8. Pre-existing production defects in section 7, for a later approved change.
9. Route-ownership changes B (section 1) need explicit owner approval before any production cutover.

## 10. Rollback

Before any production change, record the current production deploy ID and its commit (`origin/main` at or after `8de0948`). Roll back by publishing that deploy in Netlify. Do not roll back to a root publish (`publish = "."`), which would re-publish the repository.

## 11. GO / NO-GO

- **GO** for opening an isolated Deploy Preview of `brief/spa-cutover-v2`. It adds only `/app/*`, changes no production route, and sets no production environment.
- **NO-GO** for production cutover, and for merging the static-login security PR without approval.
