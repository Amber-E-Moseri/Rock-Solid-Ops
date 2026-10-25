import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ role: 'superadmin' }));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({ profile: { role: auth.role, email: 'admin@x.com' } }),
}));

vi.mock('../features/batch-management/lib/batchManagement.js', () => {
  const STATUSES = [
    'Active', 'Active', 'Active',
    'Upcoming', 'Upcoming',
    'Archived', 'Archived',
    'Completed', 'Completed',
    'Draft', 'Draft', 'Draft',
  ];
  const batches = STATUSES.map((status, i) => ({
    batch_id: `B${i + 1}`,
    batch_name: `Batch ${i + 1}`,
    status,
    start_date: status === 'Upcoming' ? '2099-01-06' : '2026-05-04',
    end_date: '2026-07-20',
    capacity: 25,
    fellowship_group: 'CESGA',
    created_at: `${2024 + (i % 2)}-01-01T00:00:00Z`,
    registration_open: status === 'Active',
  }));
  return {
    fetchBatches: vi.fn(async () => ({
      batches,
      counts: { B1: 18 },
      moodleCourses: [],
    })),
    fetchFellowshipMap: vi.fn(async () => [
      { fellowship_code: 'CESGA', campus_name: 'UManitoba', subgroup_id: 'SG1', group_id: 'G1' },
      { fellowship_code: 'CSGB', campus_name: 'UWaterloo', subgroup_id: 'SG1', group_id: 'G1' },
    ]),
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
const rows = () => within(document.querySelector('.bm-table')).getAllByRole('row').slice(1);

describe('BatchManagementPage layout', () => {
  beforeEach(() => {
    auth.role = 'superadmin';
  });

  it('shows the summary cards and tab counts', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(screen.getByText('Total Batches').closest('.bm-kpi')).toHaveTextContent('12');
    expect(screen.getByText('Running now').closest('.bm-kpi')).toHaveTextContent('3');
    expect(document.querySelector('.bm-kpi-gold')).toHaveTextContent('Next: Jan 6');
    expect(screen.getByText('Open Registration').closest('.bm-kpi')).toHaveTextContent('Across 2 campuses');
    expect(tabButton('All')).toHaveTextContent('12');
    expect(tabButton('Active')).toHaveTextContent('3');
    expect(tabButton('Upcoming')).toHaveTextContent('2');
    expect(tabButton('Archived')).toHaveTextContent('4');
  });

  it('labels each batch with its campus and fellowship, and shows MM-DD dates', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const first = rows()[0];
    expect(within(first).getByText('UManitoba · CESGA')).toBeInTheDocument();
    expect(within(first).getByText('05-04 → 07-20')).toBeInTheDocument();
    expect(within(first).getByText('18 / 25')).toBeInTheDocument();
  });

  it('uses Edit for open batches and View for archived or completed ones', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const active = rows()[0];
    expect(within(active).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.click(tabButton('Archived'));
    await waitFor(() => expect(rows().length).toBe(4));
    rows().forEach((r) => expect(within(r).getByRole('button', { name: 'View' })).toBeInTheDocument());
  });

  it('Archived tab includes completed batches', async () => {
    renderPage();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(tabButton('Archived'));
    await waitFor(() => expect(rows().length).toBe(4));
    expect(screen.getByText('Showing 4 of 4 batches')).toBeInTheDocument();
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

  it('shows Close, Archive and Delete in the overflow menu for a superadmin', async () => {
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
