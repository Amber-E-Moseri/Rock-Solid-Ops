// Test support for the Nexus task / reconciliation behaviour tests. Not a test file itself.
//
// FakeNexusDb mirrors, in JS, the semantics of the SQL in
//   202609240001/0002 + 202610030001 (claim_nexus_task, claim_nexus_reconciliations,
//   resolve_nexus_reconciliation) and of the Supabase query builder: thenable, with NO .catch().
// It exercises the EDGE logic (call order, state handling, concurrency interleavings at await points).
// It does NOT prove the SQL itself; the real RPCs need Postgres and stay a blocked gate.
//
// FakeNexus mirrors Amber-E-Moseri/Nexus task-api: POST /tasks is find-or-create on
// external_unique_key (201 {task} / 200 {duplicate:true,task}); GET /tasks has no key filter and returns
// the newest <=200 tasks.

export type Row = Record<string, any>;

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};

export class FakeNexusDb {
  tables: Record<string, Row[]> = {
    rocksolid_task_links: [],
    rocksolid_admin_mappings: [],
    audit_logs: [],
    applicants: [],
    moodle_enrollment_sync: [],
    students: [],
  };
  offsetMs = 0;
  /**
   * One-shot database fault injection for the query builder: the next `times` operations on `table`/`op`
   * whose payload satisfies `when` return { data: null, error: { message } } and change nothing.
   */
  faults: Array<{ table: string; op: "select" | "insert" | "update"; when?: (payload: Row | null) => boolean; message: string; times: number }> = [];
  failWrite(f: { table: string; op: "select" | "insert" | "update"; when?: (payload: Row | null) => boolean; message?: string; times?: number }) {
    this.faults.push({ message: "injected database failure", times: 1, ...f });
  }
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private seq = 0;

  /** The database clock (real time plus a controllable offset). */
  now(): number {
    return Date.now() + this.offsetMs;
  }
  advance(msDelta: number) {
    this.offsetMs += msDelta;
  }

  get links(): Row[] {
    return this.tables.rocksolid_task_links;
  }
  link(dedupeKey: string): Row | undefined {
    return this.links.find((r) => r.dedupe_key === dedupeKey);
  }
  addMapping(m: Row) {
    this.tables.rocksolid_admin_mappings.push({
      active: true,
      subgroup_id: null,
      updated_at: new Date().toISOString(),
      ...m,
    });
  }
  auditActions(): string[] {
    return this.tables.audit_logs.map((r) => String(r.action));
  }

  from(table: string) {
    return new Query(this, table);
  }

