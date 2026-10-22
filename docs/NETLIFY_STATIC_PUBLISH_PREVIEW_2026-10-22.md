# Netlify static-publish hotfix — preview verification (2026-10-22)

**Status: PREVIEW VERIFIED FOR ROUTING, HEADERS AND EXPOSURE. Production NOT deployed. PR NOT merged.**

## Target

| Item | Value |
|---|---|
| Production Netlify site | `rocksolidsuite` (ID `15899d0b-bf0d-49d0-842a-c621a9295408`, `rocksolidsuite.netlify.app`) |
| Not the target | `rocksolid-staging` (ID `268dac64-e88b-4eb6-81fc-43473ff968cb`). The local `.netlify/state.json` pointed at this site; it was not used. |
| Git link | Production site is linked to `Amber-E-Moseri/Rock-Solid-Ops`, production branch `main`. The Netlify UI build settings still show the old `node scripts/generate-netlify-config.mjs` and publish `.`; `netlify.toml` overrides them. |
| PR | #3, `hotfix/netlify-static-publish-security` → `main` (open, not merged) |
| Deploy Preview | `https://deploy-preview-3--rocksolidsuite.netlify.app`, deploy `6ad96d9e7d90ccf552ad079e`, built from commit `9ff183d` |
| Commit under test | `9ff183d` = `629ffde` + `fix(netlify): keep foundation/staff/_template.html in the publish set` |

The commit requested for verification was `629ffde`. The branch now has `9ff183d` on top. That commit restores `_template.html`, which is live on production today, so the preview tests `9ff183d`.

## Environment (names and scopes only; no values recorded)

| Variable | Scope | Secret flag |
|---|---|---|
| `SUPABASE_URL` | all | false |
| `SUPABASE_ANON_KEY` | all | false. The value is a `sb_publishable_` key, not a secret or service key. |
| `BYPASS_ROLE` | **absent** | — |

## HTTP matrix (preview; response bodies inspected)

| Path | Preview | Production (current, root publish) | Result |
|---|---|---|---|
| `/` | 302 → `/foundation/auth/login.html` | 302, same | Same |
| `/foundation/auth/login.html` | 200, login HTML | 200 | Same |
| `/foundation/auth/reset-password.html` | 200 | 200 | Same |
| `/foundation/auth/teacher-register.html` | 200 | 200 | Same |
| `/foundation/registration/class-selection.html?token=…` | 200 | 200 | Same |
| `/foundation/staff/admin-dashboard.html` | 200, legacy JS redirect shim to `dashboards.html` | 200, same shim | Same. The body differs only by Netlify's injected markup. |
| `/foundation/staff/TeacherAttendancePortal.html` | 301 → `/foundation/staff/teacherattendanceportal` → 200 | 301 → same | Same (existing Netlify pretty-URL behaviour) |
| `/foundation/teacher/index.html` | 200 | 200 | Same |
| `/foundation/js/config.js` | 200, 174 bytes; `SUPABASE_URL`, publishable key, `BYPASS_ROLE: ""` | 200, 174 bytes | Same size; no privileged value |
| `/supabase/config.toml` | 302 → login (body: "Redirecting…") | 302 | Preview: no repo content. See the redirect caveat below. |
| `/foundation-spa/src/App.jsx` | **404** (Netlify HTML 404) | **200, 23,395 bytes of React source** | **Fixed** |
| `/scripts/build-static-publish.mjs` | **404** | 404 | Not exposed in either |
| `/docs/` | **404** | 404 | Not exposed in either |
| `/archive/` | 302 → login | 302 → login | No content in either |
| `/foundation/archive/teacher-availability-react/package.json` | **404** | **200, 456 bytes** | **Fixed** |
| `/foundation/edge-functions/moodle-sync/index.ts` | **404** | **200, 417 bytes of Edge Function SQL source** | **Fixed** |
| `/foundation/sql/README.md` | **404** | **200, 108 bytes** | **Fixed** |
| `/data_backup.sql` | **404** | **200, 0 bytes** | **Fixed** |
| `/.env.local` | **404** | 404 | Not exposed in either |
| `/netlify.toml` | **404** | 404 (Netlify does not serve it) | Not exposed in either |
| `/package.json` | **404** | **200, 59 bytes** | **Fixed** |
| `/.git/config` | **404** | 404 | Not exposed in either |
| `/_headers` | 404 | 404 | Not exposed |

