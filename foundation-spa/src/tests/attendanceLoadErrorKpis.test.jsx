import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staff attendance KPIs on a class-load failure', () => {
  it('shows unavailable values, not zero rates or missing counts, and keeps the error with Retry', async () => {
    vi.mocked(fetchClasses).mockRejectedValue(new Error('permission denied for table class_options'));
    render(<AttendancePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load classes. permission denied for table class_options');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    const tiles = ['Submission rate', 'Classes missing', 'Flagged · multi-session', 'On-time rate']
      .map((label) => screen.getByText(label).parentElement.querySelector('div'));
    for (const tile of tiles) expect(tile.textContent).toBe('—');
  });

  it('keeps the submit control disabled while submission is held', async () => {
    vi.mocked(fetchClasses).mockResolvedValue([{
      id: 'c-1', time: 'Mon · 9:00 AM', loc: 'SG1', teacher: 'Jane Teacher', session: '—',
      flagSessions: [], submitted: null, roster: [{ name: 'Ann Student', student_id: 's-1', status: null }],
    }]);
    render(<AttendancePage />);

    const submit = await screen.findByRole('button', { name: 'Submit attendance' });
    await waitFor(() => expect(submit).toBeDisabled());
    expect(screen.getByText('Attendance status is not loaded in this view.')).toBeInTheDocument();
  });
});
