# Security Model & Access Control

---

## Authentication Methods

### Supabase Auth (User Login)
- Email/password authentication via Supabase hosted auth UI
- JWTs issued to frontend, stored in browser session
- Valid for configured session duration
- Verified server-side in Edge Functions via `supabaseClient.auth.getUser(jwt)`

### CRON_INVOKE_SECRET (Scheduled Functions)
- Environment-specific secret
- Passed via `x-cron-secret` HTTP header
- Used by pg_cron scheduler to invoke scheduled functions
- Verified via SHA-256 hash comparison (timing-safe)
- Cannot be used as substitute for user JWT or INTERNAL_INVOKE_SECRET

### INTERNAL_INVOKE_SECRET (Function-to-Function)
- Environment-specific secret
- Passed via `x-internal-secret` HTTP header
- Used when one Edge Function calls another
- Examples: registration-processor → waitlist-processor, retry-worker → clickup-sync
- Verified via SHA-256 hash comparison (timing-safe)
- Cannot be used as substitute for CRON_INVOKE_SECRET or user JWT

---

## Authorization

### Role-Based Access Control (RBAC)

**User Roles** (stored in `profiles.role`):

| Role | Access Level | Jurisdiction | Typical Use |
|---|---|---|---|
| `superadmin` | Full platform | Global | Account ownership, all operations |
| `admin` | Administrative | Global (or regional) | Batch creation, class management, staff approval |
| `regional_secretary` | Regional operations | Regional | Multi-campus coordination |
| `pastor` | Group/fellowship | Group-level | Spiritual leadership, class oversight |
| `subgroup_admin` | Subgroup operations | Subgroup-level | Sub-jurisdiction management |
| `principal` | School principal | School-level | School operations |
| `teacher` | Class-level | Assigned classes | Attendance, roster, availability |
| `pending` | Minimal | None | Awaiting approval |

### Row-Level Security (RLS)

All user-facing tables have RLS enabled. Example policies:

**applicants table:**
- Superadmin/admin see all applicants
- Regional staff see applicants in their region
- Teachers see applicants in their classes only
- Applicants see their own record only

**classes table:**
- Staff see classes in allowed batches/campuses
- Teachers see classes they teach

**teacher_profiles table:**
- Teachers see their own profile
- Staff see profiles of teachers in their jurisdiction
- Admins see all profiles

**attendance_records table:**
- Teachers record attendance for their classes
- Staff view attendance in their jurisdiction
- Admins view all attendance

**If RLS is disabled, the system is vulnerable to unauthorized data access.** Always verify RLS is enabled on production.

---

## Server-Side Authorization Checks

Edge Functions perform explicit role checks before privileged operations:

**Example (from admin-api):**
```typescript
// Verify caller is admin
const profile = await db
  .from("profiles")
  .select("role,is_active")
  .eq("user_id", userId)
  .maybeSingle();

const role = String(profile.data?.role || "").toLowerCase();
const allowed = ["admin", "superadmin"].includes(role);

if (!allowed) return jsonResponse({ ok: false, error: "Admin access required" }, 403);
```

**Never trust client-side role checks alone.** Client role checks are UI hints only.

---

## CORS & Cross-Origin Requests

**ALLOWED_ORIGINS** (environment variable, comma-separated list):

Example:
```
https://rocksolidsuite.netlify.app,https://rocksolid.lwcanada.org
```

Edge Functions check Origin header against this list and set `Access-Control-Allow-Origin` accordingly.

**Important:** Do not use `*` for authenticated endpoints. Restrict to known frontend origins.

---

## Known Limitations

### Regional Data Scoping
Role-based access is globally enforced in RBAC (superadmin > admin > regional_secretary, etc.). However, **regional/jurisdictional data scoping is not yet universally enforced across all workflows.**

Some workflows may not fully respect jurisdiction boundaries. This is an active area of development.

**Implication:** Do not assume all data is automatically scoped to a staff member's region. Always verify with the team.

### Moodle Integration Risk
- Moodle 403 errors (WAF blocks, permission denied) may indicate upstream authentication or permission issues
- WAF blocks are not retryable; require manual intervention
- Moodle token compromise could expose student enrollment data

**Mitigation:**
- Keep Moodle token in Supabase Secrets (not in code)
- Monitor Moodle API access logs
- Set up Nexus alerts for enrollment failures

