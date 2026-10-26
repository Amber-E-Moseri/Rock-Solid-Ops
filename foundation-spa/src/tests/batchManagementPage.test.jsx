import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ role: 'superadmin' }));
// Batch-campus overrides served to the page. fail makes the settings read error.
const coverage = vi.hoisted(() => ({ rows: [], fail: false }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: auth.role, email: 'admin@x.com' } }),
}));

vi.mock('../features/batch-management/lib/batchManagement.js', () => {
  // Status and subgroup per batch. Active batches open registration.
  const BATCHES = [
    ['Active', 'CESGA'], ['Active', 'CESGA'], ['Active', 'CESGB'],
    ['Upcoming', 'CESGB'], ['Upcoming', 'WSGA'],
    ['Archived', 'WSGA'], ['Archived', 'CESGA'],
    ['Completed', 'WSGA'], ['Completed', 'CSGA'],
    ['Draft', 'CSGA'], ['Draft', 'CESGA'], ['Draft', 'WSGA'],
  ];
  const batches = BATCHES.map(([status, subgroup], i) => ({
    batch_id: `B${i + 1}`,
    batch_name: `Batch ${i + 1}`,
    status,
    start_date: status === 'Upcoming' ? '2099-01-06' : '2026-05-04',
    end_date: '2026-07-20',
    capacity: 25,
    subgroup_id: subgroup,
    fellowship_group: subgroup.slice(0, 2),
    notes: 'Bring a Bible',
    created_at: `${2024 + (i % 2)}-01-01T00:00:00Z`,
    registration_open: status === 'Active',
  }));
  return {
    fetchBatches: vi.fn(async () => ({
      batches,
      counts: { B1: 18 },
      moodleCourses: [],
    })),
    // Four campuses in the map. Only two are reached by the open batches (CESGA and CESGB).
    fetchFellowshipMap: vi.fn(async () => [
      { fellowship_code: 'CMU', campus_name: 'Manitoba', group_id: 'CE', subgroup_id: 'CESGA' },
      { fellowship_code: 'UWA', campus_name: 'Waterloo', group_id: 'CE', subgroup_id: 'CESGB' },
      { fellowship_code: 'UBC', campus_name: 'UBC', group_id: 'WS', subgroup_id: 'WSGA' },
      { fellowship_code: 'YORK', campus_name: 'York', group_id: 'CS', subgroup_id: 'CSGA' },
    ]),
    fetchAllCampusSettings: vi.fn(async () => {
      if (coverage.fail) throw new Error('denied');
      return coverage.rows;
    }),
    fetchSubgroups: vi.fn(async () => []),
    upsertBatch: vi.fn(),
    archiveBatch: vi.fn(),
    deleteBatch: vi.fn(),
    closeBatch: vi.fn(),
    reopenBatch: vi.fn(),
    rolloverBatch: vi.fn(),
    announceBatch: vi.fn(),
    filterBatches: (rows, { search, status, fellowship, sort }) => {
      let out = rows;
      if (search) out = out.filter((b) => b.batch_name.toLowerCase().includes(search.toLowerCase()));
      if (status) out = out.filter((b) => b.status.toLowerCase() === status.toLowerCase());
      if (fellowship) out = out.filter((b) => b.fellowship_group === fellowship);
      if (sort === 'oldest') out = [...out].reverse();
      return out;
    },
    fmtDate: (v) => (v ? String(v).slice(0, 10) : '—'),
  };
});

import { ToastProvider } from '../context/ToastContext.jsx';
import BatchManagementPage from '../features/batch-management/BatchManagementPage.jsx';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BatchManagementPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const tabButton = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const table = () => document.querySelector('.bm-table');
const rows = () => within(table()).getAllByRole('row').slice(1);
const rowFor = (name) => rows().find((r) => within(r).queryByText(name));
const dialog = () => screen.getByRole('dialog');

