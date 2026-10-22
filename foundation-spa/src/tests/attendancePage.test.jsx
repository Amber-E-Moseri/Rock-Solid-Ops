import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AttendancePage from '../features/attendance/AttendancePage.jsx';
import { fetchClasses } from '../features/attendance/lib/attendance.js';

vi.mock('../features/attendance/lib/attendance.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchClasses: vi.fn(),
}));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

const CLASS = {
  id: 'c-1',
  time: 'Mon · 9:00 AM',
  loc: 'SG1',
  teacher: 'Jane Teacher',
  session: '2026A',
  flagSessions: [],
  submitted: false,
  roster: [
    { name: 'Student One', student_id: 's-1', status: null },
    { name: 'Student Two', student_id: 's-2', status: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AttendancePage data states', () => {
  it('shows an error and no classes when the read fails; it does not show demo classes', async () => {
    vi.mocked(fetchClasses).mockRejectedValue(new Error('column teacher_availability.subgroup_id does not exist'));
    render(<AttendancePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load classes. column teacher_availability.subgroup_id does not exist');
    expect(screen.queryByText('No classes found')).toBeNull();
    expect(screen.queryByText('Select a class to view the roster')).toBeNull();
  });

  it('shows an honest empty state for a successful empty read', async () => {
    vi.mocked(fetchClasses).mockResolvedValue([]);
    render(<AttendancePage />);

    expect(await screen.findByText('No classes found')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries the read from the error banner', async () => {
    vi.mocked(fetchClasses).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([CLASS]);
    render(<AttendancePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Submit attendance' });
    expect(fetchClasses).toHaveBeenCalledTimes(2);
  });
});

describe('AttendancePage submit', () => {
  it('holds the submit control: disabled, and it never reports attendance as saved', async () => {
    // One student marked, so the page would reach the save path if the hold were lifted.
    const marked = { ...CLASS, roster: [{ ...CLASS.roster[0], status: 'present' }, CLASS.roster[1]] };
    vi.mocked(fetchClasses).mockResolvedValue([marked]);
    render(<AttendancePage />);

    const submit = await screen.findByRole('button', { name: 'Submit attendance' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);

    expect(mockToast.mock.calls.some(([msg, type]) => type === 'success' || /submitted/.test(msg))).toBe(false);
  });
});