### Email Delivery Risk
- Email addresses are visible in `applicants`, `email_queue`, and logs
- Resend API key is environment-secret (not exposed)
- Email bounces are logged but not encrypted

**Mitigation:**
- Restrict email_queue access via RLS
- Don't log email body contents
- Clean up old email_queue rows regularly

---

## Credential Management

### Never Commit
- CRON_INVOKE_SECRET
- INTERNAL_INVOKE_SECRET
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_ANON_KEY (for production)
- RESEND_API_KEY
- MOODLE_TOKEN
- NEXUS_API_KEY

All secrets are set in Supabase project settings, not in code.

### Rotation
Secrets should be rotated periodically:

1. Generate new secret
2. Update in Supabase project settings
3. Test that functions still work
4. Document rotation date
5. Archive old secret in secure location

---

## Audit Logging

Every significant operation writes to `audit_logs`:

```sql
INSERT INTO audit_logs (actor_email, action, entity_type, entity_id, status, details)
VALUES (
  'admin@example.com',
  'applicant_assigned',
  'applicants',
  '123',
  'SUCCESS',
  '{"class_id":"456","previous_status":"PENDING"}'
);
```

Audit logs are **immutable** and used for compliance audits and incident investigation.

**What's logged:**
- User actions (login, data updates)
- Administrative actions (applicant assignment, teacher approval)
- System actions (email send, Moodle sync, retries)

**What's not logged:**
- Email body contents
- Moodle user passwords
- Internal error details that might leak secrets

---

## API Security Best Practices

### Input Validation
All user input (form submissions, API requests) is validated:
- Required fields present
- Data types correct
- String length limits enforced
- Email format validation
- No SQL injection (Supabase parameterized queries)

### Rate Limiting
Not currently enforced at Supabase gateway level. Planned for future work.

### HTTPS Only
All communication is HTTPS. Redirect HTTP to HTTPS.

### Token Lifetime
JWTs are short-lived (configured in Supabase Auth). Refresh tokens allow session renewal without password re-entry.

---

## Threats & Mitigations

| Threat | Risk | Mitigation |
|---|---|---|
| Compromised Moodle token | Enrollment data exposure | Keep token in Supabase Secrets; rotate periodically |
| RLS policy bypass | Unauthorized data access | Audit RLS on all tables; test policies in staging |
| CRON_INVOKE_SECRET disclosure | Unauthorized function invocation | Treat as high-severity; rotate immediately if leaked |
| JWT forgery | Session hijacking | Supabase Auth handles verification; validate on server-side |
| Email address harvesting | Privacy violation | Restrict email_queue visibility via RLS |
| DDoS on registration endpoint | Service unavailability | Rely on Supabase/Netlify DDoS protection |

---

## Security Audit Checklist

Before production release:

- [ ] All user-facing tables have RLS enabled
- [ ] RLS policies restrict access by role and jurisdiction
- [ ] Edge Functions verify user role server-side
- [ ] No credentials in version control
- [ ] CRON_INVOKE_SECRET and INTERNAL_INVOKE_SECRET set in Supabase
- [ ] ALLOWED_ORIGINS configured correctly (no `*` for auth endpoints)
- [ ] Audit logs being written for all significant operations
- [ ] Moodle token in Supabase Secrets (not in code)
- [ ] No SQL injection vulnerabilities (use parameterized queries)
- [ ] HTTPS enforced on frontend
- [ ] Session timeout configured appropriately
- [ ] Manual security test of key workflows (admin approval, teacher attendance, Moodle sync)

---

## Compliance & Legal

Rock Solid Ops handles student data (names, emails, phone numbers, attendance, grades). Ensure:

- Data processing agreements in place with Supabase, Moodle, Resend, Nexus
- Privacy policy covers data collection and retention
- Audit logs retained for compliance audits
- Data export/deletion capability for user requests
- Encryption at rest and in transit

Consult with legal/privacy team before production deployment.

---

## Incident Response

**If a security incident is suspected:**

1. **Identify affected data:** Which tables, which records?
2. **Contain:** Disable access if necessary
3. **Investigate:** Check audit logs for unauthorized access
4. **Notify:** Escalate to senior leadership
5. **Remediate:** Rotate credentials, patch vulnerabilities
6. **Document:** Post-mortem and preventive measures

Audit logs are critical for incident investigation.
