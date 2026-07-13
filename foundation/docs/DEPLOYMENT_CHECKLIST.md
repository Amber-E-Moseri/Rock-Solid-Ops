# Deployment Checklist

## 1) Pre-deploy Checklist
- [ ] `foundation/js/config.js` created from `foundation/js/config.js.example`
- [ ] `SUPABASE_URL` and `SUPABASE_ANON_KEY` set in runtime config
- [ ] Supabase secrets set:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `ALLOWED_ORIGINS` (include Netlify URL and production domain)
  - [ ] `RESEND_API_KEY`
  - [ ] `MOODLE_URL`
  - [ ] `MOODLE_TOKEN`
  - [ ] `NEXUS_API_URL`
  - [ ] `NEXUS_API_KEY`
  - [ ] `PHASE2_WEBHOOK_SECRET`
  - [ ] `ATTENDANCE_ADMIN_EMAIL` (or `ADMIN_EMAIL`)
  - [ ] `TEACHER_PORTAL_URL`
- [ ] `supabase db push` has been run
- [ ] `supabase functions deploy` has been run
- [ ] `ALLOWED_ORIGINS` includes Netlify deploy URL

## 2) Post-deploy Verification
- [ ] Login works
- [ ] Registration form loads fellowships
- [ ] Admin portal loads
- [ ] Teacher portal loads
- [ ] Email sends within 15 minutes
- [ ] Moodle connection shows green in `system-health`
- [ ] System health checks are all green

## 3) Rollback Steps
1. Revert the Vercel deployment to the previous successful deploy.
2. Re-deploy prior Edge Function versions:
   - `supabase functions deploy <function-name>@<previous-version>` (or redeploy from previous commit).
3. If recent schema migrations caused breakage:
   - Apply a forward fix migration (preferred), or restore DB from maintenance backup.
4. Restore prior `vercel.json` and `_headers` from previous commit and redeploy.
5. Re-run smoke checks: login, registration, admin, teacher, system health.

> Note: this project migrated from Netlify to Vercel. The retired `netlify.toml`
> and its config-generator script are kept for reference in
> `archive/netlify-legacy/`, not at the repo root.
