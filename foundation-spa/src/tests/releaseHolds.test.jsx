import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { APPROVAL_CERTIFIED, MOODLE_RETRY_CERTIFIED, APPROVAL_HOLD_MESSAGE, MOODLE_RETRY_HOLD_MESSAGE } from '../releaseHolds.js';
import { supabase } from '../supabase.js';
import { setSubmissionStatus } from '../features/availability-approval/lib/availabilityApproval.js';
import { retryAllFailedMoodleSyncs } from '../features/dashboards/lib/dashboard.js';

// Every network-facing module is replaced. No test in this file reaches Supabase,
// the Netlify origin or the live moodle-sync function.
vi.mock('../supabase.js', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}));

const state = vi.hoisted(() => ({ profile: null, submissions: [] }));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ profile: state.profile, signOut: vi.fn() }),
}));
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: state.profile, signOut: vi.fn() }),
}));
vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => vi.fn(),
}));
vi.mock('../features/availability-approval/lib/availabilityApproval.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchSubmissions: vi.fn(async () => state.submissions),
    // Wrapped, not replaced: the hold guard inside the real function is what is under test.
    setSubmissionStatus: vi.fn(actual.setSubmissionStatus),
  };
});
vi.mock('../features/dashboards/hooks/useDashboard.js', () => ({
  useBatches: () => ({ data: [] }),
  useScope: () => ({ data: { subgroups: null, scoped: false } }),
  useDashboardData: () => ({
    isLoading: false,
    data: {
      fetchedAt: new Date().toISOString(),
      registration: { enrolled: 0, waitlisted: 0, pendingReview: 0, duplicates: 0 },
      moodleSync: { counts: { SYNCED: 0, PENDING: 3, FAILED: 0, PROCESSING: 0 }, lastSuccess: null },
      capacity: [],
      escalations: [],
    },
  }),
}));

import AvailabilityApprovalPage from '../features/availability-approval/AvailabilityApprovalPage.jsx';
import DashboardsPage from '../features/dashboards/DashboardsPage.jsx';

const PENDING_SUBMISSION = {
  id: 'sub-1', teacher_name: 'Test Teacher', teacher_email: 'teacher@example.test',
  month: '2026-06', campuses: ['FCH'], slots: [{ day: 1, time: '09:00' }],
  notes: '', status: 'pending', review_note: '', created_at: '2026-06-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.profile = { role: 'admin', email: 'admin@example.test', full_name: 'RSO Test Staff' };
  state.submissions = [PENDING_SUBMISSION];
});

describe('release holds', () => {
  it('keeps approval and Moodle retry held', () => {
    expect(APPROVAL_CERTIFIED).toBe(false);
    expect(MOODLE_RETRY_CERTIFIED).toBe(false);
  });

  it('setSubmissionStatus fails closed without touching Supabase', async () => {
    await expect(setSubmissionStatus(['sub-1'], 'approved', '', 'admin@example.test'))
      .rejects.toThrow(APPROVAL_HOLD_MESSAGE);
  });

  it('retryAllFailedMoodleSyncs fails closed: no reads, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 });
    await expect(retryAllFailedMoodleSyncs()).rejects.toThrow(MOODLE_RETRY_HOLD_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('availability approval page while held', () => {
  it('shows the hold notice and no approve control is enabled', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AvailabilityApprovalPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText(/Approval is on hold/)).toBeInTheDocument();
    const approveControls = screen.queryAllByRole('button', { name: /approv/i });
    for (const control of approveControls) {
      expect(control).toBeDisabled();
    }
    expect(setSubmissionStatus).not.toHaveBeenCalled();
  });
});
