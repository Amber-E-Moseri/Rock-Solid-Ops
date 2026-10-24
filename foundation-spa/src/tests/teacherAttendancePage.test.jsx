import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../releaseHolds.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ATTENDANCE_SUBMIT_CERTIFIED: true,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeacherAttendancePage from '../features/teacher-attendance/TeacherAttendancePage.jsx';
import * as api from '../features/teacher-attendance/lib/teacherAttendance.js';

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

describe('TeacherAttendancePage submit sequence', () => {
  it('writes attendance once, and a throwing success toast does not trigger a second write', async () => {
    mockToast.mockImplementation((message, type) => {
      if (type === 'success') throw new Error('toast failed');
    });

    await reachReviewAndSubmit();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Select Class' })).toBeInTheDocument());
    expect(api.submitAttendance).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Attendance submitted', 'success');
  });

  it('moves to the saved state after confirmed save and shows a secondary error when milestones fail', async () => {
    api.getMilestones.mockRejectedValue(new Error('milestones unavailable'));

    await reachReviewAndSubmit();

    expect(await screen.findByRole('heading', { name: 'Attendance saved' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('could not be loaded: milestones unavailable');
    expect(screen.queryByRole('heading', { name: 'Review & Submit' })).toBeNull();
    expect(api.submitAttendance).toHaveBeenCalledTimes(1);
  });

  it('retry after a milestone failure re-reads outcomes only and never resubmits attendance', async () => {
    api.getMilestones.mockRejectedValueOnce(new Error('milestones unavailable'));

    await reachReviewAndSubmit();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry loading outcomes' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Select Class' })).toBeInTheDocument());
    expect(api.getMilestones).toHaveBeenCalledTimes(2);
    expect(api.submitAttendance).toHaveBeenCalledTimes(1);
  });

  it('shows the saved state before outcome questions finish loading', async () => {
    let resolveMilestones;
    api.getMilestones.mockImplementation(() => new Promise((r) => { resolveMilestones = r; }));

    await reachReviewAndSubmit();

    expect(await screen.findByRole('heading', { name: 'Attendance saved' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    resolveMilestones([]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Select Class' })).toBeInTheDocument());
  });

  it('a rapid second press while the save is in flight does not write again', async () => {
    let resolveSave;
    api.submitAttendance.mockImplementation(() => new Promise((r) => { resolveSave = r; }));

    await walkToReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(api.submitAttendance).toHaveBeenCalledTimes(1));
    // While the save is in flight the Review step is not rendered, so no Submit control
    // exists for a repeat press. The in-flight ref is the backstop behind this.
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    resolveSave({ ok: true });
    // No outcome questions for this session, so the saved confirmation hands off to class selection.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Select Class' })).toBeInTheDocument());
    expect(api.submitAttendance).toHaveBeenCalledTimes(1);
  });

  it('a failed save stays on Review and can be submitted again', async () => {
    api.submitAttendance
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true });

    await reachReviewAndSubmit();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('network down', 'error'));
    expect(screen.getByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Select Class' })).toBeInTheDocument());
    expect(api.submitAttendance).toHaveBeenCalledTimes(2);
  });
});

describe('TeacherAttendancePage accessibility', () => {
  it('marks the current step and exposes selection as pressed state', async () => {
    render(<TeacherAttendancePage />);
    await waitForEnabledContinue();

    const current = screen.getByText('Teacher', { selector: 'li' });
    expect(current).toHaveAttribute('aria-current', 'step');

    const teacherCard = screen.getByRole('button', { name: /Teach Er/ });
    expect(teacherCard).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the unavailable progress choice as a disabled button', async () => {
    render(<TeacherAttendancePage />);
    await waitForEnabledContinue();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: /CO-1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('button', { name: /View Student Progress/ })).toBeDisabled();
  });
});
