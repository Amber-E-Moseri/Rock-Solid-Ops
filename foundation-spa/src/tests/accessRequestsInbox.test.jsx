import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  queue: { general: [], teacher: [] },
  events: [],
  rpcs: {},
  calls: [],
}));

vi.mock('../supabase.js', () => {
  const rowsFor = (view) => {
    if (view === 'access_requests_review') return state.queue.general;
    if (view === 'teacher_applications_review') return state.queue.teacher;
    if (view === 'access_request_events_review') return state.events;
    return [];
  };
  const builder = (rows) => {
    const api = {
      select: () => api,
      order: () => api,
      eq: () => api,
      limit: async () => ({ data: rows, error: null }),
    };
    return api;
  };
  return {
    supabase: {
      from: (view) => builder(rowsFor(view)),
      rpc: (name, args) => {
        state.calls.push({ name, args });
        const fn = state.rpcs[name];
        return fn ? fn(args) : Promise.resolve({ data: null, error: null });
      },
      auth: {},
    },
  };
});

import AccessRequestsPage from '../features/access-requests-inbox/AccessRequestsPage.jsx';
import {
  INBOX_ROLES, QUEUE_TABS, actionsFor, countByTab, decisionErrorMessage, filterQueue,
} from '../features/access-requests-inbox/lib/accessRequestsInbox.js';

function generalRow(overrides = {}) {
  return {
    id: 'gen-1',
    applicant_user_id: 'applicant-1',
    requested_role: 'pastor',
    full_name: 'Pat Example',
    email: 'pat@example.test',
    phone: null,
    fellowship_code: 'CMU',
    group_id: 'CE',
    subgroup_id: 'CESGA',
    note: 'Happy to help',
    status: 'SUBMITTED',
    version: 1,
    review_message: null,
    reviewer_note: null,
    reviewed_by: null,
    reviewed_at: null,
    submitted_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    ...overrides,
  };
}

function teacherRow(overrides = {}) {
  return {
    id: 'teach-1',
    applicant_user_id: 'applicant-2',
    full_name: 'Tina Teacher',
    email: 'tina@example.test',
    phone: null,
    fellowship_code: 'CMU',
    group_id: 'CE',
    subgroup_id: 'CESGA',
    notes: null,
    status: 'SUBMITTED',
    version: 3,
    review_message: null,
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    submitted_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  state.calls = [];
  state.events = [];
  state.queue = { general: [generalRow()], teacher: [] };
  state.rpcs = {};
});

async function openPage() {
  render(<AccessRequestsPage />);
  await screen.findByRole('tablist', { name: 'Request status' });
}

