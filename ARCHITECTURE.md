# ARCHITECTURE

Canonical architecture documents are maintained at:
- `foundation/docs/ARCHITECTURE.md`

Key current state:
- Supabase is the primary backend.
- Registration canonical path is `registration-processor`.
- Legacy registration processing is archived and non-operational.
- Canonical audit table is `public.audit_logs` only.
- Retry-worker includes a scheduled auto sweep (hourly, `0 * * * *`), which also reconciles TIMEOUT_UNKNOWN Nexus task outcomes.


