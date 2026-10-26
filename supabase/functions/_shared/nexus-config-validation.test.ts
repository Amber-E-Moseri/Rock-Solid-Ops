// Nexus task API configuration validation regressions (CV01–CV08). Layer 1, offline.
//
// Requirement: the endpoint and key are validated before any request. A missing or malformed endpoint, an
// insecure scheme, embedded credentials or a query string, or a missing key must produce a rejection with NO
// network request. HTTP is accepted only for an explicit loopback test opt-in.

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  buildDedupeKey,
  createNexusTask,
  ensureNexusTask,
  NexusConfigRejectedError,
  validateNexusTaskConfig,
} from "./nexus-tasks.ts";
import { fetchNexusTaskWindow, reconcileUnknownNexusTasks } from "./nexus-reconcile.ts";
import { FakeNexusDb } from "./nexus-test-support.ts";

const KEY = "nexus-key-for-config-tests";
const LOCAL = { allowLocalTestHttp: true };
const payload = () => ({
  student_id: "S1", student_name: "Jane", email: "j@x.test",
  class_option_id: "CO1", class_number: "3", class_date: "2026-09-20", group_id: "G1", subgroup_id: "SG1",
});
const DEDUPE = buildDedupeKey("missed_class", payload());

/** Records every URL passed to fetch and answers 201 with a task id, so accepted requests are observable. */
function spyFetch() {
  const calls: string[] = [];
  const real = globalThis.fetch;
  return {
    calls,
    install() {
      globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ task: { id: "spy-task" } }), { status: 201 });
      }) as typeof fetch;
      return this;
    },
    restore() {
      globalThis.fetch = real;
    },
  };
}

/** Stub DB that counts RPCs, so a rejected configuration can be shown to claim nothing. */
function countingDb() {
  const rpcs: string[] = [];
  return {
    rpcs,
    rpc: async (name: string) => {
      rpcs.push(name);
      return { data: [], error: null };
    },
  };
}

const MALFORMED: Array<[string, string, Parameters<typeof validateNexusTaskConfig>[0]["nexusUrl"]]> = [
  ["empty URL", "missing_url", ""],
  ["whitespace-only URL", "missing_url", "   "],
  ["unparseable URL", "malformed_url", "not a url"],
  ["scheme-only URL", "malformed_url", "https://"],
  ["plain http to a public host", "insecure_scheme", "http://nexus.test/task-api"],
  ["plain http to loopback without opt-in", "insecure_scheme", "http://127.0.0.1:9"],
  ["ftp scheme", "insecure_scheme", "ftp://nexus.test/task-api"],
  ["credentials in URL", "url_has_credentials", "https://user:pass@nexus.test/task-api"],
  ["query string", "url_has_query", "https://nexus.test/task-api?token=abc"],
  ["fragment", "url_has_query", "https://nexus.test/task-api#frag"],
];

Deno.test("CV01: validateNexusTaskConfig classifies every malformed endpoint and missing key (pure)", () => {
  for (const [label, problem, url] of MALFORMED) {
    const r = validateNexusTaskConfig({ nexusUrl: url, nexusApiKey: KEY });
    assertEquals(r.ok, false, `${label} must be rejected`);
    if (!r.ok) assertEquals(r.problem, problem, label);
  }
  const noKey = validateNexusTaskConfig({ nexusUrl: "https://nexus.test/task-api", nexusApiKey: "   " });
  assertEquals(noKey, { ok: false, problem: "missing_api_key" });
});

Deno.test("CV02: createNexusTask rejects every malformed endpoint before any fetch", async () => {
  const spy = spyFetch().install();
  try {
    for (const [label, problem, url] of MALFORMED) {
      const err = await createNexusTask(url, KEY, {}, "rocksolid:x", 5000).then(() => null, (e) => e);
      assert(err instanceof NexusConfigRejectedError, `${label}: must throw NexusConfigRejectedError, got ${err}`);
      assertEquals(err.problem, problem, label);
    }
    const noKey = await createNexusTask("https://nexus.test/task-api", "", {}, "rocksolid:x", 5000)
      .then(() => null, (e) => e);
    assertEquals(noKey.problem, "missing_api_key");
    assertEquals(spy.calls.length, 0, "no request may be issued for a rejected configuration");
  } finally {
    spy.restore();
  }
});

