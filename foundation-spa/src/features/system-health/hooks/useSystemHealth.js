import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { runHealthChecks, fetchQueueMetrics, fetchRecentFailures } from '../lib/system-health.js';

export function useSystemHealth(supabaseUrl, anonKey) {
  const queryClient = useQueryClient();

  const checks = useQuery({
    queryKey: ['system-health-checks', supabaseUrl],
    queryFn: () => runHealthChecks(supabaseUrl, anonKey),
    staleTime: 1000 * 60 * 2,
  });

  const metrics = useQuery({
    queryKey: ['system-health-metrics'],
    queryFn: fetchQueueMetrics,
    staleTime: 1000 * 60,
  });

  const failures = useQuery({
    queryKey: ['system-health-failures'],
    queryFn: fetchRecentFailures,
    staleTime: 1000 * 60,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['system-health-checks'] });
    queryClient.invalidateQueries({ queryKey: ['system-health-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['system-health-failures'] });
  }, [queryClient]);

  return { checks, metrics, failures, refresh };
}
