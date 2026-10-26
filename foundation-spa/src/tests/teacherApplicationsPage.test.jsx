import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeClient } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null, auth: null, toast: null }));

vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));
vi.mock('../context/AuthContext.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => mock.auth };
});
vi.mock('../context/ToastContext.jsx', () => ({ useToast: () => mock.toast }));

import TeacherApplicationsPage from '../features/teacher-applications/TeacherApplicationsPage.jsx';

const ADMIN_USER = { id: 'u-admin', email: 'admin@example.org' };

const ALPHA = {
  id: 'app-alpha', applicant_user_id: 'u-alpha', email: 'alpha@example.org', full_name: 'Applicant Alpha',
  phone: '+1 555 0100', fellowship_code: 'CMU', notes: 'Happy to help on Sundays', status: 'SUBMITTED', version: 2,
  review_message: null, rejection_reason: null, email_verified_at: '2026-10-20T10:00:00Z',
  submitted_at: '2026-10-20T12:00:00Z', reviewed_at: null, reviewed_by: null, approved_teacher_id: null,
  updated_at: '2026-10-20T12:00:00Z',
};
const BETA = {
  ...ALPHA, id: 'app-beta', applicant_user_id: 'u-beta', email: 'beta@example.org', full_name: 'Applicant Beta',
  fellowship_code: 'UOFT', status: 'INFO_REQUESTED', version: 3, review_message: 'Please add a phone number.',
  submitted_at: '2026-10-21T12:00:00Z',
};
const GAMMA = {
  ...ALPHA, id: 'app-gamma', applicant_user_id: 'u-gamma', email: 'gamma@example.org', full_name: 'Applicant Gamma',
  status: 'REJECTED', version: 4, rejection_reason: 'INTERNAL: duplicate of an older record',
  reviewed_at: '2026-10-22T09:00:00Z', submitted_at: '2026-10-22T12:00:00Z',
};
const DELTA = {
  ...ALPHA, id: 'app-delta', applicant_user_id: 'u-delta', email: 'delta@example.org', full_name: 'Applicant Delta',
  status: 'APPROVED', version: 5, approved_teacher_id: 'T-100', submitted_at: '2026-10-23T12:00:00Z',
};

