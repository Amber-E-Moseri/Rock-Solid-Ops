import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { validateCronAuth, validateInternalAuth } from "./_shared/auth.ts";

const TEST_CRON_SECRET = "wave2-test-cron-secret-value-123456";
const TEST_INTERNAL_SECRET = "wave2-test-internal-secret-value";

const targets = [
  {
    name: "waitlist-processor",
    path: "./waitlist-processor/index.ts",
    domains: ["cron", "internal", "user"],
    roles: ["admin", "superadmin", "subgroup_admin", "pastor", "principal"],
    authMarkers: [
      'req.headers.has("x-cron-secret")',
      "validateCronAuth(req)",
      'req.headers.has("x-internal-secret")',
      "validateInternalAuth(req)",
      "serviceDb.auth.getUser(token)",
      "isAuthorizedStaff(serviceDb",
    ],
    privilegedMarkers: [
      "const body = await req.json()",
      '.from("class_slots")',
      '.from("batches")',
    ],
  },
  {
    name: "retry-worker",
    path: "./retry-worker/index.ts",
    domains: ["cron", "user"],
    roles: ["admin", "superadmin", "subgroup_admin", "pastor", "principal"],
    authMarkers: [
      'req.headers.has("x-cron-secret")',
      "validateCronAuth(req)",
      'req.headers.has("x-internal-secret")',
      "Unsupported caller credential",
      "serviceDb.auth.getUser(jwt)",
      "await isAdmin(serviceDb",
    ],
    privilegedMarkers: [
      "const body = (await req.json()",
      "sweepMoodleEnrollmentRetries(serviceDb",
      "applyRetry(serviceDb",
    ],
  },
  {
    name: "moodle-grade-sync",
    path: "./moodle-grade-sync/index.ts",
    domains: ["cron", "user"],
    roles: ["admin", "superadmin", "subgroup_admin", "pastor", "principal"],
    authMarkers: [
      'req.headers.has("x-cron-secret")',
      "validateCronAuth(req)",
      'req.headers.has("x-internal-secret")',
      "Unsupported caller credential",
      "serviceDb.auth.getUser(token)",
      "isAuthorizedStaff(serviceDb",
    ],
    privilegedMarkers: [
      "const body = await req.json()",
      '.from("moodle_enrollment_sync")',
      'callMoodle("core_completion_get_course_completion_status"',
    ],
  },
  {
    name: "report-generator",
    path: "./report-generator/index.ts",
    domains: ["cron", "user"],
    roles: ["admin", "superadmin", "regional_secretary"],
    authMarkers: [
      'req.headers.has("x-cron-secret")',
      "validateCronAuth(req)",
      'req.headers.has("x-internal-secret")',
      "Unsupported caller credential",
      "requireAdminAccess(req, serviceDb)",
      'role !== "admin" && role !== "superadmin" && role !== "regional_secretary"',
    ],
    privilegedMarkers: [
      "try { body = await req.json(); }",
      "fetchActiveBatch(supabase)",
      "buildReport(supabase",
      "buildPastorDigest(supabase",
    ],
  },
] as const;

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/e2-wave2", {
    method: "POST",
    headers,
  });
}

async function readSource(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, import.meta.url));
}

function handlerBody(source: string): string {
  const start = source.indexOf("Deno.serve(async (req)");
  assert(start > 0, "Deno.serve handler must exist");
  return source.slice(start);
}