describe('BatchManagementPage summary and tabs', () => {
  beforeEach(() => {
    auth.role = 'superadmin';
  });

  it('shows the summary cards and tab counts', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(screen.getByText('Total Batches').closest('.bm-kpi')).toHaveTextContent('12');
    expect(screen.getByText('Running now').closest('.bm-kpi')).toHaveTextContent('3');
    expect(document.querySelector('.bm-kpi-gold')).toHaveTextContent('Next: Jan 6');
    expect(tabButton('All')).toHaveTextContent('12');
    expect(tabButton('Active')).toHaveTextContent('3');
    expect(tabButton('Upcoming')).toHaveTextContent('2');
    expect(tabButton('Archived')).toHaveTextContent('4');
  });

  it('counts only the campuses reached by open batches, not every campus in the map', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    // Three batches have registration open. They reach Manitoba (CESGA) and Waterloo (CESGB): two campuses.
    const open = document.querySelector('.bm-kpi-rose');
    expect(open).toHaveTextContent('3');
    expect(open).toHaveTextContent('Across 2 campuses');
    expect(open).not.toHaveTextContent('Across 4 campuses');
  });

  it('labels each batch with its campus and subgroup, and shows MM-DD dates', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const first = rows()[0];
    expect(within(first).getByText('Manitoba · CESGA')).toBeInTheDocument();
    expect(within(first).getByText('05-04 → 07-20')).toBeInTheDocument();
    expect(within(first).getByText('18 / 25')).toBeInTheDocument();
  });

  it('Upcoming means Upcoming only; Draft batches appear under All only', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(tabButton('Upcoming'));
    await waitFor(() => expect(rows().length).toBe(2));
    rows().forEach((r) => expect(within(r).queryByText('Draft')).toBeNull());
    fireEvent.click(tabButton('All'));
    await waitFor(() => expect(rows().length).toBe(10));
    expect(screen.getByText('Showing 10 of 12 batches')).toBeInTheDocument();
  });

  it('Archived tab keeps Archived and Completed batches together with their own badges', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(tabButton('Archived'));
    await waitFor(() => expect(rows().length).toBe(4));
    expect(screen.getByText('Showing 4 of 4 batches')).toBeInTheDocument();
    const archivedBadges = rows().map((r) => within(r).getByText(/^(Archived|Completed)$/).textContent);
    expect(archivedBadges.sort()).toEqual(['Archived', 'Archived', 'Completed', 'Completed']);
  });
});

describe('BatchManagementPage pagination', () => {
  beforeEach(() => {
    auth.role = 'superadmin';
  });

  it('pages 10 rows at a time with Load more', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBe(10));
    expect(screen.getByText('Showing 10 of 12 batches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows().length).toBe(12));
    expect(screen.getByText('Showing 12 of 12 batches')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('reports the filtered total and resets to one page when a filter changes', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBe(10));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows().length).toBe(12));

    // "Batch 1" matches Batch 1, 10, 11 and 12.
    fireEvent.change(screen.getByPlaceholderText('Search batches…'), { target: { value: 'Batch 1' } });
    await waitFor(() => expect(rows().length).toBe(4));
    expect(screen.getByText('Showing 4 of 4 batches')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(rows().length).toBe(10));
    expect(screen.getByText('Showing 10 of 12 batches')).toBeInTheDocument();
  });
});

