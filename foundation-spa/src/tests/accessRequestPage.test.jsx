import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  user: null,
  rpcs: {},
  mine: { general: [], teacher: [] },
  calls: [],
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: state.user, loading: false, signOut: vi.fn(), profile: null, role: null }),
}));

vi.mock('../supabase.js', () => {
  const rowsFor = (table) => {
    if (table === 'access_requests_applicant') return state.mine.general;
    if (table === 'teacher_applications_applicant') return state.mine.teacher;
    return [];
  };
  const builder = (rows) => {
    const api = {
      select: () => api,
      order: () => api,
      limit: async () => ({ data: rows, error: null }),
    };
    return api;
  };
  return {
    supabase: {
      rpc: (name, args) => {
        state.calls.push({ name, args });
        const fn = state.rpcs[name];
        return fn ? fn(args) : Promise.resolve({ data: null, error: null });
      },
      from: (table) => builder(rowsFor(table)),
      auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), resend: vi.fn() },
    },
  };
});

import RequestAccessPage from '../features/access-request/RequestAccessPage.jsx';

const ORG = [
  { group_id: 'CE', subgroups: [
    { subgroup_id: 'CESGA', fellowships: [{ code: 'CMU', campus: 'Central Main' }] },
    { subgroup_id: 'CESGB', fellowships: [{ code: 'YORK', campus: 'York Campus' }] },
  ] },
  { group_id: 'CS', subgroups: [
    { subgroup_id: 'CSGA', fellowships: [{ code: 'STOR', campus: 'Storefront' }] },
  ] },
];

const VERIFIED = { id: '00000000-0000-4000-8000-0000000000a2', email: 'pat@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' };

beforeEach(() => {
  state.user = VERIFIED;
  state.calls = [];
  state.mine = { general: [], teacher: [] };
  state.rpcs = {
    access_request_org_options: async () => ({ data: ORG, error: null }),
    submit_access_request: async () => ({ data: { ok: true, outcome: 'SUBMITTED', status: 'SUBMITTED', version: 1 }, error: null }),
  };
});

async function openVerifiedForm() {
  render(<RequestAccessPage />);
  await screen.findByRole('radiogroup');
}

describe('signed out', () => {
  it('offers sign in, and creating an account asks for a matching confirm password', async () => {
    const user = userEvent.setup();
    state.user = null;
    render(<RequestAccessPage />);
    expect(await screen.findByRole('heading', { name: 'Sign in to request access' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });
});

describe('signed in but not verified', () => {
  it('asks for email confirmation and offers to send the link again', async () => {
    state.user = { ...VERIFIED, email_confirmed_at: null };
    render(<RequestAccessPage />);
    expect(await screen.findByRole('heading', { name: 'Confirm your email to continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send the link again' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('request form', () => {
  it('offers exactly the four requested roles, with no group admin', async () => {
    await openVerifiedForm();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    const names = radios.map((r) => r.closest('label').querySelector('.ar-role-label').textContent);
    expect(names).toEqual(['Teacher', 'Pastor', 'Subgroup Admin', 'Other']);
    expect(screen.queryByText('Group Admin')).toBeNull();
  });

  it('filters the subgroups by the chosen group and never lists another group\'s subgroup', async () => {
    const user = userEvent.setup();
    await openVerifiedForm();
    const subgroup = screen.getByRole('combobox', { name: /^Subgroup/ });
    expect(subgroup).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: /^Group/ }), 'CE');
    const ce = within(screen.getByRole('combobox', { name: /^Subgroup/ })).getAllByRole('option').map((o) => o.value);
    expect(ce).toEqual(['', 'CESGA', 'CESGB']);
    await user.selectOptions(screen.getByRole('combobox', { name: /^Group/ }), 'CS');
    const cs = within(screen.getByRole('combobox', { name: /^Subgroup/ })).getAllByRole('option').map((o) => o.value);
    expect(cs).toEqual(['', 'CSGA']);
  });

  it('lists only the fellowships of the chosen group and subgroup', async () => {
    const user = userEvent.setup();
    await openVerifiedForm();
    await user.selectOptions(screen.getByRole('combobox', { name: /^Group/ }), 'CE');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Subgroup/ }), 'CESGB');
    const fellowships = within(screen.getByRole('combobox', { name: /^Fellowship or campus/ })).getAllByRole('option').map((o) => o.value);
    expect(fellowships).toEqual(['', 'YORK']);
  });

  it('shows a summary and links each invalid field when submitted empty', async () => {
    const user = userEvent.setup();
    await openVerifiedForm();
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Please correct/);
    const fullName = screen.getByLabelText(/Full name/);
    expect(fullName).toHaveAttribute('aria-invalid', 'true');
    expect(fullName.getAttribute('aria-describedby')).toMatch(/fullName-error/);
    expect(state.calls.find((c) => c.name === 'submit_access_request')).toBeUndefined();
  });

  it('shows the email as read-only and never submits it', async () => {
    const user = userEvent.setup();
    await openVerifiedForm();
    expect(screen.getByDisplayValue('pat@example.test')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('radio', { name: /Pastor/ }));
    await user.type(screen.getByLabelText(/Full name/), 'Pat Example');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Group/ }), 'CE');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Subgroup/ }), 'CESGA');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Fellowship or campus/ }), 'CMU');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByRole('heading', { name: 'Your request was received' });
    const call = state.calls.find((c) => c.name === 'submit_access_request');
    expect(call.args).toEqual({
      p_requested_role: 'pastor',
      p_full_name: 'Pat Example',
      p_phone: null,
      p_fellowship_code: 'CMU',
      p_group_id: 'CE',
      p_subgroup_id: 'CESGA',
      p_note: null,
    });
    expect(Object.keys(call.args)).not.toContain('p_email');
  });

  it('routes a teacher request through the teacher application, not the general intake', async () => {
    const user = userEvent.setup();
    state.rpcs.submit_teacher_application = async () => ({ data: { ok: true, outcome: 'SUBMITTED', status: 'SUBMITTED', version: 1 }, error: null });
    await openVerifiedForm();
    await user.click(screen.getByRole('radio', { name: /Teacher/ }));
    await user.type(screen.getByLabelText(/Full name/), 'Tina Teacher');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Group/ }), 'CE');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Subgroup/ }), 'CESGA');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Fellowship or campus/ }), 'CMU');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByRole('heading', { name: 'Your request was received' });
    expect(state.calls.some((c) => c.name === 'submit_teacher_application')).toBe(true);
    expect(state.calls.some((c) => c.name === 'submit_access_request')).toBe(false);
  });

  it('shows a plain-language message when the server refuses the submission', async () => {
    const user = userEvent.setup();
    state.rpcs.submit_access_request = async () => ({
      data: null,
      error: { message: 'EMAIL_NOT_VERIFIED: confirm your email address before requesting access' },
    });
    await openVerifiedForm();
    await user.click(screen.getByRole('radio', { name: /Other/ }));
    await user.type(screen.getByLabelText(/Full name/), 'Olive Other');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Group/ }), 'CE');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Subgroup/ }), 'CESGA');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Fellowship or campus/ }), 'CMU');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText(/Confirm your email address before you request access/)).toBeInTheDocument();
  });
});

