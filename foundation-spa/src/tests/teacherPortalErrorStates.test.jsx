import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeacherPortalPage from '../features/teacher-portal/TeacherPortalPage.jsx';
import * as portal from '../features/teacher-portal/lib/teacherPortal.js';

// A failed read must show an error with Retry. It must never look like an empty list.

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'teacher', email: 'teacher@example.com', full_name: 'Teach Er' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({ useToast: () => () => {} }));

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
  SLOTS: [], to24h: (t) => t, getActiveBatchId: vi.fn(async () => 'B1'),
}));

const TEACHER = { teacher_id: 'T1', email: 'teacher@example.com', full_name: 'Teach Er' };

function renderAt(path) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TeacherPortalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  portal.resolveTeacher.mockResolvedValue(TEACHER);
  portal.fetchTeacherClasses.mockResolvedValue([]);
  portal.fetchTeacherAvailability.mockResolvedValue([]);
  portal.fetchStudentProgress.mockResolvedValue({ classes: [], students: [], milestones: [], attendance: [] });
});

describe('Teacher portal error states', () => {
  it('a failed teacher profile lookup shows an error and Retry, not "Teacher not found"', async () => {
    portal.resolveTeacher
      .mockRejectedValueOnce(new Error('profile read failed'))
      .mockResolvedValueOnce(TEACHER);

    renderAt('/teacher/index');

    expect(await screen.findByText(/Your teacher profile could not be loaded: profile read failed/)).toBeInTheDocument();
    expect(screen.queryByText('Teacher not found')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No classes')).toBeInTheDocument();
    expect(portal.resolveTeacher).toHaveBeenCalledTimes(2);
  });

  it('a failed class list shows an error and Retry, not "No classes"', async () => {
    portal.fetchTeacherClasses
      .mockRejectedValueOnce(new Error('classes read failed'))
      .mockResolvedValueOnce([]);

    renderAt('/teacher/index');

    expect(await screen.findByText(/Your classes could not be loaded: classes read failed/)).toBeInTheDocument();
    expect(screen.queryByText('No classes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No classes')).toBeInTheDocument();
    expect(portal.fetchTeacherClasses).toHaveBeenCalledTimes(2);
  });

  it('a failed progress read shows an error and Retry, not "No students"', async () => {
    portal.fetchStudentProgress
      .mockRejectedValueOnce(new Error('progress read failed'))
      .mockResolvedValueOnce({ classes: [], students: [], milestones: [], attendance: [] });

    renderAt('/teacher/progress');

    expect(await screen.findByText(/Student progress could not be loaded: progress read failed/)).toBeInTheDocument();
    expect(screen.queryByText('No students')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No students')).toBeInTheDocument();
    expect(portal.fetchStudentProgress).toHaveBeenCalledTimes(2);
  });

  it('a successful empty class list still shows "No classes", distinct from the error', async () => {
    renderAt('/teacher/index');

    expect(await screen.findByText('No classes')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('Retry on a read failure never writes availability', async () => {
    portal.fetchTeacherClasses
      .mockRejectedValueOnce(new Error('classes read failed'))
      .mockResolvedValueOnce([]);

    renderAt('/teacher/index');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(portal.fetchTeacherClasses).toHaveBeenCalledTimes(2));

    expect(portal.insertAvailability).not.toHaveBeenCalled();
    expect(portal.deleteAvailability).not.toHaveBeenCalled();
  });
});
