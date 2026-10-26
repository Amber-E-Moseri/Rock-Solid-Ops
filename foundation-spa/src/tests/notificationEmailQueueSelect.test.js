import { describe, it, expect, vi, beforeEach } from 'vitest';

// email_queue has no last_error column. The Notification Center must not select it: selectSafe treats a
// missing-column error as an empty table, so one stray column would silently hide every email row.
const { selects } = vi.hoisted(() => ({ selects: [] }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => ({
      select: (columns) => {
        selects.push({ table, columns });
        const chain = { order: () => chain, limit: () => Promise.resolve({ data: [], error: null }) };
        return chain;
      },
    }),
  },
}));

import { fetchAllNotifications } from '../features/notification-center/lib/notifications.js';

const columnsFor = (table) => {
  const hit = selects.find((s) => s.table === table);
  if (!hit) throw new Error(`no select issued for ${table}`);
  return hit.columns.split(',');
};

describe('notification center column selects', () => {
  beforeEach(() => {
    selects.length = 0;
  });

  it('email_queue select does not request last_error and keeps error_message', async () => {
    await fetchAllNotifications();
    const columns = columnsFor('email_queue');
    expect(columns).not.toContain('last_error');
    expect(columns).toContain('error_message');
  });

  it('scheduled_notifications still selects last_error, which exists on that table', async () => {
    await fetchAllNotifications();
    expect(columnsFor('scheduled_notifications')).toContain('last_error');
  });
});