function setup({ rows = [ALPHA, BETA, GAMMA, DELTA], role = 'admin', tables = {}, rpc, userId = ADMIN_USER.id } = {}) {
  mock.auth = { user: { id: userId, email: ADMIN_USER.email }, profile: { role, is_active: true, email: ADMIN_USER.email } };
  mock.toast = vi.fn();
  mock.client = makeClient({
    tables: {
      teacher_applications_review: { data: rows, error: null },
      teachers: { data: [], error: null },
      email_queue: { data: [], error: null },
      audit_logs: { data: [], error: null },
      ...tables,
    },
    rpc: rpc ?? (async () => ({ data: { ok: true }, error: null })),
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TeacherApplicationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function detail() {
  return screen.getByRole('region', { name: 'Application detail' });
}

async function openApplication(name) {
  const user = userEvent.setup();
  const buttons = await screen.findAllByRole('button', { name });
  await user.click(buttons[0]);
  return user;
}

describe('TeacherApplicationsPage: access', () => {
  beforeEach(() => setup());

  it.each(['pastor', 'principal', 'subgroup_admin', 'regional_secretary', 'teacher', 'pending'])(
    'shows no applications and makes no data calls for the %s role',
    async (role) => {
      setup({ role });
      renderPage();
      expect(await screen.findByText('Not available for your role')).toBeInTheDocument();
      expect(screen.queryByText('Applicant Alpha')).not.toBeInTheDocument();
      expect(mock.client.from).not.toHaveBeenCalled();
      expect(mock.client.rpc).not.toHaveBeenCalled();
    },
  );

  it('loads the queue for an admin and for a superadmin', async () => {
    for (const role of ['admin', 'superadmin']) {
      setup({ role });
      const { unmount } = renderPage();
      expect(await screen.findAllByText('Applicant Alpha')).not.toHaveLength(0);
      unmount();
    }
  });
});

describe('TeacherApplicationsPage: queue, search and filters', () => {
  beforeEach(() => setup());

  it('lists applications with status labels and a count', async () => {
    renderPage();
    expect(await screen.findByText('4 of 4 applications shown')).toBeInTheDocument();
    expect(screen.getAllByText('Applicant Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approved, activation pending').length).toBeGreaterThan(0);
  });

  it('searches by name and by email', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 of 4 applications shown');
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'beta@');
    expect(await screen.findByText('1 of 4 applications shown')).toBeInTheDocument();
    expect(screen.getAllByText('Applicant Beta').length).toBeGreaterThan(0);
    expect(screen.queryByText('Applicant Alpha')).not.toBeInTheDocument();
  });

  it('filters by status and by fellowship together', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 of 4 applications shown');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'SUBMITTED');
    expect(await screen.findByText('1 of 4 applications shown')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'ALL');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by fellowship' }), 'UOFT');
    expect(await screen.findByText('1 of 4 applications shown')).toBeInTheDocument();
    expect(screen.getAllByText('Applicant Beta').length).toBeGreaterThan(0);
  });

  it('shows an empty message when no application matches', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 of 4 applications shown');
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'zzz-no-match');
    expect((await screen.findAllByText('No applications match these filters.')).length).toBeGreaterThan(0);
    expect(screen.getByText('0 of 4 applications shown')).toBeInTheDocument();
  });

  it('shows a retry state when the queue cannot be loaded', async () => {
    setup({ tables: { teacher_applications_review: { data: null, error: { message: 'boom' } } } });
    renderPage();
    expect(await screen.findByText('Applications could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('never selects the base table or any write path', async () => {
    renderPage();
    await screen.findByText('4 of 4 applications shown');
    const tables = mock.client.from.mock.calls.map((call) => call[0]);
    expect(tables).toContain('teacher_applications_review');
    for (const table of new Set(tables)) {
      expect(['teacher_applications_review', 'teachers', 'email_queue', 'audit_logs']).toContain(table);
    }
    expect(tables).not.toContain('teacher_applications');
    expect(tables).not.toContain('profiles');
    for (const result of mock.client.from.mock.results) {
      for (const forbidden of ['insert', 'update', 'upsert', 'delete']) {
        expect(result.value[forbidden]).toBeUndefined();
      }
    }
  });
});

describe('TeacherApplicationsPage: detail', () => {
  beforeEach(() => setup());

  it('shows the verified-email indicator and the applicant notes as plain text', async () => {
    renderPage();
    await openApplication('Applicant Alpha');
    expect(within(detail()).getByText(/Email verified/)).toBeInTheDocument();
    expect(within(detail()).getByText('Happy to help on Sundays')).toBeInTheDocument();
  });

  it('marks an unverified email clearly', async () => {
    setup({ rows: [{ ...ALPHA, email_verified_at: null }] });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(within(detail()).getByText('Email not verified')).toBeInTheDocument();
  });

  it('shows the applicant-visible request, and labels the internal rejection reason as internal', async () => {
    renderPage();
    await openApplication('Applicant Beta');
    expect(within(detail()).getByText(/Please add a phone number/)).toBeInTheDocument();
    await openApplication('Applicant Gamma');
    expect(within(detail()).getByText(/Internal rejection reason/)).toBeInTheDocument();
    expect(within(detail()).getByText(/Never shown to the applicant/)).toBeInTheDocument();
  });

  it('shows the pending activation state for an approved application and never claims the account is active', async () => {
    renderPage();
    await openApplication('Applicant Delta');
    const scope = within(detail());
    expect(scope.getByText(/activated only after the teacher-link contract confirms/)).toBeInTheDocument();
    expect(scope.getByText('Linked roster record: T-100')).toBeInTheDocument();
    expect(scope.queryByText(/account is active/i)).not.toBeInTheDocument();
  });

  it('shows decision controls only for open applications', async () => {
    renderPage();
    await openApplication('Applicant Gamma');
    expect(within(detail()).getByText('No decision is open for this status.')).toBeInTheDocument();
    expect(within(detail()).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('shows the email delivery state and points failed emails to the Retry Center without a resend control', async () => {
    setup({
      tables: {
        email_queue: {
          data: [{ id: 'e1', template_key: 'teacher_application_received', status: 'Failed', sent_at: null, created_at: '2026-10-20T12:00:00Z' }],
          error: null,
        },
      },
    });
    renderPage();
    await openApplication('Applicant Alpha');
    const scope = within(detail());
    expect(await scope.findByText('Application received')).toBeInTheDocument();
    expect(scope.getByText('Failed')).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'Retry Center' })).toHaveAttribute('href', '/staff/failed-sync-retry-center');
    expect(scope.queryByRole('button', { name: /resend|retry/i })).not.toBeInTheDocument();
  });

  it('explains when notification and history data are not available, without failing the page', async () => {
    setup({
      tables: {
        email_queue: { data: null, error: { message: 'permission denied' } },
        audit_logs: { data: null, error: { message: 'permission denied' } },
      },
    });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(await within(detail()).findByText('Notification status is not available to this account.')).toBeInTheDocument();
    expect(within(detail()).getByText('Review history is not available to this account.')).toBeInTheDocument();
    expect(within(detail()).getByRole('button', { name: 'Request information' })).toBeInTheDocument();
  });

  it('renders review history with readable labels, not raw action names', async () => {
    setup({
      tables: {
        audit_logs: {
          data: [{ logged_at: '2026-10-22T09:00:00Z', action: 'TEACHER_APPLICATION_REJECTED', status: 'SUCCESS' }],
          error: null,
        },
      },
    });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(await within(detail()).findByText('Rejected')).toBeInTheDocument();
    expect(within(detail()).queryByText('TEACHER_APPLICATION_REJECTED')).not.toBeInTheDocument();
  });
});

