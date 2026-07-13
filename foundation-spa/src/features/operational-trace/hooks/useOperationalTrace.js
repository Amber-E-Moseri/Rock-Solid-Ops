import { useQuery } from '@tanstack/react-query';
import { fetchTrace } from '../lib/operationalTrace.js';

export function useOperationalTrace(lookup) {
  return useQuery({
    queryKey: ['operational-trace', lookup],
    queryFn: () => fetchTrace(lookup),
    enabled: !!lookup,
    staleTime: 60_000,
  });
}