**Redirect caveat.** `/supabase/config.toml`, `/archive/` and `/foundation/docs/*` are answered by redirects to login. The body is `Redirecting to /foundation/auth/login.html`, and the file is absent from the artifact. The redirect alone does not prove exclusion. Exclusion is proven by the 404 results and the artifact file list.

## Headers (preview vs production, `/foundation/auth/login.html`)

Both return the same policy: `Content-Security-Policy` (`default-src 'self'`, with `esm.sh` and `cdn.jsdelivr.net` allowed for scripts), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone and geolocation disabled), and `Strict-Transport-Security`.

The preview also sends `X-Robots-Tag: noindex`, which Netlify adds to deploy previews. Production does not send it on this path.

Netlify's own checks on the PR: `Header rules` pass, `Redirect rules` pass, `netlify/rocksolidsuite/deploy-preview` pass.

## Browser checks

| Page | Viewport | Result |
|---|---|---|
| Login | 375×812 | Renders correctly |
| Login | 1280×800 | Renders correctly |
| Registration form | 375×812 | Renders correctly |
| Teacher index, unauthenticated | desktop | Redirects to login with `?next=` (auth guard works) |
| Admin dashboard shim, unauthenticated | desktop | Redirects to login (guard works) |

Console:
- Preview only: `Framing 'https://app.netlify.com/' violates the Content Security Policy` (Netlify's deploy-preview toolbar). Not present on production.
- **Preview and production:** `chart.umd.min.js` from `cdnjs.cloudflare.com` is blocked by the CSP `script-src` on `dashboards.html`. This is a pre-existing defect, not introduced by this hotfix. The dashboard charts do not load.
- Class selection with a placeholder token: `Failed to fetch` for the Supabase/Edge call. Expected with that token.

## Not verified (release gates)

| Check | Status |
|---|---|
| Staff/admin sign-in and admin dashboard data | UNVERIFIED: no test credentials supplied |
| Teacher sign-in, teacher attendance submission | UNVERIFIED: no test credentials supplied |
| Class selection with a real token | UNVERIFIED: no real token |
| Email-linked URLs from live sends | UNVERIFIED: only the URL paths were checked |
| Mobile rendering of teacher and admin pages | UNVERIFIED (only login and registration checked at 375px) |
| Production rollout | Not authorised |

## Remaining risks

1. **The repository is public on GitHub** (`Amber-E-Moseri/Rock-Solid-Ops`). Source, migrations, `archive/` and docs are already visible there. The Netlify hotfix does not change that.
2. **Production is exposed today.** Production returned `200` for `/foundation-spa/src/App.jsx`, `/foundation/edge-functions/moodle-sync/index.ts`, `/foundation/sql/README.md`, `/package.json`, the archived `package.json` and `/data_backup.sql`. The preview closes these.
3. **The production build will fail if `BYPASS_ROLE` is set.** It is absent now.
4. **Netlify UI build settings are stale** (`generate-netlify-config.mjs`, publish `.`). `netlify.toml` overrides them. Update the UI settings before production so the dashboard matches the file.
5. **A pre-existing CSP rule blocks Chart.js** on the dashboards. Changing it changes CSP semantics, which needs owner approval.
6. **A publishable anon key appears in git history.** Two anon-role JWTs were decoded; none had `service_role` or `sb_secret_`. Anon keys are public by design, so rotation is optional.

## Production prerequisites before a separate approval

- Confirm the Netlify UI build command and publish directory match `netlify.toml`, or clear them.
- Confirm `BYPASS_ROLE` remains absent.
- Run staff and teacher sign-in on the preview with test accounts.
- Decide whether `env-check.html`, `acceptance-tests.html` and `clickup-management.html` stay published.
- Decide whether to fix the Chart.js CSP block in the same release or separately.

## Rollback

Netlify UI: Deploys → select the last production deploy from before the hotfix → **Publish deploy**. This restores root publishing, which exposes the repository. Follow it with a corrected allowlist.
