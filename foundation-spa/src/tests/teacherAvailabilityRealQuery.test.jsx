import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Exercises the real teacherPortal.js query path. Only the Supabase client is
// replaced, so a failed read arrives as a Supabase error object, as it does in
// the browser (supabase-js returns { data: null, error } and does not throw).
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock('../supabase.js', () => ({ supabase: { from: fromMock } }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'teacher', email: 'teacher@example.com', full_name: 'Teach Er' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({ useToast: () => () => {} }));

vi.mock('../features/teacher-schedule/lib/teacherSchedule.js', () => ({
  SLOTS: [], to24h: (t) => t, getActiveBatchId: vi.fn(async () => 'B1'),
}));

import TeacherPortalPage from '../features/teacher-portal/TeacherPortalPage.jsx';

// A chainable query stub that resolves to the given result when awaited.
function chain(result) {
  const q = {
    select() { return q; }, eq() { return q; }, is() { return q; }, ilike() { return q; },
    order() { return q; }, limit() { return q; }, maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return q;
}

describe('Availability with the real query path', () => {
  it('a Supabase error on teacher_availability shows the error and Retry, not the empty state', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'teachers') return chain({ data: { teacher_id: 'T1', email: 'teacher@example.com' }, error: null });
      if (table === 'teacher_availability') return chain({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
      return chain({ data: [], error: null });
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/teacher/availability']}>
          <TeacherPortalPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Your availability could not be loaded: TypeError: Failed to fetch/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No availability yet')).toBeNull();
  });
});
