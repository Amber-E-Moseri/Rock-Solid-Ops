// Shared test doubles for the teacher onboarding screens. The real supabase client is never created in
// tests: each test file mocks ../supabase.js and points it at a client built here.
import { vi } from 'vitest';

// Chainable stand-in for supabase.from(table). It resolves to the configured result when awaited and
// returns `data[0]` for maybeSingle(), matching the query shapes the pages use.
export function queryChain(result) {
  const chain = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({
    data: Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null),
    error: result.error ?? null,
  }));
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

export function makeClient({ tables = {}, rpc, auth = {} } = {}) {
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signUp: vi.fn(async () => ({ data: { user: { id: 'u-new', identities: [{ id: 'i-new' }] }, session: null }, error: null })),
      resend: vi.fn(async () => ({ data: {}, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({ data: { session: { access_token: 'x' } }, error: null })),
      verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      ...auth,
    },
    from: vi.fn((table) => queryChain(tables[table] ?? { data: [], error: null })),
    rpc: vi.fn(rpc ?? (async () => ({ data: { ok: true, outcome: 'SUBMITTED' }, error: null }))),
  };
  return client;
}

// Builds a JWT-shaped string whose payload carries the given amr methods. Only the payload is read.
export function jwtWithAmr(methods) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { sub: 'u1', amr: methods.map((method) => ({ method, timestamp: 1 })) };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

export const APPLICANT_ID = 'u-applicant';

export function applicantRow(overrides = {}) {
  return {
    id: 'app-1',
    status: 'SUBMITTED',
    version: 2,
    full_name: 'Applicant Alpha',
    phone: '+1 555 0100',
    fellowship_code: 'CMU',
    notes: 'Notes here',
    review_message: null,
    submitted_at: '2026-10-20T12:00:00Z',
    updated_at: '2026-10-20T12:00:00Z',
    ...overrides,
  };
}
