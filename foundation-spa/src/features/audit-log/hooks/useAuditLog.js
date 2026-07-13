import { useQuery } from '@tanstack/react-query';
import { fetchAuditLogs, fetchActors } from '../lib/auditLog.js';

export function useAuditLogs(filters) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => fetchAuditLogs(filters),
    keepPreviousData: true,
    staleTime: 1000 * 60,
  });
}

export function useAuditActors() {
  return useQuery({
    queryKey: ['audit-actors'],
    queryFn: fetchActors,
    staleTime: 1000 * 60 * 5,
  });
}
