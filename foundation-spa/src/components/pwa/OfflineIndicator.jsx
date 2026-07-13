import { WifiOff } from 'lucide-react';
import { usePWA } from '../../hooks/usePWA';

/*
 * Full-width banner shown while the browser reports offline. Ported from the
 * Nexus reference, restyled from Tailwind's yellow utilities to RSO's --warn
 * token set.
 */
export function OfflineIndicator() {
  const { isOnline } = usePWA();
  if (isOnline) return null;

  return (
    <div className="rso-offline-banner" role="status" aria-live="polite">
      <WifiOff size={16} />
      <span>You&rsquo;re offline — showing cached data where available.</span>
    </div>
  );
}
