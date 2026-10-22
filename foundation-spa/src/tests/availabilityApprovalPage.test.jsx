import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AvailabilityApprovalPage from '../features/availability-approval/AvailabilityApprovalPage.jsx';
import { fetchSubmissions } from '../features/availability-approval/lib/availabilityApproval.js';

vi.mock('../features/availability-approval/lib/availabilityApproval.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSubmissions: vi.fn(),
  setSubmissionStatus: vi.fn(),
}));

// Stable toast reference: the page's load effect depends on it, so a fresh fn per render would loop.
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ profile: { email: 'admin@example.com' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

const ROW = {
  id: 'sub-1',
  teacher_name: 'Ann Teacher',
  teacher_email: 'ann@example.com',
  month: '2026-11-01',
  campuses: ['Main'],
  slots: [{ day: 'Mon', time: '09:00' }],
  status: 'pending',
  created_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AvailabilityApprovalPage load states', () => {
  it('shows an error banner with retry on a failed load, not "No submissions found" or a zero count', async () => {
    vi.mocked(fetchSubmissions).mockRejectedValueOnce(new Error('boom'));
    render(<AvailabilityApprovalPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load submissions. boom');
    expect(screen.queryByText('No submissions found.')).toBeNull();
    expect(screen.queryByText(/^0 submissions$/)).toBeNull();
    // KPI tiles show a placeholder, not a zero count, when the load failed.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('retries the load from the error banner and renders the rows on success', async () => {
    vi.mocked(fetchSubmissions)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([ROW]);
    render(<AvailabilityApprovalPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchSubmissions).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state for a successful empty result', async () => {
    vi.mocked(fetchSubmissions).mockResolvedValueOnce([]);
    render(<AvailabilityApprovalPage />);

    expect(await screen.findByText('No submissions found.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the table and the mobile card view, with named approve and reject buttons', async () => {
    vi.mocked(fetchSubmissions).mockResolvedValueOnce([ROW]);
    render(<AvailabilityApprovalPage />);

    await screen.findByRole('table');
    // One table row and one card per submission.
    expect(screen.getAllByText('Ann Teacher')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Approve Ann Teacher' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Reject Ann Teacher' })).toHaveLength(2);
  });
});
