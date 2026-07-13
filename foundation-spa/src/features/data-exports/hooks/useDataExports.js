import { useQuery } from '@tanstack/react-query';
import { fetchExportData } from '../lib/dataExports.js';

export function useDataExports() {
  return useQuery({
    queryKey: ['data-exports'],
    queryFn: fetchExportData,
    staleTime: 2 * 60_000,
  });
}