  // deno-lint-ignore require-await
  async rpc(name: string, args: Record<string, any>): Promise<{ data: any; error: { message: string } | null }> {
    this.rpcCalls.push({ name, args });
    try {
      switch (name) {
        case "claim_nexus_task":
          return { data: this.claimNexusTask(args), error: null };
        case "claim_nexus_reconciliations":
          return { data: this.claimReconciliations(args), error: null };
        case "resolve_nexus_reconciliation":
          return { data: this.resolveReconciliation(args), error: null };
        default:
          return { data: null, error: { message: `unknown rpc ${name}` } };
      }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  // ── mirrors of the SQL functions ─────────────────────────────────────────────

  private claimNexusTask(a: Record<string, any>) {
    const now = this.now();
    const ttlMs = 2 * 60 * 1000;
    const ex = this.link(a.p_dedupe_key);
    if (!ex) {
      const row: Row = {
        id: `row-${++this.seq}`,
        source_type: a.p_source_type,
        source_id: a.p_source_id,
        dedupe_key: a.p_dedupe_key,
        nexus_task_id: null,
        status: "CLAIMING",
        claim_token: a.p_claim_token,
        claimed_at: now,
        error_message: null,
        created_at: now,
        reconcile_attempts: 0,
        next_reconcile_at: null,
        last_reconcile_at: null,
        reconciled_at: null,
        reconcile_claim_token: null,
        reconcile_claimed_at: null,
      };
      this.links.push(row);
      return [{ row_id: row.id, nexus_task_id: null, status: "CLAIMING", is_owner: true }];
    }
    const out = (owner: boolean) => [{ row_id: ex.id, nexus_task_id: ex.nexus_task_id, status: ex.status, is_owner: owner }];
    if (ex.nexus_task_id) return out(false);
    if (ex.status === "TIMEOUT_UNKNOWN" || ex.status === "RECONCILE_FAILED" || ex.status === "ASSIGNEE_REJECTED") return out(false);
    if (ex.claim_token && ["CLAIMING", "PENDING"].includes(ex.status) && (ms(ex.claimed_at) ?? 0) > now - ttlMs) {
      return out(ex.claim_token === a.p_claim_token);
    }
    ex.claim_token = a.p_claim_token;
    ex.claimed_at = now;
    ex.status = "CLAIMING";
    return out(true);
  }

  private claimReconciliations(a: Record<string, any>) {
    const now = this.now();
    const leaseMs = Math.max(a.p_lease_seconds ?? 120, 1) * 1000;
    const limit = Math.max(Math.min(a.p_limit, 100), 0);
    const due = this.links
      .filter((r) =>
        r.status === "TIMEOUT_UNKNOWN" && !r.nexus_task_id &&
        (r.next_reconcile_at == null || (ms(r.next_reconcile_at) ?? 0) <= now) &&
        (r.reconcile_claimed_at == null || (ms(r.reconcile_claimed_at) ?? 0) < now - leaseMs)
      )
      .sort((x, y) => ((ms(x.next_reconcile_at) ?? ms(x.created_at) ?? 0) - (ms(y.next_reconcile_at) ?? ms(y.created_at) ?? 0)))
      .slice(0, limit);
    for (const r of due) {
      r.reconcile_claim_token = a.p_claim_token;
      r.reconcile_claimed_at = now;
      r.last_reconcile_at = now;
    }
    return due.map((r) => ({
      row_id: r.id,
      dedupe_key: r.dedupe_key,
      source_type: r.source_type,
      source_id: r.source_id,
      reconcile_attempts: r.reconcile_attempts,
    }));
  }

  private resolveReconciliation(a: Record<string, any>) {
    if (!["FOUND", "ABSENT", "UNKNOWN"].includes(a.p_outcome)) throw new Error(`invalid reconciliation outcome: ${a.p_outcome}`);
    const now = this.now();
    const r = this.links.find((x) => x.id === a.p_row_id);
    const no = (status: string) => [{ row_id: a.p_row_id, status, applied: false }];
    if (!r || r.reconcile_claim_token !== a.p_claim_token || r.status !== "TIMEOUT_UNKNOWN" || r.nexus_task_id) {
      return no(r?.status ?? "MISSING");
    }
    const release = () => {
      r.reconcile_claim_token = null;
      r.reconcile_claimed_at = null;
      r.last_reconcile_at = now;
      r.updated_at = now;
    };
    if (a.p_outcome === "FOUND") {
      if (!a.p_nexus_task_id || !String(a.p_nexus_task_id).trim()) return no(r.status);
      r.status = "CREATED";
      r.nexus_task_id = String(a.p_nexus_task_id).trim();
      r.error_message = null;
      r.reconcile_attempts += 1;
      r.reconciled_at = now;
      r.next_reconcile_at = null;
      release();
      return [{ row_id: r.id, status: "CREATED", applied: true }];
    }
    if (a.p_outcome === "ABSENT") {
      r.status = "FAILED";
      r.error_message = "RECONCILED_ABSENT: no Nexus task found for this external_unique_key";
      r.reconcile_attempts += 1;
      r.reconciled_at = now;
      r.next_reconcile_at = null;
      release();
      return [{ row_id: r.id, status: "FAILED", applied: true }];
    }
    const attempts = r.reconcile_attempts + 1;
    r.reconcile_attempts = attempts;
    if (attempts >= 24) {
      r.status = "RECONCILE_FAILED";
      r.error_message = `RECONCILE_EXHAUSTED after ${attempts} attempts: ${a.p_error ?? "inconclusive"}`.slice(0, 500);
      r.next_reconcile_at = null;
      release();
      return [{ row_id: r.id, status: "RECONCILE_FAILED", applied: true }];
    }
    r.error_message = `TIMEOUT_UNKNOWN: ${a.p_error ?? "lookup inconclusive"}`.slice(0, 500);
    r.next_reconcile_at = now + Math.min(6 * 3600_000, 5 * 60_000 * Math.pow(2, Math.min(attempts, 6)));
    release();
    return [{ row_id: r.id, status: "TIMEOUT_UNKNOWN", applied: true }];
  }
}

/** Mirrors the Supabase query builder: thenable, deliberately WITHOUT .catch(). */
class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private single = false;
  private returning = false;

  constructor(private db: FakeNexusDb, private table: string) {}

  // Like the real client: select() after insert()/update() means "return the affected rows".
  select(_cols?: string) {
    if (this.op === "update" || this.op === "insert") this.returning = true;
    else this.op = "select";
    return this;
  }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }

