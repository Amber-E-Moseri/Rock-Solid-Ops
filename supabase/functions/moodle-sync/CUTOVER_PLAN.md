# MOODLE-SYNC AUTH MIGRATION CUTOVER PLAN

**Status:** Design Only — DO NOT EXECUTE during B3

---

## Pre-Cutover Preparation

### 1. Vault Setup (Admin Task)
- Ensure `CRON_INVOKE_SECRET` exists in Vault / Edge Function Secrets
- Value should be a 32+ character random secret (not reused from any other service)
- Confirm secret is accessible to Edge Function environment

### 2. Production pg_cron Schedule Command (Operator Task)
- Current schedule (expected):
  ```sql
  SELECT cron.schedule('moodle-sync', '*/5 * * * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/moodle-sync'',
      headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb,
      body := ''{}''::jsonb)'
  );
  ```
- New schedule (to be prepared, not executed yet):
  ```sql
  SELECT cron.alter_job(job_name := 'moodle-sync',
    command := 'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/moodle-sync'',
      headers := ''{"Content-Type":"application/json","x-cron-secret":"<CRON_INVOKE_SECRET_VALUE>"}''::jsonb,
      body := ''{}''::jsonb)'
  );
  ```
- **Do not execute yet.**

---

## Cutover Sequence (Zero/Minimal Downtime)

### Phase 1: Deploy Backend (Admin)
**Dependency:** CRON_INVOKE_SECRET in Vault before this step

1. Deploy `admin-api` with new `invoke-moodle-sync` action
   - Backward compatible: existing internal callers not affected
   - New action available but not used yet
   - Status: ✅ Safe to deploy anytime

2. Deploy `moodle-sync` with `validateCronAuth()` gate
   - ⚠️ **CRITICAL:** Existing production cron job will FAIL at this step if x-cron-secret header is not present
   - Must follow immediately with pg_cron schedule update (Step 3)
   - Status: ⚠️ DO NOT deploy until Step 2 below is ready

### Phase 2: Update Production Cron (Operator)
**Dependency:** admin-api and moodle-sync deployed with auth logic ready

3. Execute pg_cron ALTER JOB command in production
   - SQL command prepared in Pre-Cutover step
   - Replaces Bearer auth with x-cron-secret header
   - Should execute in < 1 second
   - Next cron run (within 5 minutes) will use new header
   - Status: ⚠️ OPERATOR ACTION — coordinate with Step 1

### Phase 3: Verify Cron (Admin)
4. Monitor next cron cycle (~5 min after Step 3)
   - Check moodle_enrollment_sync table: new recovery records should appear
   - Check logs: no 401 errors from moodle-sync
   - Check Vault/Edge secrets: confirm secret is correctly supplied
   - Status: ✅ Automated via monitoring

### Phase 4: Deploy Frontend (Admin)
**Dependency:** admin-api deployed and cron verified working

5. Deploy frontend callers to use admin-api proxy
   - Files changed:
     - `foundation/js/admin-api.js` (invokeMoodleSync routes through admin-api)
     - `foundation/js/system-health.js` (Moodle test uses admin-api proxy)
     - `foundation/staff/dashboards.html` (retry uses admin-api proxy)
     - `foundation/staff/moodle-settings.html` (test uses admin-api helper)
   - No secrets exposed to browser
   - Status: ✅ Safe to deploy after Steps 1–3

---

## Rollback Plan (If Cron Breaks)

If Step 3 (pg_cron update) causes issues:

1. **Immediate**: Revert pg_cron schedule to send Bearer token again:
   ```sql
   SELECT cron.alter_job(job_name := 'moodle-sync',
     command := 'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/moodle-sync'',
       headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb,
       body := ''{}''::jsonb)'
   );
   ```

2. **Action**: Revert moodle-sync deployment to pre-auth version
   - Next cron cycle will work with Bearer auth

3. **Investigation**: Check logs for why auth gate rejected the request
   - Missing CRON_INVOKE_SECRET env?
   - Wrong secret value?
   - Header format mismatch?

4. **Retry**: Fix root cause, re-prepare cron command, deploy again

---

## Manual Verification Checklist

- [ ] CRON_INVOKE_SECRET exists in Vault
- [ ] Operator has prepared pg_cron ALTER JOB SQL
- [ ] Admin-api deployed with invoke-moodle-sync action
- [ ] Moodle-sync deployed with validateCronAuth gate
- [ ] pg_cron schedule updated to use x-cron-secret header
- [ ] Next cron cycle produces recovery rows (expected behavior)
- [ ] No 401 errors in moodle-sync logs
- [ ] Frontend code deployed with admin-api routing
- [ ] Manual test: admin clicks "Retry Failed Syncs" → routes through admin-api
- [ ] Manual test: admin visits system-health → Moodle test uses admin-api proxy

---

## Security Guarantees

After cutover:
- ✅ Cron requests authenticated via x-cron-secret (not SERVICE_ROLE_KEY)
- ✅ Browser never receives CRON_INVOKE_SECRET
- ✅ Browser callers must be authenticated + authorized (admin/superadmin only)
- ✅ Admin-api proxy is the trusted intermediary for browser → moodle-sync
- ✅ Service-role key no longer exposed in cron job definition
- ✅ Email delivery to users remains eventual (durably queued, processed by cron)

---

## Post-Cutover Cleanup (Future)

1. Remove old Bearer auth pattern from any other cron jobs still using it
2. Audit all Edge Function Secrets for other exposed credentials
3. Consider rotating SUPABASE_SERVICE_ROLE_KEY (out of scope for this cutover)