describe('existing requests', () => {
  it('shows the open request instead of a second form, with withdraw available while submitted', async () => {
    const user = userEvent.setup();
    state.mine.general = [{
      id: 'req-1', requested_role: 'pastor', full_name: 'Pat Example', fellowship_code: 'CMU', group_id: 'CE',
      subgroup_id: 'CESGA', note: null, status: 'SUBMITTED', version: 1, review_message: null,
      submitted_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
    }];
    state.rpcs.withdraw_access_request = async () => ({ data: { ok: true, status: 'WITHDRAWN', version: 2 }, error: null });
    render(<RequestAccessPage />);
    expect(await screen.findByRole('heading', { name: 'You already have an open request' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Withdraw this request' }));
    await waitFor(() => expect(state.calls.find((c) => c.name === 'withdraw_access_request')).toBeTruthy());
    expect(state.calls.find((c) => c.name === 'withdraw_access_request').args).toEqual({ p_request_id: 'req-1', p_expected_version: 1 });
  });

  it('does not offer withdrawal once approval is pending provisioning', async () => {
    state.mine.general = [{
      id: 'req-2', requested_role: 'subgroup_admin', full_name: 'Sam', fellowship_code: 'CMU', group_id: 'CE',
      subgroup_id: 'CESGA', note: null, status: 'APPROVAL_PENDING_PROVISIONING', version: 4, review_message: null,
      submitted_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
    }];
    render(<RequestAccessPage />);
    expect(await screen.findByRole('heading', { name: 'You already have an open request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw this request' })).toBeNull();
    expect(screen.getByText(/Your access is not active until setup is complete|not active until setup is complete/)).toBeInTheDocument();
  });

  it('shows the reviewer message and a prefilled form to resubmit when information was requested', async () => {
    state.mine.general = [{
      id: 'req-3', requested_role: 'pastor', full_name: 'Pat Example', fellowship_code: 'CMU', group_id: 'CE',
      subgroup_id: 'CESGA', note: 'first try', status: 'INFO_REQUESTED', version: 2,
      review_message: 'Which fellowship leader can confirm you?', submitted_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
    }];
    render(<RequestAccessPage />);
    expect(await screen.findByText(/Which fellowship leader can confirm you\?/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Send updated request' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pastor/ })).toBeChecked();
    expect(screen.getByLabelText(/Full name/)).toHaveValue('Pat Example');
  });
});
