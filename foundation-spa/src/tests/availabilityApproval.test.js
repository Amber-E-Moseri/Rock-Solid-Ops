import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc, schema } = vi.hoisted(() => ({ rpc: vi.fn(), schema: { slots: [], teachers: [], error: null } }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => {
      if (table === 'teacher_availability') {
        return {
          select: () => ({ order: () => ({ limit: async () => ({ data: schema.slots, error: schema.error }) }) }),
        };
      }
      if (table === 'teachers') {
        return {
          select: () => ({ in: () => ({ limit: async () => ({ data: schema.teachers, error: null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc,
  },
}));

import {
  fetchAvailabilitySlots, groupSlots, computeKpis, filterSlots, statusInfo, canApprove, approveSlot,
  callApprovalRpc, approvalAvailable, APPROVAL_CERTIFIED, APPROVAL_HOLD_MESSAGE,
  SLOT_COLUMNS, APPROVER_ROLES,
} from '../features/availability-approval/lib/availabilityApproval.js';

const slot = (overrides) => ({
  id: 's-1', teacher_id: 'T-1', batch_id: '2026A', day: 'Mon', time_slot: '09:00:00', status: 'Tentative',
  class_option_id: null, class_option_sync_status: null, class_option_sync_error: null,
  teacher_full_name: 'Jane Teacher', teacher_email: 'jane@test.com', created_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  schema.error = null;
  schema.teachers = [{ teacher_id: 'T-1', full_name: 'Jane Teacher', email: 'jane@test.com' }];
  schema.slots = [];
});

describe('slot read contract', () => {
  it('selects only slot-model columns, with no submission fields', () => {
    const cols = SLOT_COLUMNS.split(',').map((c) => c.trim());
    for (const forbidden of ['teacher_name', 'teacher_email', 'month', 'campuses', 'slots', 'review_note', 'reviewed_at', 'reviewed_by']) {
      expect(cols).not.toContain(forbidden);
    }
    expect(cols).toEqual(expect.arrayContaining(['teacher_id', 'batch_id', 'day', 'time_slot', 'status', 'class_option_id']));
  });

  it('takes the teacher name from teachers.full_name, not from the slot row', async () => {
    schema.slots = [{ id: 's-1', teacher_id: 'T-1', day: 'Mon', time_slot: '09:00:00', status: 'Tentative', batch_id: '2026A' }];
    const rows = await fetchAvailabilitySlots();
    expect(rows[0].teacher_full_name).toBe('Jane Teacher');
  });

  it('leaves the name empty when the teacher record has none, rather than inventing one', async () => {
    schema.teachers = [{ teacher_id: 'T-1', full_name: null, email: 'jane@test.com' }];
    schema.slots = [{ id: 's-1', teacher_id: 'T-1', day: 'Mon', time_slot: '09:00:00', status: 'Tentative' }];
    const rows = await fetchAvailabilitySlots();
    expect(rows[0].teacher_full_name).toBeNull();
  });

  it('surfaces a read error instead of an empty list', async () => {
    schema.error = { message: 'permission denied for table teacher_availability', code: '42501' };
    await expect(fetchAvailabilitySlots()).rejects.toMatchObject({ message: 'permission denied for table teacher_availability' });
  });
});

describe('grouping and display', () => {
  it('groups by teacher and batch, and orders slots by day then time', () => {
    const groups = groupSlots([
      slot({ id: 'a', day: 'Wed', time_slot: '10:00:00' }),
      slot({ id: 'b', day: 'Mon', time_slot: '14:00:00' }),
      slot({ id: 'c', day: 'Mon', time_slot: '09:00:00' }),
      slot({ id: 'd', teacher_id: 'T-1', batch_id: '2026B', day: 'Tue', time_slot: '09:00:00' }),
      slot({ id: 'e', teacher_id: 'T-2', teacher_full_name: 'Bob', batch_id: '2026A', day: 'Mon', time_slot: '09:00:00' }),
    ]);

    // Groups sort by teacher name ("Bob" before "Jane Teacher"), then by batch.
    expect(groups.map((g) => `${g.teacher_id}/${g.batch_id}`)).toEqual(['T-2/2026A', 'T-1/2026A', 'T-1/2026B']);
    expect(groups[1].slots.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('treats a missing batch as its own group', () => {
    const groups = groupSlots([slot({ batch_id: null })]);
    expect(groups[0].batch_id).toBeNull();
  });

  it('maps statuses to the three real states plus an explicit other bucket', () => {
    expect(statusInfo('Tentative')).toMatchObject({ key: 'awaiting', label: 'Awaiting approval', variant: 'warning' });
    expect(statusInfo('Available')).toMatchObject({ key: 'approved', label: 'Approved', variant: 'success' });
    expect(statusInfo('Unavailable')).toMatchObject({ key: 'unavailable' });
    expect(statusInfo('Confirmed')).toMatchObject({ key: 'other', label: 'Confirmed' });
  });

  it('counts teachers and slots from the rows it was given, without fabricating review states', () => {
    const kpis = computeKpis([slot(), slot({ id: 's-2', status: 'Available' }), slot({ id: 's-3', teacher_id: 'T-2', status: 'Unavailable' })]);
    expect(kpis).toEqual({ teachers: 2, slots: 3, awaiting: 1, approved: 1 });
  });
});

describe('filtering', () => {
  const rows = [slot(), slot({ id: 's-2', teacher_id: 'T-2', teacher_full_name: 'Bob Kim', teacher_email: 'bob@test.com', status: 'Available' })];

  it('searches name, email and teacher ID', () => {
    expect(filterSlots(rows, { search: 'bob' })).toHaveLength(1);
    expect(filterSlots(rows, { search: 'jane@test' })).toHaveLength(1);
    expect(filterSlots(rows, { search: 't-2' })).toHaveLength(1);
  });

  it('filters by status bucket', () => {
    expect(filterSlots(rows, { status: 'awaiting' }).map((s) => s.id)).toEqual(['s-1']);
    expect(filterSlots(rows, { status: 'approved' }).map((s) => s.id)).toEqual(['s-2']);
  });
});

describe('approval contract', () => {
  it('offers approval only for awaiting slots and only to approver roles', () => {
    expect(canApprove(slot(), 'admin')).toBe(true);
    expect(canApprove(slot(), 'superadmin')).toBe(true);
    expect(canApprove(slot(), 'regional_secretary')).toBe(false);
    expect(canApprove(slot(), 'teacher')).toBe(false);
    expect(canApprove(slot({ status: 'Available' }), 'admin')).toBe(false);
    expect(APPROVER_ROLES).toEqual(['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal']);
  });

  it('keeps approval on hold: approveSlot refuses and never calls the RPC', async () => {
    expect(APPROVAL_CERTIFIED).toBe(false);
    await expect(approveSlot({ id: 's-1', actorEmail: 'admin@test.com', actorId: 'u-1' })).rejects.toThrow(APPROVAL_HOLD_MESSAGE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not offer approval while on hold, even to an approver on an awaiting slot', () => {
    expect(approvalAvailable(slot(), 'admin')).toBe(false);
  });

  it('calls the RPC wrapper with the exact arguments and returns the created ids', async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, class_option_id: 'CO-X', class_slot_id: 'CS-X', error: null }], error: null });

    const result = await callApprovalRpc({ id: 's-1', actorEmail: 'admin@test.com', actorId: 'u-1' });

    expect(rpc).toHaveBeenCalledWith('approve_teacher_availability_atomic', {
      p_availability_id: 's-1', p_actor_email: 'admin@test.com', p_actor_id: 'u-1',
    });
    expect(result).toEqual({ classOptionId: 'CO-X', classSlotId: 'CS-X' });
  });

  it('reports the RPC error text when the approval is refused', async () => {
    rpc.mockResolvedValue({ data: [{ ok: false, class_option_id: null, class_slot_id: null, error: 'No campuses selected for availability. Cannot approve.' }], error: null });
    await expect(callApprovalRpc({ id: 's-1' })).rejects.toThrow('No campuses selected for availability. Cannot approve.');
  });

  it('reports a transport or permission error from the RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function approve_teacher_availability_atomic' } });
    await expect(callApprovalRpc({ id: 's-1' })).rejects.toMatchObject({ message: 'permission denied for function approve_teacher_availability_atomic' });
  });
});
