# CORE ENGINEERING CONSTRAINTS

* Do not reintroduce archived legacy backend flows
* Preserve existing API action names unless explicitly migrating
* Preserve Supabase auth/profile flows
* Preserve mobile responsiveness
* Preserve existing attendance workflows
* Preserve existing registration flows
* Preserve existing teacher scheduling logic
* Preserve existing role restrictions
* Treat `archive/apps-script-legacy/*` as historical-only (never canonical runtime logic)

---

# DATA SAFETY

* Use retry-safe writes
* Use optimistic updates carefully
* Avoid destructive deletes
* Prefer soft-delete/archive
* Preserve historical data
* Add migrations safely
* Never silently overwrite duplicates
* Queue failed writes where possible

---

# MOODLE RULES

* Moodle enrollment ONLY for ASSIGNED students
* WAITLISTED students must NOT receive Moodle enrollment
* Duplicate users must NOT trigger Moodle sync
* Preserve Moodle compatibility layer

---

# MAILCHIMP RULES

Mailchimp is:

* notification layer
* onboarding layer
* campaign layer

Mailchimp is NOT:

* assignment engine
* registration source of truth
* availability engine

---

# UI RULES

Use:

* warm premium SaaS feel
* Manrope typography
* soft shadows
* rounded cards
* compact spacing
* smooth transitions
* moon emoji theme toggle
* responsive mobile layouts

Canonical visual reference:

* batch-management.html

Avoid:

* generic AI-looking layouts
* duplicated navbars
* inconsistent themes
* excessive gradients
* cluttered dashboards

---

# ARCHITECTURE RULES

* Shared shell architecture preferred
* Shared CSS preferred
* Shared utility modules preferred
* Avoid duplicated API helpers
* Avoid duplicated nav systems
* Avoid massive inline CSS duplication
* Prefer modular utilities

---

# SECURITY

* Never commit secrets
* Never commit .env files
* Never hardcode production keys
* Preserve auth guards
* Preserve role checks

---

### CSS SYSTEM (updated May 2026)

- Use fs-* primitive classes for all new and refactored pages
- tokens.css and primitives.css are the canonical source
- Do not introduce new page-specific CSS variables or class systems
- Do not use: var(--muted), var(--surface), .chip, .summary-card
  in new pages — use fs-* equivalents
- Existing pages using old classes are in migration —
  do not copy old patterns into new work

---

### EDGE FUNCTION SHARED UTILITIES

- Import from supabase/functions/_shared/ when available
- Do not reimplement retry, audit, or response helpers per-function
- New functions must use _shared/supabase.ts for client creation
  once that module exists

---

### MOODLE (updated May 2026)

- HTTP 403 is non-retryable except MOODLE_WAF_BLOCK
- Always classify 403 cause before marking FAILED
- failure_reason must be written to the sync row
- Never silently retry permission or configuration errors

---

### CONFIG GUARD

- Do not copy the FS_CONFIG guard block into new pages
- The guard must be centralized — use runtime.js or the
  shared module when available
- New pages should fail visibly and early if config is absent
