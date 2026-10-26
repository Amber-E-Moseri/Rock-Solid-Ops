import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({ calls: [], classOptionsError: null, slotError: null, auditError: null }));

function settled(error) {
  return { then: (resolve, reject) => Promise.resolve({ data: null, error }).then(resolve, reject) };
}

function queryChain(result = { data: [], error: null }) {
  const chain = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'delete', 'maybeSingle', 'single']) {
    chain[m] = () => chain;
  }
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table) => ({
      insert: (rows) => {
        mock.calls.push({ table, op: 'insert', rows });
        const error = table === 'class_options' ? mock.classOptionsError
          : table === 'class_slots' ? mock.slotError
            : table === 'audit_logs' ? mock.auditError
              : null;
        return settled(error);
      },
      update: (patch) => {
        mock.calls.push({ table, op: 'update', patch });
        return queryChain({ data: null, error: null });
      },
      select: () => queryChain({ data: [], error: null }),
      delete: () => {
        mock.calls.push({ table, op: 'delete' });
        return queryChain({ data: null, error: null });
      },
    }),
  },
}));

import { createClass, splitSharedClass } from '../features/class-editor/lib/classEditor.js';

const TEACHER = { teacher_id: 'RSO-TEST-TEACHER', full_name: 'RSO Test Teacher', group_id: 'CE', subgroup_id: 'CE-A' };

function form(overrides = {}) {
  return {
    teacherId: 'RSO-TEST-TEACHER',
    day: 'Friday',
    time: '09:00',
    capacity: 1,
    batchId: '2025A',
    suffix: 'RSO-UAT C1 synthetic test',
    expiry: '',
    isOnline: false,
    active: true,
    enrollOpen: false,
    fc: ['STAGING'],
    mode: 'shared',
    customId: null,
    ...overrides,
  };
}

const classRows = () => mock.calls.filter((c) => c.table === 'class_options' && c.op === 'insert').flatMap((c) => c.rows);
const slotRows = () => mock.calls.filter((c) => c.table === 'class_slots' && c.op === 'insert').flatMap((c) => c.rows);
const auditRows = () => mock.calls.filter((c) => c.table === 'audit_logs' && c.op === 'insert').flatMap((c) => c.rows);

describe('createClass persists the class_options contract', () => {
  beforeEach(() => {
    mock.calls = [];
    mock.classOptionsError = null;
    mock.slotError = null;
    mock.auditError = null;
  });

  it('writes a class_id on the shared-class insert, matching the primary key', async () => {
    const result = await createClass({ form: form(), teacher: TEACHER, actorEmail: 'admin@example.test' });
    const [row] = classRows();
    expect(row.class_id).toBeTruthy();
    expect(row.class_id).toBe(row.class_option_id);
    expect(result.classId).toBe(row.class_option_id);
  });

  it('persists the displayed auto identifier as class_option_id, unchanged', async () => {
    await createClass({ form: form(), teacher: TEACHER, actorEmail: 'admin@example.test' });
    const [row] = classRows();
    expect(row.class_option_id).toBe('CO-CEA-FRI-0900-RSOTEST');
  });

  it('uses an explicit custom identifier for both class_option_id and class_id', async () => {
    await createClass({ form: form({ customId: 'RSO-UAT-C1-TEST' }), teacher: TEACHER, actorEmail: 'admin@example.test' });
    const [row] = classRows();
    expect(row.class_option_id).toBe('RSO-UAT-C1-TEST');
    expect(row.class_id).toBe('RSO-UAT-C1-TEST');
  });

  it('gives each separate-mode row its own identifier, mirrored in class_id', async () => {
    await createClass({
      form: form({ isOnline: true, fc: ['REGIONAL', 'STAGING'], mode: 'separate' }),
      teacher: TEACHER,
      actorEmail: 'admin@example.test',
    });
    const rows = classRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.class_id).toBe(row.class_option_id);
    expect(new Set(rows.map((r) => r.class_option_id)).size).toBe(2);
  });

  it('keeps Registration Open and Active exactly as the form sets them', async () => {
    await createClass({ form: form({ enrollOpen: false, active: true }), teacher: TEACHER, actorEmail: 'admin@example.test' });
    const [row] = classRows();
    expect(row.enrollment_open).toBe(false);
    expect(row.active).toBe(true);
  });

  it('keeps the teacher, capacity, batch and fellowship on the row and the slot', async () => {
    await createClass({ form: form({ capacity: 1 }), teacher: TEACHER, actorEmail: 'admin@example.test' });
    const [row] = classRows();
    const [slot] = slotRows();
    expect(row.teacher_id).toBe('RSO-TEST-TEACHER');
    expect(row.max_capacity).toBe(1);
    expect(row.fellowship_codes).toEqual(['STAGING']);
    expect(slot.batch_id).toBe('2025A');
    expect(slot.class_option_id).toBe(row.class_option_id);
  });

  it('rejects missing teacher, day or time before any write', async () => {
    for (const bad of [{ teacherId: '' }, { day: '' }, { time: '' }]) {
      mock.calls = [];
      await expect(createClass({ form: form(bad), teacher: TEACHER, actorEmail: 'admin@example.test' }))
        .rejects.toThrow('Teacher, day and time are required.');
      expect(mock.calls).toEqual([]);
    }
  });

  it('rejects a duplicate identifier, and writes no slot or audit row', async () => {
    mock.classOptionsError = { code: '23505', message: 'duplicate key value violates unique constraint "class_options_pkey"' };
    await expect(createClass({ form: form({ customId: 'RSO-UAT-C1-TEST' }), teacher: TEACHER, actorEmail: 'admin@example.test' }))
      .rejects.toMatchObject({ message: expect.stringContaining('duplicate key') });
    expect(slotRows()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it('surfaces a slot insert failure instead of reporting success', async () => {
    mock.slotError = { message: 'slot insert failed' };
    await expect(createClass({ form: form(), teacher: TEACHER, actorEmail: 'admin@example.test' }))
      .rejects.toMatchObject({ message: 'slot insert failed' });
  });
});

describe('splitSharedClass keeps the curriculum label', () => {
  beforeEach(() => {
    mock.calls = [];
    mock.classOptionsError = null;
  });

  it('gives split rows the source class_id, with their own identifiers', async () => {
    const source = {
      class_option_id: 'CO-SHARED-1',
      class_id: 'CE-A-01',
      teacher_id: 'RSO-TEST-TEACHER',
      teacher_name: 'RSO Test Teacher',
      day: 'Friday',
      class_time: '09:00',
      max_capacity: 1,
      label_suffix: 'x',
      group_id: 'CE',
      subgroup_id: 'CE-A',
      fellowship_codes: ['REGIONAL', 'STAGING'],
    };
    await splitSharedClass({ source, actorEmail: 'admin@example.test' });
    const rows = classRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.class_id).toBe('CE-A-01');
      expect(row.class_option_id).not.toBe('CE-A-01');
    }
    expect(new Set(rows.map((r) => r.class_option_id)).size).toBe(2);
  });
});
