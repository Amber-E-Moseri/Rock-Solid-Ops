import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import TeacherManagementPage from '../features/teacher-management/TeacherManagementPage.jsx';
import AdminManagementPage from '../features/admin-management/AdminManagementPage.jsx';
import { fetchTeachers } from '../features/teacher-management/lib/teacherManagement.js';
import { fetchStaff, fetchTeachers as fetchAdminTeachers } from '../features/admin-management/lib/adminManagement.js';

// Real react-query hooks (no hook mocks) so the query state machine is exercised.
vi.mock('../features/teacher-management/lib/teacherManagement.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchTeachers: vi.fn(),
  fetchFellowshipOptions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../features/admin-management/lib/adminManagement.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchStaff: vi.fn(),
  fetchTeachers: vi.fn(),
}));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'admin', email: 'admin@example.com' }, user: { id: 'u-admin' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => mockToast,
}));

function renderWithClient(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('stalled (paused) queries are not shown as empty results', () => {
  it('teacher management: offline with no data shows the loading state, not "No teachers"', async () => {
    onlineManager.setOnline(false);
    vi.mocked(fetchTeachers).mockResolvedValue({ teachers: [], classMap: new Map() });
    renderWithClient(<TeacherManagementPage />);

    // The query is paused (fetchStatus 'paused'): nothing is loading and nothing has failed.
    expect(screen.queryByText('No teachers')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.rso-table')).toBeNull();
  });

  it('admin management staff tab: offline with no data shows the loading state, not "No staff"', async () => {
    onlineManager.setOnline(false);
    vi.mocked(fetchStaff).mockResolvedValue({ rows: [], idKey: 'id' });
    vi.mocked(fetchAdminTeachers).mockResolvedValue({ rows: [], idKey: 'teacher_id', nameKey: 'full_name' });
    renderWithClient(<AdminManagementPage />);

    expect(screen.queryByText('No staff')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('retry feedback', () => {
  it('teacher management: Retry shows the loading skeleton while the refetch is in flight', async () => {
    let attempts = 0;
    let resolveSecond;
    vi.mocked(fetchTeachers).mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('boom'));
      return new Promise((resolve) => { resolveSecond = () => resolve({ teachers: [], classMap: new Map() }); });
    });
    const { container } = renderWithClient(<TeacherManagementPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    // The query returns to pending on refetch, so the skeleton replaces the stale error banner.
    await waitFor(() => expect(container.querySelector('.rso-skeleton')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    resolveSecond();
    await waitFor(() => expect(screen.getByText('No teachers')).toBeInTheDocument());
  });
});