// Waits for the queue to load, then opens the drawer for one request.
async function openReview(name) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Review ${name}` }));
  return screen.findByRole('dialog', { name });
}

describe('access request inbox: roles and tabs', () => {
  it('opens for the four review roles only, never admin or principal', () => {
    expect([...INBOX_ROLES].sort()).toEqual(['pastor', 'regional_secretary', 'subgroup_admin', 'superadmin']);
    expect(INBOX_ROLES).not.toContain('admin');
    expect(INBOX_ROLES).not.toContain('principal');
  });

  it('has the five queue tabs in order', () => {
    expect(QUEUE_TABS.map((t) => t.key)).toEqual(['pending', 'info', 'awaiting', 'rejected', 'all']);
  });

  it('shows the pending tab first, with counts for each tab', async () => {
    state.queue.general = [
      generalRow(),
      generalRow({ id: 'gen-2', full_name: 'Sam Info', status: 'INFO_REQUESTED' }),
    ];
    await openPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Needs information/ })).toHaveTextContent('1');
  });

  it('switches to the needs-information tab and lists only those requests', async () => {
    const user = userEvent.setup();
    state.queue.general = [
      generalRow(),
      generalRow({ id: 'gen-2', full_name: 'Sam Info', status: 'INFO_REQUESTED' }),
    ];
    await openPage();
    await user.click(screen.getByRole('tab', { name: /Needs information/ }));
    expect(await screen.findByText('Sam Info')).toBeInTheDocument();
    expect(screen.queryByText('Pat Example')).toBeNull();
  });

  it('shows the empty state when nothing is waiting', async () => {
    state.queue = { general: [], teacher: [] };
    render(<AccessRequestsPage />);
    expect(await screen.findByText('No requests are waiting for you')).toBeInTheDocument();
  });

  it('shows a filter message when the tab has nothing but the queue is not empty', async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole('tab', { name: /Rejected/ }));
    expect(await screen.findByText('No requests match these filters')).toBeInTheDocument();
  });

  it('filters by search text across name and email', async () => {
    const user = userEvent.setup();
    state.queue.general = [generalRow(), generalRow({ id: 'gen-2', full_name: 'Olive Other', email: 'olive@example.test', requested_role: 'other' })];
    await openPage();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'olive');
    expect(await screen.findByText('Olive Other')).toBeInTheDocument();
    expect(screen.queryByText('Pat Example')).toBeNull();
  });
});

describe('access request inbox: drawer and decisions', () => {
  it('approval asks for confirmation and says it does not activate anyone', async () => {
    const user = userEvent.setup();
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.click(within(drawer).getByRole('button', { name: 'Approve…' }));
    const dialog = within(drawer).getByRole('alertdialog', { name: 'Confirm approval' });
    expect(dialog).toHaveTextContent(/does not activate the account/);
    expect(dialog).toHaveTextContent(/grant staff access/);
    expect(dialog).toHaveTextContent(/send email/);
    expect(state.calls.some((c) => c.name === 'decide_access_request')).toBe(false);
  });

  it('records a general approval with the version it saw and an optional note', async () => {
    const user = userEvent.setup();
    state.rpcs.decide_access_request = async () => ({ data: { ok: true, status: 'APPROVAL_PENDING_PROVISIONING', version: 2 }, error: null });
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.type(within(drawer).getByRole('textbox', { name: /Internal reviewer note/ }), 'Confirmed by the fellowship leader');
    await user.click(within(drawer).getByRole('button', { name: 'Approve…' }));
    await user.click(within(drawer).getByRole('button', { name: 'Record approval' }));
    await waitFor(() => expect(state.calls.find((c) => c.name === 'decide_access_request')).toBeTruthy());
    expect(state.calls.find((c) => c.name === 'decide_access_request').args).toEqual({
      p_request_id: 'gen-1',
      p_action: 'APPROVE',
      p_expected_version: 1,
      p_message: null,
      p_note: 'Confirmed by the fellowship leader',
    });
  });

  it('cancelling the approval confirmation sends nothing', async () => {
    const user = userEvent.setup();
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.click(within(drawer).getByRole('button', { name: 'Approve…' }));
    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(within(drawer).queryByRole('alertdialog')).toBeNull();
    expect(state.calls).toHaveLength(0);
  });

  it('requires a message before requesting information, and sends nothing without one', async () => {
    const user = userEvent.setup();
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.click(within(drawer).getByRole('button', { name: 'Request information' }));
    expect(await within(drawer).findByText('Write the question for the applicant first.')).toBeInTheDocument();
    expect(state.calls).toHaveLength(0);
  });

  it('requires a reason before rejecting', async () => {
    const user = userEvent.setup();
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(await within(drawer).findByText('Write the reason first.')).toBeInTheDocument();
    expect(state.calls).toHaveLength(0);
  });

  it('sends a request for information with the message and the current version', async () => {
    const user = userEvent.setup();
    state.rpcs.decide_access_request = async () => ({ data: { ok: true, status: 'INFO_REQUESTED', version: 2 }, error: null });
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.type(within(drawer).getByRole('textbox', { name: /Message to the applicant/ }), 'Which fellowship leader can confirm you?');
    await user.click(within(drawer).getByRole('button', { name: 'Request information' }));
    await waitFor(() => expect(state.calls.length).toBe(1));
    expect(state.calls[0]).toEqual({
      name: 'decide_access_request',
      args: {
        p_request_id: 'gen-1',
        p_action: 'REQUEST_INFO',
        p_expected_version: 1,
        p_message: 'Which fellowship leader can confirm you?',
        p_note: null,
      },
    });
  });

  it('teacher approval goes through the teacher review function with no note', async () => {
    const user = userEvent.setup();
    state.queue = { general: [], teacher: [teacherRow()] };
    state.rpcs.review_teacher_application = async () => ({ data: { ok: true, status: 'APPROVAL_PENDING_PROVISIONING', version: 4 }, error: null });
    await openPage();
    const drawer = await openReview('Tina Teacher');
    expect(within(drawer).getByRole('textbox', { name: /Internal reviewer note/ })).toBeDisabled();
    expect(within(drawer).getByText('Notes are not stored for teacher approvals yet.')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Approve…' }));
    await user.click(within(drawer).getByRole('button', { name: 'Record approval' }));
    await waitFor(() => expect(state.calls.length).toBe(1));
    expect(state.calls[0].name).toBe('review_teacher_application');
    expect(state.calls[0].args).toEqual({
      p_application_id: 'teach-1',
      p_action: 'APPROVE',
      p_expected_version: 3,
      p_message: null,
    });
    expect(Object.keys(state.calls[0].args)).not.toContain('p_note');
  });

  it('shows a plain message when the server reports the request is not the reviewer\'s to decide', async () => {
    const user = userEvent.setup();
    state.rpcs.decide_access_request = async () => ({ data: null, error: { message: 'FORBIDDEN: not authorized to decide this request' } });
    await openPage();
    const drawer = await openReview('Pat Example');
    await user.type(within(drawer).getByRole('textbox', { name: /Message to the applicant/ }), 'Please clarify');
    await user.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(await within(drawer).findByText('You are not authorized to decide this request.')).toBeInTheDocument();
  });

  it('offers no decision buttons once a request is awaiting provisioning', async () => {
    state.queue.general = [generalRow({ status: 'APPROVAL_PENDING_PROVISIONING', version: 2 })];
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole('tab', { name: /Awaiting provisioning/ }));
    const drawer = await openReview('Pat Example');
    expect(within(drawer).queryByRole('button', { name: 'Approve…' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(within(drawer).getByText('This request is no longer open, so it cannot be decided here.')).toBeInTheDocument();
  });
});

describe('access request inbox: pure queue logic', () => {
  const items = [
    { kind: 'general', id: 'a', status: 'SUBMITTED', role: 'pastor', roleLabel: 'Pastor', fullName: 'Pat Example', email: 'pat@example.test', groupId: 'CE', subgroupId: 'CESGA', fellowshipCode: 'CMU' },
    { kind: 'general', id: 'b', status: 'INFO_REQUESTED', role: 'other', roleLabel: 'Other', fullName: 'Olive', email: 'olive@example.test', groupId: 'CS', subgroupId: 'CSGA', fellowshipCode: 'STOR' },
    { kind: 'teacher', id: 'c', status: 'APPROVAL_PENDING_PROVISIONING', role: 'teacher', roleLabel: 'Teacher', fullName: 'Tina', email: 'tina@example.test', groupId: 'CE', subgroupId: 'CESGA', fellowshipCode: 'CMU' },
    { kind: 'general', id: 'd', status: 'REJECTED', role: 'subgroup_admin', roleLabel: 'Subgroup Admin', fullName: 'Sam', email: 'sam@example.test', groupId: 'CE', subgroupId: 'CESGB', fellowshipCode: 'YORK' },
  ];

  it('counts each tab from the same items the tabs filter', () => {
    expect(countByTab(items)).toEqual({ pending: 1, info: 1, awaiting: 1, rejected: 1, all: 4 });
  });

  it('filters by tab, role and group together', () => {
    expect(filterQueue(items, { tab: 'all', role: 'pastor' }).map((i) => i.id)).toEqual(['a']);
    expect(filterQueue(items, { tab: 'all', group: 'CS' }).map((i) => i.id)).toEqual(['b']);
    expect(filterQueue(items, { tab: 'rejected', group: 'CE' }).map((i) => i.id)).toEqual(['d']);
  });

  it('searches name, email, group, subgroup, fellowship and role label', () => {
    // "stor" would also match "Pastor" in the role label, so use a term that only one row contains.
    expect(filterQueue(items, { tab: 'all', search: 'CSGA' }).map((i) => i.id)).toEqual(['b']);
    expect(filterQueue(items, { tab: 'all', search: 'subgroup admin' }).map((i) => i.id)).toEqual(['d']);
    expect(filterQueue(items, { tab: 'all', search: '  TINA@example ' }).map((i) => i.id)).toEqual(['c']);
  });

  it('defaults to the pending tab when given an unknown one', () => {
    expect(filterQueue(items, { tab: 'nonsense' }).map((i) => i.id)).toEqual(['a']);
  });

  it('offers decisions only on open requests, and the approval note only for general requests', () => {
    expect(actionsFor(items[0])).toEqual({ requestInfo: true, reject: true, approve: true, approveNote: true });
    expect(actionsFor(items[1])).toMatchObject({ requestInfo: true, reject: true });
    expect(actionsFor(items[2])).toEqual({ requestInfo: false, reject: false, approve: false, approveNote: false });
    expect(actionsFor({ ...items[2], kind: 'teacher', status: 'SUBMITTED' })).toMatchObject({ approve: true, approveNote: false });
    expect(actionsFor(items[3]).approve).toBe(false);
  });

  it('separates the reviewer\'s own request from a request they may not decide', () => {
    expect(decisionErrorMessage(new Error('FORBIDDEN: reviewers cannot decide their own request'))).toBe('You cannot decide your own request.');
    expect(decisionErrorMessage(new Error('FORBIDDEN: not authorized to decide this request'))).toBe('You are not authorized to decide this request.');
  });

  it('explains version conflicts, invalid transitions and missing messages in plain words', () => {
    expect(decisionErrorMessage(new Error('VERSION_CONFLICT: stale'))).toMatch(/Reload/);
    expect(decisionErrorMessage(new Error('INVALID_TRANSITION: APPROVAL_PENDING_PROVISIONING'))).toMatch(/can no longer take that action/);
    expect(decisionErrorMessage(new Error('MESSAGE_REQUIRED'))).toMatch(/Enter the message/);
    expect(decisionErrorMessage(new Error('UNAUTHENTICATED'))).toMatch(/Sign in again/);
  });

  it('falls back to a safe sentence for an unknown error', () => {
    expect(decisionErrorMessage(new Error('Something unexpected'))).toMatch(/Something went wrong|could not be updated/);
  });
});
