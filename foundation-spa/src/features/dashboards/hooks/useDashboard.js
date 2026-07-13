import { useQuery } from '@tanstack/react-query';
import { fetchDashboardData, fetchBatches, resolveScope } from '../lib/dashboard.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { useState, useCallback, useMemo } from 'react';

export function useBatches() {
  return useQuery({
    queryKey: ['dashboard-batches'],
    queryFn: fetchBatches,
    staleTime: 1000 * 60 * 5,
  });
}

export function useScope() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['dashboard-scope', profile?.user_id],
    queryFn: () => resolveScope(profile),
    enabled: Boolean(profile),
    staleTime: 1000 * 60 * 10,
  });
}

export function useDashboardData(batchId, subgroups) {
  return useQuery({
    queryKey: ['dashboard-data', batchId, subgroups],
    queryFn: () => fetchDashboardData(batchId, subgroups),
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
  });
}

export function useBatchFilter() {
  const [batchId, setBatchId] = useState(null);
  const selectBatch = useCallback((id) => setBatchId(id || null), []);
  return { batchId, selectBatch };
}
