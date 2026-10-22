import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AvailabilityApprovalPage from '../features/availability-approval/AvailabilityApprovalPage.jsx';
import { fetchAvailabilitySlots, approveSlot } from '../features/availability-approval/lib/availabilityApproval.js';

// Dormant wiring test: the approval flow is held in this build. This file turns the flag on for the page
// only, so the confirm-then-call path stays covered and ready for the review sign-off. It does not
// change the shipped flag.
vi.mock('../features/availability-approval/lib/availabilityApproval.js', async (importOriginal) => ({
  ...(await importOriginal()),
  APPROVAL_CERTIFIED: true,
  fetchAvailabilitySlots: vi.fn(),
  approveSlot: vi.fn(),
}));

const { mockToast, auth } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  auth: { profile: { role: 'admin', email: 'admin@example.com' }, user: { id: 'u-admin' } },
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => auth,
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

const SLOTS = [
  { id: 's-1', teacher_id: 'T-1', teacher_full_name: 'Jane Teacher', teacher_email: 'jane@test.com', batch_id: '2026A', day: 'Mon', time_slot: '09:00:00', status: 'Tentative', class_option_id: null, class_option_sync_status: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.profile = { role: 'admin', email: 'admin@example.com' };
  auth.user = { id: 'u-admin' };
  vi.mocked(fetchAvailabilitySlots).mockResolvedValue(SLOTS);
});

describe('AvailabilityApprovalPage approval wiring (flag enabled for this test only)', () => {
  it('asks for confirmation, then calls approveSlot once for that slot and reloads', async () => {
    vi.mocked(approveSlot).mockResolvedValue({ classOptionId: 'CO-NEW', classSlotId: 'CS-NEW' });
    render(<AvailabilityApprovalPage />);
    await screen.findByText('Batch 2026A');

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve Mon 09:00 for Jane Teacher' })[0]);
    expect(await screen.findByText(/This creates the class option/)).toBeInTheDocument();
    expect(approveSlot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveSlot).toHaveBeenCalledTimes(1));
    expect(approveSlot).toHaveBeenCalledWith({ id: 's-1', actorEmail: 'admin@example.com', actorId: 'u-admin' });
    await waitFor(() => expect(fetchAvailabilitySlots).toHaveBeenCalledTimes(2));
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('CO-NEW'), 'success');
  });

  it('keeps the confirmation open and shows the RPC error when approval is refused', async () => {
    vi.mocked(approveSlot).mockRejectedValue(new Error('No campuses selected for availability. Cannot approve.'));
    render(<AvailabilityApprovalPage />);
    await screen.findByText('Batch 2026A');

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve Mon 09:00 for Jane Teacher' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No campuses selected for availability. Cannot approve.');
    expect(fetchAvailabilitySlots).toHaveBeenCalledTimes(1);
  });
});
