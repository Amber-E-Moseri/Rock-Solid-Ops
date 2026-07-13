import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchStaff, fetchTeachers, toggleStaffActive, saveStaff, toggleTeacherActive, saveTeacher, linkTeacher, unlinkTeacher, createStaffDirect } from '../lib/adminManagement.js';
import { useAuth } from '../../../hooks/useAuth.js';

export function useStaff() {
  return useQuery({ queryKey: ['admin-staff'], queryFn: fetchStaff, staleTime: 60_000 });
}

export function useTeachers() {
  return useQuery({ queryKey: ['admin-teachers'], queryFn: fetchTeachers, staleTime: 60_000 });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-staff'] });
    qc.invalidateQueries({ queryKey: ['admin-teachers'] });
  };
}

export function useToggleStaffActive() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: ({ row, idKey, next }) => toggleStaffActive(row, idKey, next), onSuccess: inv });
}

export function useCreateStaffDirect() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (params) => createStaffDirect(params), onSuccess: inv });
}

export function useSaveStaff() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: ({ row, idKey, values }) => saveStaff(row, idKey, values), onSuccess: inv });
}

export function useToggleTeacherActive() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: ({ row, meta, next }) => toggleTeacherActive(row, meta, next), onSuccess: inv });
}

export function useSaveTeacher() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: ({ row, meta, values }) => saveTeacher(row, meta, values), onSuccess: inv });
}

export function useLinkTeacher() {
  const inv = useInvalidate();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: ({ teacherId, authUserId, allowRelink }) =>
      linkTeacher(teacherId, authUserId, profile?.email, allowRelink),
    onSuccess: inv,
  });
}

export function useUnlinkTeacher() {
  const inv = useInvalidate();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: ({ teacherId }) => unlinkTeacher(teacherId, profile?.email),
    onSuccess: inv,
  });
}
