import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../supabase.js', () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'superadmin', email: 'admin@x.com' } }),
}));

// Mock at the hook level so we bypass TanStack Query async plumbing in jsdom
vi.mock('../features/applicant-directory/hooks/useApplicants.js', async (importOriginal) => {
  const { buildDirectoryModel, FALLBACK_MILESTONE_DEFS } = await import('../features/applicant-directory/lib/applicants.js');
  const MODEL = buildDirectoryModel({
    applicants: [
      { id: '1', full_name: 'Ann Smith', email: 'ann@x.com', class_option_id: 'CO-1', registration_status: 'ASSIGNED', created_at: '2026-07-01T10:00:00Z' },
      { id: '2', full_name: 'Bob Jones', email: 'bob@x.com', registration_status: 'PENDING', created_at: '2026-07-02T10:00:00Z' },
    ],
    classOptions: [{ class_option_id: 'CO-1', teacher_name: 'Teach', day: 'Sun', class_time: '10:00', batch_id: 'B1', active: true }],
    batches: [{ batch_id: 'B1', batch_name: 'July Cohort' }],
    attendance: [],
    milestoneDefs: FALLBACK_MILESTONE_DEFS,
    milestoneStatusRows: [],
    summaryRows: null,
    duplicateGroups: [],
    duplicateNotifications: [],
  });
  return {
    useDirectoryData: () => ({ data: MODEL, isLoading: false, isFetching: false, refetch: vi.fn() }),
    useApplicantDetail: () => ({ data: null, isLoading: false }),
  };
});

import { ToastProvider } from '../context/ToastContext.jsx';
import ApplicantDirectoryPage from '../features/applicant-directory/ApplicantDirectoryPage.jsx';

function renderPage(initialEntry = '/staff/applicant-directory') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <ApplicantDirectoryPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ApplicantDirectoryPage', () => {
  it('renders directory mode with KPIs and table rows', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Ann Smith').length).toBeGreaterThan(0));
    expect(screen.getByText('Total Registrants')).toBeInTheDocument();
    expect(screen.getAllByText('Bob Jones').length).toBeGreaterThan(0);
    expect(screen.getByText('Students by Batch')).toBeInTheDocument();
    expect(screen.getByText(/July Cohort/)).toBeInTheDocument();
  });

  it('renders review mode from ?tab=review with the queue and compare cards', async () => {
    renderPage('/staff/applicant-directory?tab=review');
    await waitFor(() => expect(screen.getByText(/Review new registrations/)).toBeInTheDocument());
    // Bob is PENDING → in the review queue; detail pane shows action buttons
    await waitFor(() => expect(screen.getByText(/Mark reviewed|Keep selected/)).toBeInTheDocument());
    expect(screen.getByText('✕ Not a duplicate')).toBeInTheDocument();
  });
});
