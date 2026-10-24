import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  TEACHER_ACTIVATION_HELD,
  TEACHER_ACTIVATION_HOLD_MESSAGE,
  isTeacherActivationHeld,
} from '../releaseHolds.js';
import { supabase } from '../supabase.js';
import { performAction, fetchTeachers } from '../features/teacher-management/lib/teacherManagement.js';
import TeacherManagementPage from '../features/teacher-management/TeacherManagementPage.jsx';

// Every Supabase call is replaced. A held action must never reach any of them.
vi.mock('../supabase.js', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() }, auth: { getSession: vi.fn() } },
}));

vi.mock('../features/teacher-management/lib/teacherManagement.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchTeachers: vi.fn(),
  fetchFellowshipOptions: vi.fn().mockResolvedValue([]),
}));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'admin', email: 'admin@example.com' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

const PENDING_ROW = {
  teacher_id: 't-1',
  full_name: 'Ben Teacher',
  email: 'ben@example.com',
  fellowship_code: 'F1',
  group_id: 'G1',
  subgroup_id: 'S1',
  status: 'PENDING',
  teacher_user_id: 'user-1',
  created_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('teacher activation hold: default state', () => {
  it('is held by default and fails closed', () => {
    expect(TEACHER_ACTIVATION_HELD).toBe(true);
  });

  it('marks activate and unsuspend as held, and leaves other actions unheld', () => {
    expect(isTeacherActivationHeld('activate')).toBe(true);
    expect(isTeacherActivationHeld('unsuspend')).toBe(true);
    expect(isTeacherActivationHeld(' activate ')).toBe(true);
    expect(isTeacherActivationHeld('suspend')).toBe(false);
    expect(isTeacherActivationHeld('reject')).toBe(false);
    expect(isTeacherActivationHeld('inactivate')).toBe(false);
    expect(isTeacherActivationHeld('deactivate')).toBe(false);
  });
});

describe('performAction refuses held actions before any browser-side write', () => {
  it.each(['activate', 'unsuspend'])('%s rejects with the hold message and makes no Supabase call', async (action) => {
    await expect(performAction('t-1', action, '', 'admin@example.com', 'user-1'))
      .rejects.toThrow(TEACHER_ACTIVATION_HOLD_MESSAGE);

    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('keeps the hold when the teacher has no linked sign-in account', async () => {
    await expect(performAction('t-1', 'activate', '', 'admin@example.com', null))
      .rejects.toThrow(TEACHER_ACTIVATION_HOLD_MESSAGE);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('TeacherManagementPage while activation is held', () => {
  it('disables Approve and shows the hold message as its tooltip', async () => {
    vi.mocked(fetchTeachers).mockResolvedValue({ teachers: [PENDING_ROW], classMap: new Map() });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TeacherManagementPage />
      </QueryClientProvider>,
    );

    await screen.findByRole('table');
    const approve = screen.getAllByRole('button', { name: 'Approve' });
    expect(approve.length).toBeGreaterThan(0);
    for (const button of approve) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', TEACHER_ACTIVATION_HOLD_MESSAGE);
    }
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