describe('BatchManagementPage Edit and View', () => {
  it('superadmin: open batches get Edit, which opens the editable form with Save', async () => {
    auth.role = 'superadmin';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Edit' }));
    const d = dialog();
    expect(within(d).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(d.querySelectorAll('input, select, textarea').length).toBeGreaterThan(0);
  });

  it('archived and completed batches get View, never Edit, for an authorized role', async () => {
    auth.role = 'superadmin';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(tabButton('Archived'));
    await waitFor(() => expect(rows().length).toBe(4));
    rows().forEach((r) => {
      expect(within(r).queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(within(r).getByRole('button', { name: 'View' })).toBeInTheDocument();
    });
  });

  it('View is read-only: text only, no fields, no Save', async () => {
    auth.role = 'superadmin';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(tabButton('Archived'));
    await waitFor(() => expect(rows().length).toBe(4));
    fireEvent.click(within(rowFor('Batch 6')).getByRole('button', { name: 'View' }));
    const d = dialog();
    expect(within(d).getByText('Batch 6')).toBeInTheDocument();
    expect(d.querySelectorAll('input, select, textarea, button[type="submit"]').length).toBe(0);
    expect(within(d).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(d).queryByRole('textbox')).toBeNull();
    // Batch 6 is a WSGA batch, so its campus is UBC. The details show the campus and notes as plain text.
    expect(within(d).getByText('UBC')).toBeInTheDocument();
    expect(within(d).getByText('Bring a Bible')).toBeInTheDocument();
  });

  it('a role without batch write access sees View, not Edit, even on open batches', async () => {
    auth.role = 'teacher';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const active = rowFor('Batch 1');
    expect(within(active).queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(within(active).getByRole('button', { name: 'View' }));
    const d = dialog();
    expect(d.querySelectorAll('input, select, textarea').length).toBe(0);
    expect(within(d).queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('regional secretary, which is_admin() covers, gets Edit on open batches', async () => {
    auth.role = 'regional_secretary';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(within(rowFor('Batch 1')).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('mobile cards follow the same Edit or View rule', async () => {
    auth.role = 'teacher';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const cards = document.querySelector('.rso-table-cards');
    expect(within(cards).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(cards).getAllByRole('button', { name: 'View' }).length).toBeGreaterThan(0);
  });
});

describe('BatchManagementPage overflow menu permissions', () => {
  it('shows Close, Archive and Delete in the overflow menu for a superadmin', async () => {
    auth.role = 'superadmin';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Rollover' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Announce' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides superadmin-only actions from the overflow menu for other roles', async () => {
    auth.role = 'admin';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Close' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Rollover' })).toBeInTheDocument();
  });
});

describe('BatchManagementPage campus coverage', () => {
  const openKpi = () => document.querySelector('.bm-kpi-rose');

  beforeEach(() => {
    auth.role = 'superadmin';
    coverage.rows = [];
    coverage.fail = false;
  });

  it('explicit overrides close a campus for every open batch that names it', async () => {
    // B1 and B2 are CESGA batches (Manitoba). B3 is a CESGB batch (Waterloo). Closing Manitoba for B1 and
    // B2 leaves Waterloo as the only campus reached by the three open batches.
    coverage.rows = [
      { batch_id: 'B1', fellowship_code: 'CMU', registration_open: false },
      { batch_id: 'B2', fellowship_code: 'CMU', registration_open: false },
    ];
    renderPage();
    await waitFor(() => expect(openKpi()).toHaveTextContent('Across 1 campus'));
    expect(openKpi()).toHaveTextContent('3');
  });

  it('a batch closed at every campus it reaches contributes no campus', async () => {
    coverage.rows = [
      { batch_id: 'B1', fellowship_code: 'CMU', registration_open: false },
      { batch_id: 'B2', fellowship_code: 'CMU', registration_open: false },
      { batch_id: 'B3', fellowship_code: 'UWA', registration_open: false },
    ];
    renderPage();
    await waitFor(() => expect(openKpi()).toHaveTextContent('Across 0 campuses'));
  });

  it('shows coverage as unavailable when the settings read fails, not as a count', async () => {
    coverage.fail = true;
    renderPage();
    await waitFor(() => expect(openKpi()).toHaveTextContent('Campus coverage unavailable'));
    expect(openKpi()).not.toHaveTextContent('Across');
  });

  it('a role that cannot read every override sees coverage as unavailable and no campus label', async () => {
    auth.role = 'subgroup_admin';
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(openKpi()).toHaveTextContent('Campus coverage unavailable');
    expect(within(rows()[0]).getByText('CESGA')).toBeInTheDocument();
    expect(within(rows()[0]).queryByText(/Manitoba/)).toBeNull();
  });
});
