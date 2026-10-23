import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Real query path: teacherPortal.js runs against a stubbed Supabase client. A class
// list that is malformed or failed must show an error with Retry, never "No classes".

const { invoke, fromMock } = vi.hoisted(() => ({ invoke: vi.fn(), fromMock: vi.fn() }));

vi.mock('../supabase.js', () => ({
  supabase: { functions: { invoke }, from: fromMock },
}));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'teacher', email: 'teacher@example.com', full_name: 'Teach Er' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({ useToast: () => () => {} }));

vi.mock('../features/teacher-schedule/lib/teacherSchedule.js', () => ({
  SLOTS: [], to24h: (t) => t, getActiveBatchId: vi.fn(async () => 'B1'),
}));

import TeacherPortalPage from '../features/teacher-portal/TeacherPortalPage.jsx';

const TWO_CLASSES = [
  { class_option_id: 'CO-1', class_name: 'Sunday 10:00', day: 'Sunday', class_time: '10:00', active: true, fellowship_codes: ['Men'] },
  { class_option_id: 'CO-2', class_name: 'Tuesday 19:00', day: 'Tuesday', class_time: '19:00', active: true, fellowship_codes: ['Women'] },
];

function chain(result) {
  const q = {
    select() { return q; }, eq() { return q; }, is() { return q; }, ilike() { return q; },
    in() { return q; }, limit() { return q; }, order() { return q; },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return q;
}

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
  fromMock.mockImplementation((table) => {
    if (table === 'teachers') return chain({ data: { teacher_id: 'T1', email: 'teacher@example.com', full_name: 'Teach Er' }, error: null });
    return chain({ data: [], error: null });
  });
  invoke.mockResolvedValue({ data: { ok: true, data: [] }, error: null });
});

describe('My Classes with the corrected contract', () => {
  it('shows every class for a teacher with multiple classes', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: TWO_CLASSES }, error: null });
    renderAt('/teacher/index');

    expect((await screen.findAllByText('Sunday 10:00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tuesday 19:00').length).toBeGreaterThan(0);
    expect(screen.queryByText('No classes')).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('shows "No classes" only for a genuine empty result', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: [] }, error: null });
    renderAt('/teacher/index');

    expect(await screen.findByText('No classes')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('shows an error with Retry when the request fails, not "No classes"', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('network down') })
      .mockResolvedValueOnce({ data: { ok: true, data: TWO_CLASSES }, error: null });
    renderAt('/teacher/index');

    expect(await screen.findByText(/Your classes could not be loaded: network down/)).toBeInTheDocument();
    expect(screen.queryByText('No classes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findAllByText('Sunday 10:00')).length).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('shows an error, not "No classes", when the envelope is malformed', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { unexpected: true } }, error: null });
    renderAt('/teacher/index');

    expect(await screen.findByText(/Your classes could not be loaded: Class list response was malformed/)).toBeInTheDocument();
    expect(screen.queryByText('No classes')).toBeNull();
  });

  it('shows the server message when the function reports ok: false', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: 'Teacher is not active' }, error: null });
    renderAt('/teacher/index');

    expect(await screen.findByText(/Your classes could not be loaded: Teacher is not active/)).toBeInTheDocument();
    expect(screen.queryByText('No classes')).toBeNull();
  });
});

describe('Student Progress with the corrected contract', () => {
  it('loads for a teacher with multiple classes and shows "No students" only when none are enrolled', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: TWO_CLASSES }, error: null });
    renderAt('/teacher/progress');

    expect(await screen.findByText('No students')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('shows an error, not "No students", when the class list is malformed', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: 'nope' }, error: null });
    renderAt('/teacher/progress');

    expect(await screen.findByText(/Student progress could not be loaded: Class list response was malformed/)).toBeInTheDocument();
    expect(screen.queryByText('No students')).toBeNull();
  });

  it('shows the error with Retry when the class request fails', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('timeout') });
    renderAt('/teacher/progress');

    expect(await screen.findByText(/Student progress could not be loaded: timeout/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No students')).toBeNull();
  });
});
