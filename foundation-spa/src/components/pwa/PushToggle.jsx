import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  getPushStatus,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/webPush.js';

/*
 * Topbar toggle to enable/disable web push (PWA Phase C.2). Self-contained:
 * renders nothing where push is unsupported (no service worker / PushManager /
 * VAPID key), so it degrades cleanly on unsupported browsers and in dev without
 * a configured VAPID key.
 */
export function PushToggle() {
  const [supported] = useState(() => pushSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    getPushStatus().then((s) => {
      if (alive) setSubscribed(s.subscribed && s.permission === 'granted');
    });
    return () => { alive = false; };
  }, [supported]);

  if (!supported) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        const res = await subscribeToPush();
        if (res.ok) setSubscribed(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      disabled={busy}
      title={subscribed ? 'Disable notifications' : 'Enable notifications'}
      aria-label={subscribed ? 'Disable push notifications' : 'Enable push notifications'}
      aria-pressed={subscribed}
    >
      {subscribed ? <Bell size={16} /> : <BellOff size={16} />}
    </button>
  );
}
