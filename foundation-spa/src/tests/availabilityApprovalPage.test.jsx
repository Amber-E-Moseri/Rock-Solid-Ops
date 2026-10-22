import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AvailabilityApprovalPage from '../features/availability-approval/AvailabilityApprovalPage.jsx';
import { fetchAvailabilitySlots, approveSlot } from '../features/availability-approval/lib/availabilityApproval.js';

vi.mock('../features/availability-approval/lib/availabilityApproval.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAvailabilitySlots: vi.fn(),
  approveSlot: vi.fn(),
}));

// Stable references: the page's load effect depends on them.
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
  { id: 's-2', teacher_id: 'T-1', teacher_full_name: 'Jane Teacher', teacher_email: 'jane@test.com', batch_id: '2026A', day: 'Wed', time_slot: '14:00:00', status: 'Available', class_option_id: 'CO-JANE', class_option_sync_status: 'SUCCESS' },
  { id: 's-3', teacher_id: 'T-2', teacher_full_name: null, teacher_email: null, batch_id: null, day: 'Fri', time_slot: '10:00:00', status: 'Tentative', class_option_id: null, class_option_sync_status: 'FAILED', class_option_sync_error: 'no campus' },
];

function renderPage() {
  return render(<AvailabilityApprovalPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.profile = { role: 'admin', email: 'admin@example.com' };
  auth.user = { id: 'u-admin' };
});

describe('AvailabilityApprovalPage states', () => {
  it('shows a skeleton while loading, not an empty state', () => {
    vi.mocked(fetchAvailabilitySlots).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.rso-skeleton')).not.toBeNull();
    expect(screen.queryByText('No availability slots')).toBeNull();
  });

  it('shows an error banner with the database message and a working Retry', async () => {
    vi.mocked(fetchAvailabilitySlots)
      .mockRejectedValueOnce(new Error('permission denied for table teacher_availability'))
      .mockResolvedValueOnce(SLOTS);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load availability. permission denied for table teacher_availability');
    expect(screen.queryByText('No availability slots')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByText('Jane Teacher').length).toBeGreaterThan(0));
    expect(fetchAvailabilitySlots).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when there are no slots at all', async () => {
    vi.mocked(fetchAvailabilitySlots).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No availability slots')).toBeInTheDocument();
  });
});

describe('AvailabilityApprovalPage slot display', () => {
  beforeEach(() => {
    vi.mocked(fetchAvailabilitySlots).mockResolvedValue(SLOTS);
  });

  it('groups slots under each teacher and batch, with names from teachers.full_name', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');

    // Each group renders its name once in the card header, and once in each slot row/card where shown.
    expect(screen.getAllByText('Jane Teacher').length).toBeGreaterThan(0);
    expect(screen.getByText('No name on teacher record')).toBeInTheDocument();
    expect(screen.getByText('No batch')).toBeInTheDocument();
  });

  it('shows each status, and a failed class sync with its database message', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');

    expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sync failed: no campus').length).toBeGreaterThan(0);
  });

  it('offers Approve only on awaiting slots, and never a reject or revoke control', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');

    const approve = screen.getAllByRole('button', { name: /^Approve / });
    // s-1 and s-3 are awaiting; each appears in a table row and a card, so two buttons per slot.
    expect(approve).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /reject|revoke|decline/i })).toBeNull();
    expect(screen.getByText(/Rejecting slots and approving several at once are not available/)).toBeInTheDocument();
  });

  it('hides approval from roles the RPC would refuse', async () => {
    auth.profile = { role: 'regional_secretary', email: 'rs@example.com' };
    renderPage();
    await screen.findByText('Batch 2026A');
    expect(screen.queryByRole('button', { name: /^Approve / })).toBeNull();
  });

  it('shows the no-match state when filters exclude every slot', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');
    fireEvent.change(screen.getByPlaceholderText('Search teacher name, email or ID'), { target: { value: 'nobody-here' } });
    expect(screen.getByText('No slots match')).toBeInTheDocument();
  });
});

describe('AvailabilityApprovalPage approval flow', () => {
  beforeEach(() => {
    vi.mocked(fetchAvailabilitySlots).mockResolvedValue(SLOTS);
  });

  it('asks for confirmation, then calls the RPC wrapper once for that slot and reloads', async () => {
    vi.mocked(approveSlot).mockResolvedValue({ classOptionId: 'CO-NEW', classSlotId: 'CS-NEW' });
    renderPage();
    await screen.findByText('Batch 2026A');

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve Mon 09:00 for Jane Teacher' })[0]);
    const dialog = await screen.findByRole('dialog').catch(() => null);
    const scope = dialog ? within(dialog) : screen;
    expect(scope.getByText(/This creates the class option/)).toBeInTheDocument();
    expect(approveSlot).not.toHaveBeenCalled();

    fireEvent.click(scope.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveSlot).toHaveBeenCalledTimes(1));
    expect(approveSlot).toHaveBeenCalledWith({ id: 's-1', actorEmail: 'admin@example.com', actorId: 'u-admin' });
    await waitFor(() => expect(fetchAvailabilitySlots).toHaveBeenCalledTimes(2));
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('CO-NEW'), 'success');
  });

  it('keeps the confirmation open and shows the RPC error when approval is refused', async () => {
    vi.mocked(approveSlot).mockRejectedValue(new Error('No campuses selected for availability. Cannot approve.'));
    renderPage();
    await screen.findByText('Batch 2026A');

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve Mon 09:00 for Jane Teacher' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No campuses selected for availability. Cannot approve.');
    expect(fetchAvailabilitySlots).toHaveBeenCalledTimes(1);
  });
});
