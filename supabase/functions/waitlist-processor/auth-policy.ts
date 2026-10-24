// Who may run waitlist processing. Service-role callers (registration-processor and the database cron)
// are accepted separately by the shared helper. Keep this list in step with the Waiting Students route
// in foundation-spa/src/routing/routeRoles.js.
export const WAITLIST_PROCESS_ROLES: readonly string[] = ["admin", "superadmin", "regional_secretary"];
