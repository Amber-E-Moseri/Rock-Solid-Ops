import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeacherPortalPage from '../features/teacher-portal/TeacherPortalPage.jsx';
import * as portal from '../features/teacher-portal/lib/teacherPortal.js';

// The availability chip badge is "active" only for the canonical status 'Available'.
// Every other status, including 'Tentative' and 'Unavailable', renders as "draft".

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

function slot(id, status) {
  return { id, teacher_id: 'T1', day: 'Monday', time_slot: '09:00:00', status };
}

function renderAvailability() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/teacher/index']}>
        <TeacherPortalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function badgeFor(status) {
  const label = await screen.findByText(status, { selector: 'span.rso-badge' });
  return label.className;
}

beforeEach(() => {
  vi.clearAllMocks();
  portal.resolveTeacher.mockResolvedValue(TEACHER);
  portal.fetchTeacherClasses.mockResolvedValue([]);
  portal.fetchStudentProgress.mockResolvedValue({ classes: [], students: [], milestones: [], attendance: [] });
});

describe('Teacher availability badge', () => {
  it.each([
    ['Available', 'rso-badge-active'],
    ['Unavailable', 'rso-badge-draft'],
    ['Tentative', 'rso-badge-draft'],
  ])('renders %s with the %s badge class', async (status, expectedClass) => {
    portal.fetchTeacherAvailability.mockResolvedValue([slot('S1', status)]);

    renderAvailability();
    fireEvent.click(await screen.findByRole('tab', { name: 'My Availability' }));

    expect(await badgeFor(status)).toContain(expectedClass);
  });

  it('does not treat a lowercase or legacy "approved" value as approved', async () => {
    portal.fetchTeacherAvailability.mockResolvedValue([slot('S1', 'approved')]);

    renderAvailability();
    fireEvent.click(await screen.findByRole('tab', { name: 'My Availability' }));

    expect(await badgeFor('approved')).toContain('rso-badge-draft');
  });
});
