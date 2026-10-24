import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { makeClient, applicantRow, APPLICANT_ID } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import ApplicationPage from '../features/teacher-onboarding/pages/ApplicationPage.jsx';

const SESSION = { access_token: 'x', user: { id: APPLICANT_ID, user_metadata: { full_name: 'Applicant Alpha' } } };
const FELLOWSHIPS = [{ fellowship_code: 'CMU', campus_name: 'Campus Alpha' }, { fellowship_code: 'UOFT', campus_name: 'Toronto' }];

function tables({ profile = null, applications = [], fellowships = FELLOWSHIPS, profileError = null } = {}) {
  return {
    profiles: { data: profile, error: profileError },
    teacher_applications_applicant: { data: applications, error: null },
    fellowship_map: { data: fellowships, error: null },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/auth/teacher/application']}>
      <Routes>
        <Route path="/auth/teacher/application" element={<ApplicationPage />} />
        <Route path="/auth/login" element={<p>LOGIN PAGE</p>} />
        <Route path="/auth/teacher/register" element={<p>REGISTER PAGE</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function signedIn(options) {
  mock.client = makeClient({ tables: tables(options) });
  mock.client.auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
}

describe('ApplicationPage: access', () => {
  beforeEach(() => {
    mock.client = makeClient();
  });

  it('shows a sign-in prompt and makes no data calls when signed out', async () => {
    renderPage();
    expect(await screen.findByText(/Sign in to view or submit/)).toBeInTheDocument();
    expect(mock.client.from).not.toHaveBeenCalled();
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it('does not offer the applicant flow to an account that already has a portal role', async () => {
    signedIn({ profile: { role: 'teacher', full_name: 'Teacher Tina' } });
    renderPage();
    expect(await screen.findByText(/already has a portal role/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    const queried = mock.client.from.mock.calls.map((call) => call[0]);
    expect(queried).toEqual(['profiles']);
  });

  it('reads applicant data only through the applicant view, never the base table', async () => {
    signedIn({ profile: { role: 'pending', full_name: 'Applicant Alpha' }, applications: [] });
    renderPage();
    await screen.findByLabelText('Full name');
    const queried = mock.client.from.mock.calls.map((call) => call[0]);
    expect(queried).toContain('teacher_applications_applicant');
    expect(queried).not.toContain('teacher_applications');
  });

  it('shows an error state, not the applicant form, when the role check fails', async () => {
    signedIn({ profileError: { message: 'permission denied for table profiles' } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Something went wrong/);
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('ApplicationPage: status states', () => {
  it('shows the pending state with no edit form', async () => {
    signedIn({ profile: { role: 'pending' }, applications: [applicantRow({ status: 'SUBMITTED' })] });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Application received' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw application' })).toBeInTheDocument();
  });

  it('shows the applicant-visible request and a pre-filled update form', async () => {
    signedIn({
      profile: { role: 'pending' },
      applications: [applicantRow({ status: 'INFO_REQUESTED', review_message: 'Please confirm your fellowship leader.' })],
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'More information needed' })).toBeInTheDocument();
    expect(screen.getByText('Please confirm your fellowship leader.')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveValue('Applicant Alpha');
    expect(screen.getByRole('button', { name: 'Send updated application' })).toBeInTheDocument();
  });

  it('never shows an internal rejection reason, even if one reaches the client', async () => {
    signedIn({
      profile: { role: 'pending' },
      applications: [{ ...applicantRow({ status: 'REJECTED' }), rejection_reason: 'INTERNAL: duplicate of an old record' }],
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Application not approved' })).toBeInTheDocument();
    expect(screen.queryByText(/INTERNAL|duplicate of an old record/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('shows the approved-pending-activation state without asking for a sign-in yet', async () => {
    signedIn({ profile: { role: 'pending' }, applications: [applicantRow({ status: 'APPROVED' })] });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Application approved' })).toBeInTheDocument();
    expect(screen.getByText(/being activated/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('offers the form again after a withdrawal, noting the earlier withdrawal', async () => {
    signedIn({ profile: { role: 'pending' }, applications: [applicantRow({ status: 'WITHDRAWN' })] });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Apply to teach' })).toBeInTheDocument();
    expect(screen.getByText(/previous application was withdrawn/)).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
  });

  it('shows the form for a first-time applicant with a notice when fellowships cannot be loaded', async () => {
    signedIn({ profile: { role: 'pending' }, applications: [], fellowships: [] });
    renderPage();
    expect(await screen.findByText(/Fellowship choices are unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeDisabled();
  });
});

describe('ApplicationPage: submission', () => {
  it('validates the form before calling the submit function', async () => {
    const user = userEvent.setup();
    signedIn({ profile: { role: 'pending' }, applications: [] });
    renderPage();
    await screen.findByLabelText('Full name');
    await user.clear(screen.getByLabelText('Full name'));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText(/Enter your full name/)).toBeInTheDocument();
    expect(screen.getByText(/Choose the fellowship/)).toBeInTheDocument();
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it('calls submit_teacher_application with the foundation parameter names and nulls for empty optionals', async () => {
    const user = userEvent.setup();
    signedIn({ profile: { role: 'pending' }, applications: [] });
    renderPage();
    await screen.findByLabelText('Full name');
    await user.selectOptions(screen.getByLabelText('Fellowship'), 'CMU');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(mock.client.rpc).toHaveBeenCalledTimes(1));
    expect(mock.client.rpc).toHaveBeenCalledWith('submit_teacher_application', {
      p_full_name: 'Applicant Alpha',
      p_phone: null,
      p_fellowship_code: 'CMU',
      p_notes: null,
    });
  });

  it('guards double submission so one click sends one request', async () => {
    const user = userEvent.setup();
    let release;
    signedIn({ profile: { role: 'pending' }, applications: [] });
    mock.client.rpc.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderPage();
    await screen.findByLabelText('Full name');
    await user.selectOptions(screen.getByLabelText('Fellowship'), 'CMU');
    const button = screen.getByRole('button', { name: 'Submit application' });
    await user.dblClick(button);
    expect(mock.client.rpc).toHaveBeenCalledTimes(1);
    await act(async () => release({ data: { ok: true, outcome: 'SUBMITTED' }, error: null }));
  });

  it('maps a server rule to safe copy', async () => {
    const user = userEvent.setup();
    signedIn({ profile: { role: 'pending' }, applications: [] });
    mock.client.rpc.mockResolvedValue({ data: null, error: { message: 'EMAIL_NOT_VERIFIED: confirm your email address before applying' } });
    renderPage();
    await screen.findByLabelText('Full name');
    await user.selectOptions(screen.getByLabelText('Fellowship'), 'CMU');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your email address before you apply');
  });

  it('does not echo unrecognised server text', async () => {
    const user = userEvent.setup();
    signedIn({ profile: { role: 'pending' }, applications: [] });
    mock.client.rpc.mockResolvedValue({ data: null, error: { message: 'relation "teacher_applications" violates check constraint secret_rule' } });
    renderPage();
    await screen.findByLabelText('Full name');
    await user.selectOptions(screen.getByLabelText('Fellowship'), 'CMU');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/secret_rule|relation|constraint/);
  });
});

describe('ApplicationPage: withdrawal', () => {
  it('asks for confirmation first, then withdraws with the application id and version', async () => {
    const user = userEvent.setup();
    signedIn({ profile: { role: 'pending' }, applications: [applicantRow({ id: 'app-9', version: 4, status: 'SUBMITTED' })] });
    mock.client.rpc.mockResolvedValue({ data: { ok: true, status: 'WITHDRAWN' }, error: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Withdraw application' }));
    expect(mock.client.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/Withdraw this application\?/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, withdraw application' }));
    await waitFor(() => expect(mock.client.rpc).toHaveBeenCalledTimes(1));
    expect(mock.client.rpc).toHaveBeenCalledWith('withdraw_teacher_application', {
      p_application_id: 'app-9',
      p_expected_version: 4,
    });
  });

  it('can back out of a withdrawal without calling the server', async () => {
    const user = userEvent.setup();
    signedIn({ profile: { role: 'pending' }, applications: [applicantRow({ status: 'SUBMITTED' })] });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Withdraw application' }));
    await user.click(screen.getByRole('button', { name: 'Keep application' }));
    expect(mock.client.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Withdraw application' })).toBeInTheDocument();
  });
});
