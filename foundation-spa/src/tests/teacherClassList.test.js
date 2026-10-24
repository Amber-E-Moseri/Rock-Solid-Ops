import { describe, it, expect, vi, beforeEach } from 'vitest';

// The teacher-portal-api response envelope is { ok: true, data: [...] } on success.
// These tests pin the service boundary: genuine results are arrays, genuine
// empties are [], and failures or malformed responses throw instead of looking empty.

const { invoke, fromMock } = vi.hoisted(() => ({ invoke: vi.fn(), fromMock: vi.fn() }));

vi.mock('../supabase.js', () => ({
  supabase: { functions: { invoke }, from: fromMock },
}));

import { fetchTeacherClasses, fetchStudentProgress, unwrapClassList } from '../features/teacher-portal/lib/teacherPortal.js';

const CLASSES = [
  { class_option_id: 'CO-1', class_name: 'Sunday 10:00', day: 'Sunday', active: true },
  { class_option_id: 'CO-2', class_name: 'Tuesday 19:00', day: 'Tuesday', active: true },
];

// A chainable query stub that resolves to `result` when awaited.
const inCalls = [];
function chain(result) {
  const q = {
    select() { return q; }, eq() { return q; }, limit() { return q; },
    in(col, vals) { inCalls.push([col, vals]); return q; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  inCalls.length = 0;
  fromMock.mockImplementation(() => chain({ data: [], error: null }));
});

describe('fetchTeacherClasses', () => {
  it('returns every class for a teacher with multiple classes', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: CLASSES }, error: null });
    const classes = await fetchTeacherClasses('T1');
    expect(classes).toEqual(CLASSES);
    expect(classes).toHaveLength(2);
  });

  it('returns an empty array for a genuine empty result', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: [] }, error: null });
    await expect(fetchTeacherClasses('T1')).resolves.toEqual([]);
  });

  it('throws on a failed request instead of returning an empty list', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network down') });
    await expect(fetchTeacherClasses('T1')).rejects.toThrow('network down');
  });

  it('throws when the function reports ok: false', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: 'Teacher is not active' }, error: null });
    await expect(fetchTeacherClasses('T1')).rejects.toThrow('Teacher is not active');
  });

  it('throws on a malformed envelope (data is not an array) instead of returning []', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { unexpected: true } }, error: null });
    await expect(fetchTeacherClasses('T1')).rejects.toThrow('Class list response was malformed');
  });

  it('throws on a response with no envelope at all', async () => {
    invoke.mockResolvedValue({ data: { class_options: CLASSES }, error: null });
    await expect(fetchTeacherClasses('T1')).rejects.toThrow('Class list response was malformed');
  });

  it('throws on an empty body', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await expect(fetchTeacherClasses('T1')).rejects.toThrow('Class list response was malformed');
  });
});

describe('unwrapClassList', () => {
  it('reads the data array from a successful envelope', () => {
    expect(unwrapClassList({ ok: true, data: CLASSES })).toBe(CLASSES);
  });

  it('uses the error message from an ok: false object form', () => {
    expect(() => unwrapClassList({ ok: false, error: { message: 'Forbidden' } })).toThrow('Forbidden');
  });
});

describe('fetchStudentProgress uses the corrected class list', () => {
  it('requests progress for every class in a multi-class envelope', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: CLASSES }, error: null });
    await fetchStudentProgress('T1');
    expect(fromMock).toHaveBeenCalledWith('students');
    expect(inCalls).toContainEqual(['class_option_id', ['CO-1', 'CO-2']]);
  });

  it('does not query progress when the class list is malformed', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: 'nope' }, error: null });
    await expect(fetchStudentProgress('T1')).rejects.toThrow('Class list response was malformed');
    expect(fromMock).not.toHaveBeenCalledWith('students');
  });
});
