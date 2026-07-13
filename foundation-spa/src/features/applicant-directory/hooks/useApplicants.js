import { useQuery } from '@tanstack/react-query';
import { fetchDirectoryData, fetchApplicantDetail } from '../lib/applicants.js';

export function useDirectoryData() {
  return useQuery({
    queryKey: ['applicant-directory'],
    queryFn: fetchDirectoryData,
    staleTime: 1000 * 60 * 2,
  });
}

export function useApplicantDetail(applicantId) {
  return useQuery({
    queryKey: ['applicant-detail', applicantId],
    queryFn: () => fetchApplicantDetail(applicantId),
    enabled: Boolean(applicantId),
    staleTime: 1000 * 30,
  });
}
