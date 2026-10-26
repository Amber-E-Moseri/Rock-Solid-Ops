// Class-state gate for selection notifications. A class is open for selection only when it is active,
// registration is open, and it has not been soft-deleted. Anything else must never reach notification,
// token, applicant-status or push side effects.

export type ClassState = {
  active?: boolean | null;
  enrollment_open?: boolean | null;
  deleted_at?: string | null;
} | null | undefined;

export function isClassOpenForSelection(c: ClassState): boolean {
  if (!c) return false;
  return c.active === true && c.enrollment_open === true && (c.deleted_at ?? null) === null;
}

export function isSlotActive(slot: { status?: string | null } | null | undefined): boolean {
  return String(slot?.status ?? "") === "Active";
}
