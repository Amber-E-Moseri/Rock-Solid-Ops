import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeacherAttendancePage from '../features/teacher-attendance/TeacherAttendancePage.jsx';
import * as api from '../features/teacher-attendance/lib/teacherAttendance.js';
import { ATTENDANCE_SUBMIT_HOLD_MESSAGE } from '../releaseHolds.js';

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'teacher', email: 'teacher@example.com' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

vi.mock('../features/teacher-attendance/lib/teacherAttendance.js', () => ({
  lookupTeacher: vi.fn(),
  getClassOptions: vi.fn(),
  loadRoster: vi.fn(),
  searchPerson: vi.fn(),
  getMilestones: vi.fn(),
  submitAttendance: vi.fn(),
  submitOutcomes: vi.fn(),
  fetchAttendanceHistory: vi.fn(),
  SESSIONS: ['Session 1', 'Session 2'],
  initials: (name) => String(name || '').charAt(0),
}));

const TEACHER = { teacherId: 'T1', fullName: 'Teach Er', email: 'teacher@example.com', subGroupLabel: 'Group A' };
const CLASS = { classOptionId: 'CO-1', day: 'Sunday', time: '10:00', batch: 'B1', enrolledCount: 1 };
const ROSTER = [{ id: 'p1', studentId: 's1', fullName: 'Ann Student', personType: 'Student', email: 'ann@example.com' }];

// Walks the wizard from teacher search to the Review step.
async function walkToReview() {
  render(<TeacherAttendancePage />);

  // Teacher search runs on mount and auto-selects the single match.
  await waitForEnabledContinue();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  fireEvent.click(await screen.findByRole('button', { name: /CO-1/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  fireEvent.click(await screen.findByRole('button', { name: /Mark Attendance/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Session 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Roster' }));

  fireEvent.click(await screen.findByRole('button', { name: /Review/ }));
}

// Walks to Review, then clicks Submit.
async function reachReviewAndSubmit() {
  await walkToReview();
  fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
}

// The Continue button is re-mounted when the teacher search finishes, so always
// query it fresh and wait until the search has selected a teacher.
async function waitForEnabledContinue() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
}

beforeEach(() => {
  vi.clearAllMocks();
  api.lookupTeacher.mockResolvedValue([TEACHER]);
  api.getClassOptions.mockResolvedValue([CLASS]);
  api.loadRoster.mockResolvedValue({ roster: ROSTER, alreadySubmitted: false });
  api.submitAttendance.mockResolvedValue({ ok: true });
  api.getMilestones.mockResolvedValue([]);
  api.submitOutcomes.mockResolvedValue({ ok: true });
  mockToast.mockImplementation(() => {});
});

describe('attendance submission while held', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.lookupTeacher.mockResolvedValue([TEACHER]);
    api.getClassOptions.mockResolvedValue([CLASS]);
    api.loadRoster.mockResolvedValue({ roster: ROSTER, alreadySubmitted: false });
    api.getMilestones.mockResolvedValue([]);
  });

  it('shows the hold notice and disables Submit; the save is never called', async () => {
    await walkToReview();
    expect(await screen.findByText(ATTENDANCE_SUBMIT_HOLD_MESSAGE)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(api.submitAttendance).not.toHaveBeenCalled();
  });
});
