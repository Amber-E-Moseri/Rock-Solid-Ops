import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchRoleAuditData, changeRole, setActive } from '../lib/roleAudit.js';
import { useAuth } from '../../../hooks/useAuth.js';

export function useRoleAuditData() {
  return useQuery({
    queryKey: ['role-audit'],
    queryFn: fetchRoleAuditData,
    staleTime: 60_000,
  });
}

export function useChangeRole() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: ({ uid, newRole }) => changeRole(uid, newRole, profile?.email),
    onSuccess: (_, { uid, newRole }) => {
      qc.setQueryData(['role-audit'], (old) => {
        if (!old) return old;
        return {
          ...old,
          profiles: old.profiles.map((p) =>
            p.id === uid ? { ...p, role: newRole, updated_at: new Date().toISOString() } : p,
          ),
        };
      });
    },
  });
}

export function useSetActive() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: ({ uid, active }) => setActive(uid, active, profile?.email),
    onSuccess: (_, { uid, active }) => {
      qc.setQueryData(['role-audit'], (old) => {
        if (!old) return old;
        return {
          ...old,
          profiles: old.profiles.map((p) =>
            p.id === uid ? { ...p, is_active: active, updated_at: new Date().toISOString() } : p,
          ),
        };
      });
    },
  });
}