describe('TeacherApplicationsPage: roster warnings', () => {
  beforeEach(() => setup());

  it('warns when one live roster record already uses the email', async () => {
    setup({ tables: { teachers: { data: [{ teacher_id: 'T-9', status: 'PENDING', deleted_at: null }], error: null } } });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(await within(detail()).findByText('An existing roster record uses this email.')).toBeInTheDocument();
    expect(within(detail()).getByText(/Approval must link this record, not create a second teacher/)).toBeInTheDocument();
  });

  it('warns on an ambiguous roster and does not hide it', async () => {
    setup({
      tables: {
        teachers: {
          data: [{ teacher_id: 'T-1', status: 'ACTIVE', deleted_at: null }, { teacher_id: 'T-2', status: 'INACTIVE', deleted_at: null }],
          error: null,
        },
      },
    });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(await within(detail()).findByText('2 roster records use this email.')).toBeInTheDocument();
  });

  it('says when no roster record exists', async () => {
    renderPage();
    await openApplication('Applicant Alpha');
    expect(await within(detail()).findByText('No roster record uses this email.')).toBeInTheDocument();
  });

  it('tells the reviewer not to decide when the roster check fails', async () => {
    setup({ tables: { teachers: { data: null, error: { message: 'x' } } } });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(await within(detail()).findByText(/Do not decide until it can be/)).toBeInTheDocument();
  });
});

