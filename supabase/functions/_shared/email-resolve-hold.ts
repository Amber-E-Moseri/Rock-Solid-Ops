// Server-side hold on Resolve for email_queue. The table's status check allows only Pending, Processing, Sent,
// Failed and Retried, so a Resolved status is rejected by the database. Resolve is refused before any write until
// the release decides a status mapping. Do not map it to Sent or Retried. Retry for email_queue and Resolve for
// the other sources are not affected.
export const EMAIL_QUEUE_RESOLVE_HELD = true;

export const EMAIL_RESOLVE_HELD_CODE = "EMAIL_RESOLVE_HELD";

export type ResolvePlan = "proceed" | "refuse_held";

export function planResolve(
  action: string,
  source: string,
  held: boolean = EMAIL_QUEUE_RESOLVE_HELD,
): ResolvePlan {
  const isResolve = String(action || "").trim().toLowerCase() === "resolve";
  const isEmailQueue = String(source || "").trim().toLowerCase() === "email_queue";
  return held && isResolve && isEmailQueue ? "refuse_held" : "proceed";
}