Deno.test("CV03: https endpoint is accepted; trailing slashes are normalised so the path has no double slash", async () => {
  const spy = spyFetch().install();
  try {
    const r = await createNexusTask("https://nexus.test/task-api/", KEY, {}, "rocksolid:x", 5000);
    assertEquals(r.id, "spy-task");
    assertEquals(spy.calls, ["https://nexus.test/task-api/tasks"]);
  } finally {
    spy.restore();
  }
});

Deno.test("CV04: loopback http is accepted only with the explicit test opt-in, and only for loopback hosts", async () => {
  const spy = spyFetch().install();
  try {
    for (const url of ["http://127.0.0.1:9", "http://localhost:9", "http://[::1]:9"]) {
      const r = await createNexusTask(url, KEY, {}, "rocksolid:x", 5000, LOCAL);
      assertEquals(r.id, "spy-task", `${url} accepted with opt-in`);
    }
    assertEquals(spy.calls.length, 3);

    const err = await createNexusTask("http://nexus.test/task-api", KEY, {}, "rocksolid:x", 5000, LOCAL)
      .then(() => null, (e) => e);
    assertEquals(err?.problem, "insecure_scheme", "a non-loopback host is never accepted over http, even with opt-in");
    assertEquals(spy.calls.length, 3, "the rejected public-http request issued no fetch");
  } finally {
    spy.restore();
  }
});

Deno.test("CV05: ensureNexusTask fails a malformed configuration with no fetch and no POST", async () => {
  const spy = spyFetch().install();
  const db = new FakeNexusDb();
  try {
    // deno-lint-ignore no-explicit-any
    const r = await ensureNexusTask(db as any, "missed_class", payload(), "test@system", {
      nexusUrl: "http://nexus.test/task-api",
      nexusApiKey: KEY,
      timeoutMs: 60,
    });
    assertFalse(r.ok);
    assertEquals(r.error, "Nexus task API configuration rejected: insecure_scheme");
    assertEquals(spy.calls.length, 0, "no request issued");
    assertEquals(db.link(DEDUPE)?.status, "FAILED", "the claimed row is failed, not left in flight");
  } finally {
    spy.restore();
  }
});

Deno.test("CV06: ensureNexusTask with an empty URL reports not-configured and issues no request", async () => {
  const spy = spyFetch().install();
  const db = new FakeNexusDb();
  try {
    // deno-lint-ignore no-explicit-any
    const r = await ensureNexusTask(db as any, "missed_class", payload(), "test@system", {
      nexusUrl: "", nexusApiKey: KEY, timeoutMs: 60,
    });
    assertFalse(r.ok);
    assert(String(r.error).startsWith("Nexus task API is not configured"), String(r.error));
    assertEquals(spy.calls.length, 0);
  } finally {
    spy.restore();
  }
});

Deno.test("CV07: reconcile with a rejected configuration claims nothing, fetches nothing, and consumes no attempts", async () => {
  const spy = spyFetch().install();
  const db = countingDb();
  try {
    // deno-lint-ignore no-explicit-any
    const s = await reconcileUnknownNexusTasks(db as any, { nexusUrl: "http://nexus.test/task-api", nexusApiKey: KEY }, "t@s");
    assertEquals(s.skipped, "nexus_task_api_config_rejected:insecure_scheme");
    assertEquals(db.rpcs.length, 0, "no claim RPC when the configuration is rejected");
    assertEquals(spy.calls.length, 0, "no lookup fetch");

    // deno-lint-ignore no-explicit-any
    const missing = await reconcileUnknownNexusTasks(db as any, { nexusUrl: "", nexusApiKey: KEY }, "t@s");
    assertEquals(missing.skipped, "nexus_task_api_not_configured", "missing config keeps its existing skip reason");
    assertEquals(db.rpcs.length, 0);
  } finally {
    spy.restore();
  }
});

Deno.test("CV08: the Nexus task-window lookup validates the endpoint before any fetch", async () => {
  const spy = spyFetch().install();
  try {
    const r = await fetchNexusTaskWindow("http://nexus.test/task-api", KEY, 5000);
    assertEquals(r, { ok: false, reason: "lookup_config_insecure_scheme" });
    assertEquals(spy.calls.length, 0, "no lookup request for a rejected configuration");
  } finally {
    spy.restore();
  }
});
