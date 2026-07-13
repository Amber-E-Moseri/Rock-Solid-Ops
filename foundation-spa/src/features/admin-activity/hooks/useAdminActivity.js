import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchActivityLogs } from '../lib/adminActivity.js';

export function useAdminActivity() {
  return useInfiniteQuery({
    queryKey: ['admin-activity'],
    queryFn: ({ pageParam = 0 }) => fetchActivityLogs(pageParam),
    getNextPageParam: (lastPage, pages) =>
      lastPage.exhausted ? undefined : pages.length * 100,
    staleTime: 60_000,
  });
}
