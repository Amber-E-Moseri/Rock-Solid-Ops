# NEXT_STEPS

Operational next steps are maintained at:
- `foundation/docs/NEXT_STEPS.md`

Pilot-critical reminders:
- Keep only Supabase registration pipeline active.
- Keep archived legacy registration code out of operational runtime paths.
- Apply audit canonicalization migration and verify all new writes land in `audit_logs`.
- Confirm the retry-worker schedule (`0 * * * *`, hourly) is active in production: C6 Nexus reconciliation runs inside it.


