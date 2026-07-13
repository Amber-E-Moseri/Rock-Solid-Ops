import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAttentionData, fetchBatches, markResolved } from '../lib/needsAttention.js';
import { useAuth } from '../../../hooks/useAuth.js';

export function useBatches() {
  return useQuery({
    queryKey: ['na-batches'],
    queryFn: fetchBatches,
    staleTime: 5 * 60_000,
  });
}

export function useAttentionData(batchId) {
  return useQuery({
    queryKey: ['needs-attention', batchId],
    queryFn: () => fetchAttentionData(batchId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useMarkResolved() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: ({ flagType, entityType, entityId }) =>
      markResolved(flagType, entityType, entityId, profile?.email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['needs-attention'] }),
  });
}