Deno.test("W2-C1: cron validator accepts valid cron secret", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  try {
    assertEquals(validateCronAuth(makeReq({ "x-cron-secret": TEST_CRON_SECRET })), null);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

Deno.test("W2-C2: internal validator accepts valid internal secret", () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    assertEquals(validateInternalAuth(makeReq({ "x-internal-secret": TEST_INTERNAL_SECRET })), null);
  } finally {
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("W2-C3: internal secret cannot satisfy cron auth", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": TEST_INTERNAL_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("W2-C4: cron secret cannot satisfy internal auth", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq({ "x-internal-secret": TEST_CRON_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("W2-C5: service-role-like bearer satisfies neither custom auth domain", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const req = makeReq({ Authorization: "Bearer fake-service-role-token" });
    assertNotEquals(validateCronAuth(req), null);
    assertNotEquals(validateInternalAuth(req), null);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

for (const target of targets) {
  Deno.test(`W2-${target.name}: explicit auth domains are implemented`, async () => {
    const source = await readSource(target.path);
    for (const marker of target.authMarkers) {
      assert(source.includes(marker), `${target.name}: missing ${marker}`);
    }
    for (const role of target.roles) {
      assert(source.includes(role), `${target.name}: missing role ${role}`);
    }
  });

  Deno.test(`W2-${target.name}: auth dispatch precedes privileged work`, async () => {
    const source = await readSource(target.path);
    const handler = handlerBody(source);
    const authIndex = handler.indexOf("authorizeRequest(req");
    assert(authIndex > 0, `${target.name}: handler must call authorizeRequest`);
    for (const marker of target.privilegedMarkers) {
      const markerIndex = handler.indexOf(marker);
      assert(markerIndex > authIndex, `${target.name}: ${marker} must be after auth dispatch`);
    }
  });
}

Deno.test("W2-waitlist-processor: unauthenticated fallback is removed", async () => {
  const source = await readSource("./waitlist-processor/index.ts");
  assert(source.includes('"Missing credentials"'));
  assertEquals(source.includes('if (req.headers.has("x-internal-secret")) {\n    const internalFailure'), false);
});

Deno.test("W2-retry-worker: absent bearer no longer means cron", async () => {
  const source = await readSource("./retry-worker/index.ts");
  assertEquals(source.includes('const isCronCall = !authHeader.startsWith("Bearer ");'), false);
  assert(source.includes('json({ ok: false, error: "Missing credentials" }, 401)'));
  assert(source.includes('const isCronCall = auth.mode === "cron";'));
});

Deno.test("W2-retry-worker: Nexus task escalation uses server-side credentials", async () => {
  const source = await readSource("./retry-worker/index.ts");
  assert(source.includes("ensureNexusTask("), "ensureNexusTask must be imported and used");
  assert(source.includes("NEXUS_API_URL"), "NEXUS_API_URL env var must be referenced");
  assert(source.includes("NEXUS_API_KEY"), "NEXUS_API_KEY must be read server-side");
  assertEquals(source.includes("triggerClickupEscalation"), false, "removed ClickUp escalation function");
  assertEquals(source.includes("x-internal-secret"), false, "internal auth no longer sent to ClickUp");
});

Deno.test("W2-retry-worker: B4 durable handoff remains", async () => {
  const source = await readSource("./retry-worker/index.ts");
  assert(source.includes("Row is now RETRYING"));
  assert(source.includes("moodle-sync cron picks it up"));
  assertEquals(source.includes("/functions/v1/moodle-sync"), false);
});

Deno.test("W2-report-generator: cron scope is limited to scheduled report types", async () => {
  const source = await readSource("./report-generator/index.ts");
  assert(source.includes("normalizeCronReportBody(body)"));
  assert(source.includes('"weekly_regional"'));
  assert(source.includes('"monthly_regional"'));
  assert(source.includes('"pastor_digest"'));
  assert(source.includes("Cron report type not allowed"));
  assert(source.includes("Cron recipients override not allowed"));
});

Deno.test("W2-config: root verify_jwt values match mixed-entrypoint source auth", async () => {
  const config = await Deno.readTextFile(new URL("../config.toml", import.meta.url));
  for (const fn of ["waitlist-processor", "retry-worker", "moodle-grade-sync", "report-generator"]) {
    const section = `[functions.${fn}]`;
    const start = config.indexOf(section);
    assert(start >= 0, `${section} missing`);
    const rest = config.slice(start + section.length);
    const nextSection = rest.search(/\n\[functions\./);
    const body = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
    assert(body.includes("verify_jwt = false"), `${section} must set verify_jwt=false`);
  }
});