  then<T>(res?: (v: { data: any; error: { message: string } | null }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve().then(() => this.exec()).then(res, rej);
  }

  private exec(): { data: any; error: { message: string } | null } {
    const rows = (this.db.tables[this.table] ??= []);
    const fault = this.db.faults.find((f) => f.table === this.table && f.op === this.op && f.times > 0 && (!f.when || f.when(this.payload)));
    if (fault) {
      fault.times -= 1;
      return { data: null, error: { message: fault.message } };
    }
    if (this.op === "insert") {
      rows.push({ ...this.payload });
      return { data: this.returning ? [{ ...this.payload }] : null, error: null };
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of matched) Object.assign(r, this.payload);
      return { data: this.returning ? matched.map((r) => ({ ...r })) : null, error: null };
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      matched = [...matched].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.max !== null) matched = matched.slice(0, this.max);
    return { data: this.single ? (matched[0] ?? null) : matched, error: null };
  }
}

// ── Fake Nexus task-api ───────────────────────────────────────────────────────

export type PostMode = "ok" | "timeout_after_create" | "timeout_without_create" | "http_500" | "http_400" | "http_429" | "malformed_after_create";
export type GetMode = "ok" | "down" | "timeout" | "http_500" | "http_401" | "bad_json" | "bad_shape" | "bad_item";

export class FakeNexus {
  tasks: Row[] = [];
  postMode: PostMode = "ok";
  /** Body text of the `http_400` response (task-api answers "assignee not found" for an unknown assignee). */
  badRequestMessage = "assignee not found";
  getMode: GetMode = "ok";
  posts: Array<{ headers: Headers; body: Record<string, any> }> = [];
  gets = 0;
  /** Runs after Nexus has decided a POST (task created / duplicate) and before the response is returned. */
  afterPost: ((body: Record<string, any>) => void) | null = null;
  /** Extra tasks (newest first) that crowd a GET window, e.g. 200 unrelated tasks. */
  filler: Row[] = [];
  private seq = 0;
  private realFetch = globalThis.fetch;

  install() {
    globalThis.fetch = this.handle.bind(this) as typeof fetch;
    return this;
  }
  restore() {
    globalThis.fetch = this.realFetch;
  }

  taskForKey(key: string): Row | undefined {
    return this.tasks.find((t) => t.external_unique_key === key);
  }

  private hang(signal: AbortSignal | null | undefined): Promise<Response> {
    return new Promise((_res, rej) => {
      const abort = () => rej(new DOMException("The signal has been aborted", "AbortError"));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort);
    });
  }

  private json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  // deno-lint-ignore require-await
  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (!url.pathname.endsWith("/tasks")) return this.json(404, { error: "Not found" });

    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      this.posts.push({ headers, body });
      if (this.postMode === "http_500") return this.json(500, { error: "Internal server error" });
      if (this.postMode === "http_400") return this.json(400, { error: this.badRequestMessage });
      if (this.postMode === "http_429") return this.json(429, { error: "Rate limit exceeded" });
      if (this.postMode === "timeout_without_create") return this.hang(init?.signal);

      // find-or-create on external_unique_key (task-api semantics)
      const existing = body.external_unique_key ? this.taskForKey(body.external_unique_key) : undefined;
      let response: Response;
      if (existing) {
        response = this.json(200, { duplicate: true, task: { id: existing.id, title: existing.title } });
      } else {
        const task = { id: `nexus-task-${++this.seq}`, ...body, source: "api", created_at: new Date().toISOString() };
        this.tasks.unshift(task);
        response = this.json(201, { task: { id: task.id, title: task.title } });
      }
      this.afterPost?.(body);
      if (this.postMode === "timeout_after_create") return this.hang(init?.signal);
      if (this.postMode === "malformed_after_create") return this.json(201, { id: "wrong-shape" });
      return response;
    }

    if (method === "GET") {
      this.gets += 1;
      if (this.getMode === "down") throw new TypeError("error sending request: connection refused");
      if (this.getMode === "timeout") return this.hang(init?.signal);
      if (this.getMode === "http_500") return this.json(500, { error: "Internal server error" });
      if (this.getMode === "http_401") return this.json(401, { error: "Invalid API key" });
      if (this.getMode === "bad_json") return new Response("<html>oops", { status: 200 });
      if (this.getMode === "bad_shape") return this.json(200, { tasks: { not: "an array" } });
      const tasks = [...this.filler, ...this.tasks].slice(0, 200).map((t) => ({
        id: t.id,
        title: t.title,
        external_unique_key: t.external_unique_key ?? null,
        source: t.source ?? "api",
      }));
      if (this.getMode === "bad_item") tasks.push({ external_unique_key: "rocksolid:x", id: "" } as Row);
      return this.json(200, { tasks, count: tasks.length });
    }
    return this.json(405, { error: "Method not allowed" });
  }
}
