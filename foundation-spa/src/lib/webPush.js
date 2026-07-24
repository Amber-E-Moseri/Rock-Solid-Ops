import { supabase } from '../supabase.js';

/*
 * Web Push client subscribe flow (PWA Phase C.2).
 * Adapted from the Nexus reference webPush.js — the one part that was verified
 * reusable — but retargeted to RSO's auth/profile model: subscriptions are
 * stored on `public.profiles` keyed by `user_id` (auth.users id), NOT on a
 * `users` table keyed by `id`. Self-write is allowed by the existing
 * profiles_self_or_admin_update RLS policy.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// VAPID public key (URL-safe base64) → Uint8Array for PushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!VAPID_PUBLIC_KEY
  );
}

// Request permission + subscribe, then persist to the caller's own profile row.
export async function subscribeToPush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    // No auth session — undo the browser subscription so we don't orphan it.
    await subscription.unsubscribe().catch(() => {});
    return { ok: false, reason: 'no-session' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      push_subscription: subscription.toJSON(),
      push_subscribed_at: new Date().toISOString(),
      push_enabled: true,
    })
    .eq('user_id', userId);

  if (error) {
    await subscription.unsubscribe().catch(() => {});
    return { ok: false, reason: 'save-failed', error };
  }

  return { ok: true };
}

// Remove the browser subscription and clear it from the profile row.
export async function unsubscribeFromPush() {
  if (!pushSupported()) return { ok: true };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe().catch(() => {});

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userId) {
    await supabase
      .from('profiles')
      .update({ push_subscription: null, push_enabled: false })
      .eq('user_id', userId);
  }
  return { ok: true };
}

// Current subscription status for UI (does not mutate anything).
export async function getPushStatus() {
  if (!pushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }
  const permission = Notification.permission;
  let subscribed = false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    subscribed = subscription !== null;
  } catch {
    subscribed = false;
  }
  return { supported: true, permission, subscribed };
}
