import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeacherPortalPage from '../features/teacher-portal/TeacherPortalPage.jsx';
import * as portal from '../features/teacher-portal/lib/teacherPortal.js';

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'teacher', email: 'teacher@example.com', full_name: 'Teach Er' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

vi.mock('../features/teacher-portal/lib/teacherPortal.js', () => ({
  resolveTeacher: vi.fn(),
  fetchTeacherClasses: vi.fn(),
  fetchTeacherAvailability: vi.fn(),
  deleteAvailability: vi.fn(),
  insertAvailability: vi.fn(),
  fetchStudentProgress: vi.fn(),
  computeAttendanceRate: vi.fn(() => 0),
  getMilestoneFlags: vi.fn(() => []),
}));

vi.mock('../features/teacher-schedule/lib/teacherSchedule.js', () => ({
  SLOTS: ['6:00 AM', '7:00 AM'],
  to24h: (t) => t,
  getActiveBatchId: vi.fn(async () => 'B1'),
}));

function renderAvailability() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/teacher/availability']}>
        <TeacherPortalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  portal.resolveTeacher.mockResolvedValue({ teacher_id: 'T1', email: 'teacher@example.com', full_name: 'Teach Er' });
  portal.fetchTeacherClasses.mockResolvedValue([]);
  portal.fetchTeacherAvailability.mockResolvedValue([]);
  portal.fetchStudentProgress.mockResolvedValue([]);
  mockToast.mockImplementation(() => {});
});

describe('Teacher availability states', () => {
  it('a failed read shows an error and Retry, never the empty state', async () => {
    portal.fetchTeacherAvailability.mockRejectedValue(new Error('network down'));

    renderAvailability();

    expect(await screen.findByText(/Your availability could not be loaded: network down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No availability yet')).toBeNull();
  });

  it('Retry re-reads availability and shows the empty state once the read succeeds', async () => {
    portal.fetchTeacherAvailability
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);

    renderAvailability();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No availability yet')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    expect(portal.fetchTeacherAvailability).toHaveBeenCalledTimes(2);
    // Retry is read-only: it never inserts or deletes availability rows.
    expect(portal.insertAvailability).not.toHaveBeenCalled();
    expect(portal.deleteAvailability).not.toHaveBeenCalled();
  });

  it('a successful empty read still shows the empty state, not the error', async () => {
    renderAvailability();

    expect(await screen.findByText('No availability yet')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('shows loading placeholders while the read is pending, with no empty or error text', async () => {
    let resolveRead;
    portal.fetchTeacherAvailability.mockImplementation(() => new Promise((r) => { resolveRead = r; }));

    renderAvailability();

    await waitFor(() => expect(portal.fetchTeacherAvailability).toHaveBeenCalled());
    expect(screen.queryByText('No availability yet')).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    resolveRead([]);
    expect(await screen.findByText('No availability yet')).toBeInTheDocument();
  });
});
