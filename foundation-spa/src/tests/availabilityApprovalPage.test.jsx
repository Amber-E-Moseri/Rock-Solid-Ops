import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AvailabilityApprovalPage from '../features/availability-approval/AvailabilityApprovalPage.jsx';
import { fetchAvailabilitySlots, approveSlot, APPROVAL_CERTIFIED } from '../features/availability-approval/lib/availabilityApproval.js';

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

const HELD_BUTTON = /^Approval on hold for /;

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

  it('never offers a reject or revoke control', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');
    expect(screen.queryByRole('button', { name: /reject|revoke|decline/i })).toBeNull();
    expect(screen.getByText(/Rejecting slots and approving several at once are not available/)).toBeInTheDocument();
  });

  it('hides approval controls from roles the RPC would refuse', async () => {
    auth.profile = { role: 'regional_secretary', email: 'rs@example.com' };
    renderPage();
    await screen.findByText('Batch 2026A');
    expect(screen.queryByRole('button', { name: HELD_BUTTON })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve / })).toBeNull();
  });

  it('shows the no-match state when filters exclude every slot', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');
    fireEvent.change(screen.getByPlaceholderText('Search teacher name, email or ID'), { target: { value: 'nobody-here' } });
    expect(screen.getByText('No slots match')).toBeInTheDocument();
  });
});

describe('AvailabilityApprovalPage approval is on hold', () => {
  beforeEach(() => {
    vi.mocked(fetchAvailabilitySlots).mockResolvedValue(SLOTS);
  });

  it('is held in this build', () => {
    expect(APPROVAL_CERTIFIED).toBe(false);
  });

  it('shows Approve disabled as "On hold" on awaiting slots for approvers, in table and card views', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');

    // s-1 and s-3 are awaiting; each appears in a table row and a card, so two controls per slot.
    const held = screen.getAllByRole('button', { name: HELD_BUTTON });
    expect(held).toHaveLength(4);
    for (const button of held) expect(button).toBeDisabled();
    expect(screen.getAllByText('On hold')).toHaveLength(4);
    expect(screen.getByText(/Approval is on hold pending contract review/)).toBeInTheDocument();
  });

  it('does not open a confirmation or call the RPC wrapper when a held button is clicked', async () => {
    renderPage();
    await screen.findByText('Batch 2026A');

    fireEvent.click(screen.getAllByRole('button', { name: HELD_BUTTON })[0]);

    expect(screen.queryByText(/This creates the class option/)).toBeNull();
    expect(approveSlot).not.toHaveBeenCalled();
  });
});