describe('TeacherApplicationsPage: approve control', () => {
  beforeEach(() => setup());

  it('keeps Approve disabled with an explanation, and calls no approval path', async () => {
    renderPage();
    await openApplication('Applicant Alpha');
    const approve = within(detail()).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('aria-describedby', 'ta-approve-hold');
    expect(within(detail()).getByText(/Approval is held until the teacher account link is certified/)).toBeInTheDocument();
    expect(within(detail()).getByText(/No approval can be recorded from this screen/)).toBeInTheDocument();
  });

  it('keeps Approve disabled even for an open application with no roster conflict', async () => {
    renderPage();
    await openApplication('Applicant Beta');
    expect(within(detail()).getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});

describe('TeacherApplicationsPage: decisions', () => {
  it('requests information with the applicant-visible message, the current version, and a toast', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    setup({ rpc });
    renderPage();
    const user = await openApplication('Applicant Alpha');
    await user.click(within(detail()).getByRole('button', { name: 'Request information' }));

    const dialog = screen.getByRole('dialog', { name: 'Request more information' });
    const confirm = within(dialog).getByRole('button', { name: 'Send request' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Message to the applicant'), '  Please add your home campus.  ');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('review_teacher_application', {
      p_application_id: 'app-alpha',
      p_action: 'REQUEST_INFO',
      p_expected_version: 2,
      p_message: 'Please add your home campus.',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.toast).toHaveBeenCalledWith('Decision recorded. The applicant has been notified by email.', 'success');
  });

  it('rejects with an internal reason and warns that it is not shown to the applicant', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    setup({ rpc });
    renderPage();
    const user = await openApplication('Applicant Alpha');
    await user.click(within(detail()).getByRole('button', { name: 'Reject' }));

    const dialog = screen.getByRole('dialog', { name: 'Reject application' });
    expect(within(dialog).getByText(/generic email that does not include your reason/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Internal reason (never shown to the applicant)'), 'Not a fit for this term');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm rejection' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('review_teacher_application', expect.objectContaining({
      p_action: 'REJECT',
      p_message: 'Not a fit for this term',
    })));
  });

  it('refuses a message longer than 1000 characters before any call', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    setup({ rpc });
    renderPage();
    const user = await openApplication('Applicant Alpha');
    await user.click(within(detail()).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject application' });
    await user.click(within(dialog).getByLabelText('Internal reason (never shown to the applicant)'));
    await user.paste('x'.repeat(1001));
    expect(within(dialog).getByText('Use 1000 characters or fewer.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm rejection' })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows a clear conflict message and reloads when another reviewer changed the application', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'VERSION_CONFLICT: the application changed. Reload and try again' } }));
    setup({ rpc });
    renderPage();
    const user = await openApplication('Applicant Alpha');
    const queueCallsBefore = mock.client.from.mock.calls.filter((c) => c[0] === 'teacher_applications_review').length;
    await user.click(within(detail()).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject application' });
    await user.type(within(dialog).getByLabelText('Internal reason (never shown to the applicant)'), 'Reason');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm rejection' }));

    expect(await within(dialog).findByText(/Someone else changed this application/)).toBeInTheDocument();
    await waitFor(() => {
      const queueCallsAfter = mock.client.from.mock.calls.filter((c) => c[0] === 'teacher_applications_review').length;
      expect(queueCallsAfter).toBeGreaterThan(queueCallsBefore);
    });
    expect(screen.getByRole('dialog', { name: 'Reject application' })).toBeInTheDocument();
    expect(mock.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('shows generic copy for unexpected server errors and never echoes the raw text', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'relation "teacher_applications" denied for role authenticated at 10.1.2.3' } }));
    setup({ rpc });
    renderPage();
    const user = await openApplication('Applicant Alpha');
    await user.click(within(detail()).getByRole('button', { name: 'Request information' }));
    const dialog = screen.getByRole('dialog', { name: 'Request more information' });
    await user.type(within(dialog).getByLabelText('Message to the applicant'), 'Please update');
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The decision could not be recorded. Try again in a moment.');
    expect(dialog.textContent).not.toMatch(/10\.1\.2\.3|relation|authenticated/);
  });

  it('lets the reviewer cancel without sending anything', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    setup({ rpc });
    renderPage();
    const user = await openApplication('Applicant Alpha');
    await user.click(within(detail()).getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks deciding one\'s own application in the UI, with the backend still the enforcement point', async () => {
    setup({ userId: 'u-alpha' });
    renderPage();
    await openApplication('Applicant Alpha');
    expect(within(detail()).getByText('You submitted this application, so you cannot decide it.')).toBeInTheDocument();
    expect(within(detail()).getByRole('button', { name: 'Request information' })).toBeDisabled();
    expect(within(detail()).getByRole('button', { name: 'Reject' })).toBeDisabled();
  });
});

describe('TeacherApplicationsPage: layout hooks', () => {
  it('renders a mobile card view alongside the table', async () => {
    setup();
    const { container } = renderPage();
    await screen.findByText('4 of 4 applications shown');
    expect(container.querySelectorAll('.rso-table-card').length).toBeGreaterThan(0);
    expect(container.querySelector('.ta-layout')).toBeInTheDocument();
  });
});
