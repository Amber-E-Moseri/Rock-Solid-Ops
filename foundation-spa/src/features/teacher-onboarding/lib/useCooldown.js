import { useCallback, useEffect, useState } from 'react';

// Client-side pause between repeated email requests. It is a usability guard only; the Auth service
// rate-limits independently.
export default function useCooldown(seconds = 60) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  const start = useCallback(() => setRemaining(seconds), [seconds]);
  return { remaining, start };
}
