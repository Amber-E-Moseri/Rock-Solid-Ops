# Current Known Issues
## Recently Resolved (May 2026)
- Teacher dashboard "Students in class" undercount when a teacher had multiple classes:
  fixed by aggregating unique `students.student_id` across assigned `class_option_id` values.
- Teacher "My Class" non-2xx edge error from `teacher-portal-api`:
  fixed by migrating milestone lookup from legacy `student_milestones` to `student_milestone_status`.
- Reports workspace "Failed to send a request to the Edge Function":
  fixed by applying request origin handling in `report-generator` (`applyAllowedOrigin(req)`).
- Auth runtime config false-negative on module load:
  fixed by reading `window.FS_CONFIG` directly first in `auth-client.js`, then validating via `FSConfig`.
## Scheduler
### CLASS_OPTIONS Creation Failure
- Approval flow sometimes fails to create CLASS_OPTIONS rows.

### Multi-Campus Labeling Bug
- Calendar header sometimes shows only the last selected campus.

## Mobile UI Issues
### Grid Overflow
- Large tables overflow badly on mobile.

## Moodle Integration

### HTTP 403 Errors
Possible causes:
- WAF blocking external integration endpoints
- Missing API permissions
- REST protocol disabled

Canonical source of truth:
- Moodle sync queue/state table: `public.moodle_enrollment_sync`
- Audit table: `public.audit_logs`

---

## MOODLE_TROUBLESHOOTING

This section describes each `failure_reason` code written by the `moodle-sync` edge
function, what it means, and the exact steps to resolve it.

Use the SQL query in `foundation/docs/moodle-test.md` to see which codes are appearing.

---

### MOODLE_WAF_BLOCK

**What it means:**
A Cloudflare or other WAF (Web Application Firewall) sitting in front of the Moodle
instance blocked the request from Supabase Edge Functions before it reached Moodle.
Detected by: `CF-Ray` header present, `Server: cloudflare` header, or response body
contains "cloudflare" text without a JSON `exception` key.

**Retryable:** Yes � WAF blocks are transient and the retry-worker will attempt again.
However, repeated blocks mean the WAF rule is persistent and must be fixed at the source.

**Hostinger/Moodle admin steps:**
1. Log into your Hostinger hPanel.
2. Go to **Security ? WAF** (or **Advanced ? Web Application Firewall** depending on plan).
3. Look for blocked requests in the WAF log � filter by the Supabase Edge Function IP range
   or by the Moodle endpoint path (`/webservice/rest/server.php`).
4. Add an exception/whitelist rule for requests to `/webservice/rest/server.php` from
   Supabase's IP ranges, OR whitelist by the `User-Agent` header sent by the function.
5. Alternatively, disable WAF rules specifically for the web service endpoint path.

**Who to contact at Hostinger:**
Hostinger support chat at hpanel.hostinger.com ? Help ? Live Chat. Ask specifically:
> "I need to whitelist external POST requests to `/webservice/rest/server.php` on my Moodle
> site from a Supabase integration. Requests are being blocked by the WAF. Can you help me
> add a WAF exception for this path or whitelist the Supabase IP ranges?"

Hostinger's WAF is managed at the hosting level, not from within Moodle � Moodle admins
cannot fix a WAF block from the Moodle admin panel.

---

### MOODLE_REST_DISABLED

**What it means:**
The Moodle REST web service protocol is not enabled. The request reached Moodle but
Moodle rejected it because the REST protocol plugin is turned off.

**Retryable:** No � this is a configuration error. All requests will fail until fixed.

**Moodle admin steps:**
1. Log into Moodle as site administrator.
2. Go to **Site administration ? Plugins ? Web services ? Manage protocols**.
3. Find **REST protocol** in the list.
4. Click **Enable** (the eye icon).
5. Save. No Moodle restart required.

Also verify web services are globally enabled:
- **Site administration ? Advanced features ? Enable web services** must be checked.

---

### MOODLE_PERMISSION_DENIED

**What it means:**
The web service token is valid and reached Moodle, but the integration user's token does
not have permission to call the required web service function (`core_user_get_users`,
`core_user_create_users`, or `enrol_manual_enrol_users`).

**Retryable:** No � this is a permissions configuration error.

**Moodle admin steps:**
1. Log into Moodle as site administrator.
2. Go to **Site administration ? Server ? Web services ? External services**.
3. Find the external service used by the Foundation integration (e.g. "Foundation Integration").
4. Click **Functions**.
5. Ensure all of the following are listed:
   - `core_webservice_get_site_info`
   - `core_user_get_users`
   - `core_user_create_users`
   - `enrol_manual_enrol_users`
6. If any are missing, click **Add functions** and add them.

Also verify the token is assigned to the correct service:
- **Site administration ? Server ? Web services ? Manage tokens**
- Find the token assigned to the Foundation integration user.
- Confirm the **Service** column shows the correct external service (not "All services").

Also verify the Manual Enrolments plugin is enabled:
- **Site administration ? Plugins ? Enrolments ? Manage enrol plugins**
- **Manual enrolments** must be enabled for `enrol_manual_enrol_users` to work.

---

### MOODLE_403_UNKNOWN

**What it means:**
A 403 response was received from the Moodle endpoint, but none of the known signatures
matched (no WAF headers, no "cloudflare" in body, no Moodle exception JSON). This is an
unclassified 403 � could be a server-level access restriction, `.htaccess` rule, or IP
block set at the web server (Apache/Nginx) level rather than the WAF.

**Retryable:** No � treated as non-retryable until the root cause is identified.

**Diagnostic steps:**
1. Run Check 1 from `foundation/docs/moodle-test.md` manually with `curl -v` (verbose) to
   see the full response headers.
2. Look for `Server:` header to identify if Apache, Nginx, or another layer is blocking.
3. Check Hostinger's error logs (hPanel ? Files ? Error logs or hPanel ? Advanced ? Error logs).
4. If the block is at the Apache/Nginx level: contact Hostinger support to review
   `.htaccess` rules or server-level IP restrictions on the Moodle directory.

**Who to contact at Hostinger:**
Hostinger support chat ? ask:
> "My Moodle `/webservice/rest/server.php` endpoint is returning HTTP 403 to external
> POST requests. This is not a WAF block � can you check if there are server-level
> Apache/Nginx restrictions or `.htaccess` rules blocking access to this path?"




