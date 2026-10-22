import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminManagementPage from '../features/admin-management/AdminManagementPage.jsx';
import { useStaff, useTeachers } from '../features/admin-management/hooks/useAdminManagement.js';

vi.mock('../features/admin-management/hooks/useAdminManagement.js', () => ({
  useStaff: vi.fn(),
  useTeachers: vi.fn(),
  useToggleStaffActive: () => ({ mutateAsync: vi.fn() }),
  useSaveStaff: () => ({ mutateAsync: vi.fn() }),
  useToggleTeacherActive: () => ({ mutateAsync: vi.fn() }),
  useSaveTeacher: () => ({ mutateAsync: vi.fn() }),
  useLinkTeacher: () => ({ mutateAsync: vi.fn() }),
  useUnlinkTeacher: () => ({ mutateAsync: vi.fn() }),
  useCreateStaffDirect: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: 'admin', email: 'admin@example.com' }, user: { id: 'u-admin' } }),
}));

vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => vi.fn(),
}));

const STAFF_ROW = { id: 's1', full_name: 'Ann Admin', email: 'ann@example.com', role: 'admin', is_active: true };
const idle = { isPending: false, isFetching: false, isError: false, error: null, refetch: vi.fn() };

function setStaff(state) {
  vi.mocked(useStaff).mockReturnValue({ ...idle, ...state });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTeachers).mockReturnValue({ ...idle, data: { rows: [], idKey: 'teacher_id', nameKey: 'full_name' } });
});

describe('AdminManagementPage staff list states', () => {
  it('shows a skeleton while loading, not an empty list', () => {
    setStaff({ isPending: true, data: undefined });
    render(<AdminManagementPage />);
    expect(screen.queryByText('No staff')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an error banner with retry when the query fails, not "No staff"', () => {
    const refetch = vi.fn();
    setStaff({ isError: true, error: new Error('network down'), refetch, data: undefined });
    render(<AdminManagementPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load staff. network down');
    expect(screen.queryByText('No staff')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no staff rows', () => {
    setStaff({ data: { rows: [], idKey: 'id' } });
    render(<AdminManagementPage />);
    expect(screen.getByText('No staff')).toBeInTheDocument();
  });

  it('renders the table and the mobile card view for each staff row', () => {
    setStaff({ data: { rows: [STAFF_ROW], idKey: 'id' } });
    render(<AdminManagementPage />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    // Table cell and card title both carry the name; the card view is the mobile fallback.
    expect(screen.getAllByText('Ann Admin')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit Role' })).toHaveLength(2);
  });
});

describe('AdminManagementPage teachers tab states', () => {
  const TEACHER_ROW = { teacher_id: 't1', full_name: 'Tia Teacher', email: 'tia@example.com', group_id: 'G1', subgroup_id: 'S1' };
  const TEACHER_META = { rows: [TEACHER_ROW], idKey: 'teacher_id', nameKey: 'full_name' };

  it('shows an error banner with retry on the teachers tab, not "No teachers"', () => {
    setStaff({ data: { rows: [], idKey: 'id' } });
    vi.mocked(useTeachers).mockReturnValue({ ...idle, isError: true, error: new Error('down'), refetch: vi.fn(), data: undefined });
    render(<AdminManagementPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Teachers' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load teachers. down');
    expect(screen.queryByText('No teachers')).toBeNull();
  });

  it('renders the table and the mobile card view with the teacher actions on each', () => {
    setStaff({ data: { rows: [], idKey: 'id' } });
    vi.mocked(useTeachers).mockReturnValue({ ...idle, data: TEACHER_META });
    render(<AdminManagementPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Teachers' }));

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('Tia Teacher')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
  });
});
