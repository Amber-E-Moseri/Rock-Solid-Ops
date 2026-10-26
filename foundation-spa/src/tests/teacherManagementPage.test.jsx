import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeacherManagementPage from '../features/teacher-management/TeacherManagementPage.jsx';
import { fetchTeachers } from '../features/teacher-management/lib/teacherManagement.js';

vi.mock('../features/teacher-management/lib/teacherManagement.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchTeachers: vi.fn(),
  fetchFellowshipOptions: vi.fn().mockResolvedValue([]),
}));

// Stable toast reference, same reason as availabilityApprovalPage.test.jsx.
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
  teacher_user_id: null,
  created_at: '2026-10-01T00:00:00Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TeacherManagementPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeacherManagementPage load states', () => {
  it('shows an error banner with retry on a failed load, not "No teachers" or "0 teachers"', async () => {
    vi.mocked(fetchTeachers).mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load teachers.');
    expect(screen.queryByText('No teachers')).toBeNull();
    expect(screen.queryByText(/teachers$/)).toBeNull();
  });

  it('retries the load from the error banner', async () => {
    vi.mocked(fetchTeachers).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ teachers: [PENDING_ROW], classMap: new Map() });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(fetchTeachers).toHaveBeenCalledTimes(2);
  });

  it('renders the table and the mobile card view, with the admin actions on each', async () => {
    vi.mocked(fetchTeachers).mockResolvedValue({ teachers: [PENDING_ROW], classMap: new Map() });
    renderPage();

    await screen.findByRole('table');
    // Table row and card both show the name; the PENDING row offers Approve and Reject in both views.
    expect(screen.getAllByText('Ben Teacher')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(2);
    expect(screen.getByText('1 teachers')).toBeInTheDocument();
  });
});
