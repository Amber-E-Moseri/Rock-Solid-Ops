/*
 * Internal push fan-out helper (PWA Phase C.2).
 *
 * Trigger points (registration-processor, attention-flag raise, availability/
 * waitlist) call this fire-and-forget so push is a COMPLEMENTARY channel on the
 * existing notification triggers, not a parallel system. It never throws into
 * the caller's flow — a push failure must not break registration/attendance/etc.
 *
 * Applicants have no auth accounts and no push subscription, so this only ever
 * reaches staff/teacher profiles; applicant-facing messaging stays on email.
 */
import {
  type PushSubscriptionJSON,
  sendWebPush,
  vapidKeysFromEnv,
} from "./webpush.ts";

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  type?: string;
}

// Resolve the user_ids of push-enabled profiles holding any of the given roles.
// Used by trigger points to target a staff audience by role (e.g. admins for a
// registration needing review). Best-effort: returns [] on any read error.
export async function resolveStaffRecipients(db: any, roles: string[]): Promise<string[]> {
  const wanted = Array.from(new Set((roles || []).map((r) => String(r).trim().toLowerCase()).filter(Boolean)));
  if (wanted.length === 0) return [];
  try {
    const { data } = await db
      .from("profiles")
      .select("user_id, role")
      .in("role", wanted)
      .eq("push_enabled", true)
      .not("push_subscription", "is", null);
    return (data || []).map((r: { user_id: string }) => r.user_id).filter(Boolean);
  } catch (_err) {
    return [];
  }
}

export interface PushFanoutResult {
  attempted: number;
  sent: number;
  expired: number;
  failed: number;
  skipped: boolean; // true when VAPID isn't configured (no-op, not an error)
}

// Send `message` to every given profile user_id that has push enabled. `db`
// must be a service-role client (reads other profiles' subscriptions + clears
// dead ones). Best-effort: returns counts, never throws.
export async function notifyProfilesPush(
  db: any,
  userIds: string[],
  message: PushMessage,
): Promise<PushFanoutResult> {
  const result: PushFanoutResult = { attempted: 0, sent: 0, expired: 0, failed: 0, skipped: false };
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (ids.length === 0) return result;

  let keys;
  try {
    keys = vapidKeysFromEnv();
  } catch (_err) {
    // No VAPID configured (e.g. not yet set up in this environment). Treat as a
    // no-op rather than a failure so callers are unaffected pre-rollout.
    result.skipped = true;
    return result;
  }

  let rows: Array<{ user_id: string; push_subscription: PushSubscriptionJSON | null }> = [];
  try {
    const { data } = await db
      .from("profiles")
      .select("user_id, push_subscription")
      .in("user_id", ids)
      .eq("push_enabled", true)
      .not("push_subscription", "is", null);
    rows = data || [];
  } catch (_err) {
    return result; // DB read failed — nothing to do, stay silent
  }

  const payload = {
    title: message.title,
    body: message.body,
    url: message.url || "/",
    type: message.type || "notification",
  };

  const expiredUserIds: string[] = [];
  for (const row of rows) {
    if (!row.push_subscription) continue;
    result.attempted += 1;
    try {
      const res = await sendWebPush(row.push_subscription, payload, keys);
      if (res.ok) result.sent += 1;
      else if (res.expired) {
        result.expired += 1;
        expiredUserIds.push(row.user_id);
      } else {
        result.failed += 1;
      }
    } catch (_err) {
      result.failed += 1;
    }
  }

  // Clear subscriptions the push service reported as gone (404/410) so we stop
  // trying them and the client can re-subscribe.
  if (expiredUserIds.length > 0) {
    try {
      await db
        .from("profiles")
        .update({ push_subscription: null, push_enabled: false })
        .in("user_id", expiredUserIds);
    } catch (_err) {
      /* best-effort cleanup */
    }
  }

  return result;
}
