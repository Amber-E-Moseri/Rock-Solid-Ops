// In-memory stand-in for @supabase/supabase-js, used only by containment-e2e tests.
// It records every operation in state.log so tests can assert that refused requests touch nothing.
type Row = Record<string, any>;
export type FakeState = {
  tables: Record<string, Row[]>;
  jwts: Record<string, { id: string; email?: string | null }>;
  log: string[];
};

function makeDb(state: FakeState) {
  return {
    auth: {
      getUser: async (jwt: string) => {
        state.log.push("auth.getUser");
        const user = state.jwts[jwt];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid jwt" } };
      },
    },
    from: (table: string) => builder(state, table),
    rpc: (name: string) => {
      state.log.push(`rpc:${name}`);
      return Promise.resolve({ data: null, error: { message: "rpc not available in harness" } });
    },
  };
}

function builder(state: FakeState, table: string) {
  const q = {
    op: "select" as "select" | "update" | "insert",
    patch: null as Row | null,
    filters: [] as Array<(r: Row) => boolean>,
    limitN: null as number | null,
    single: false,
    returning: false,
  };
  const b: any = {
    select() {
      if (q.op === "update" || q.op === "insert") q.returning = true;
      return b;
    },
    update(p: Row) { q.op = "update"; q.patch = p; return b; },
    insert(p: Row) { q.op = "insert"; q.patch = p; return b; },
    eq(c: string, v: unknown) { q.filters.push((r) => r[c] === v); return b; },
    in(c: string, vs: unknown[]) { q.filters.push((r) => vs.includes(r[c])); return b; },
    lt(c: string, v: string) { q.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b; },
    order() { return b; },
    limit(n: number) { q.limitN = n; return b; },
    maybeSingle() { q.single = true; return b; },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return exec().then(resolve, reject);
    },
  };
  function exec(): Promise<{ data: unknown; error: unknown }> {
    state.log.push(`${q.op}:${table}`);
    const rows = (state.tables[table] ??= []);
    if (q.op === "insert") {
      rows.push({ ...(q.patch as Row) });
      return Promise.resolve({ data: null, error: null });
    }
    const matched = rows.filter((r) => q.filters.every((f) => f(r)));
    if (q.op === "update") {
      matched.forEach((r) => Object.assign(r, q.patch));
      if (matched.length && q.returning) state.log.push(`claim-hit:${table}`);
      return Promise.resolve({ data: q.returning ? matched.map((r) => ({ id: r.id })) : null, error: null });
    }
    const data = q.limitN != null ? matched.slice(0, q.limitN) : matched;
    if (q.single) return Promise.resolve({ data: data[0] ?? null, error: null });
    return Promise.resolve({ data, error: null });
  }
  return b;
}

export function createClient(_url: string, _key: string, _opts?: unknown) {
  const state = (globalThis as any).__fakeState as FakeState;
  return makeDb(state);
}
