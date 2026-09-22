import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { validateCronAuth } from "./_shared/auth.ts";

const TEST_CRON_SECRET = "wave1-test-cron-secret-value-123456";
const WRONG_CRON_SECRET = "wave1-wrong-cron-secret-value-123";
const TEST_INTERNAL_SECRET = "wave1-test-internal-secret-value";

const functions = [
  {
    name: "missed-class-detector",
    path: "./missed-class-detector/index.ts",
    firstPrivilegedMarkers: [
      'Deno.env.get("SUPABASE_URL")',
      'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
      "createClient(SUPABASE_URL, SERVICE_KEY",
      '.from("class_roster")',
    ],
  },
  {
    name: "student-engagement-monitor",
    path: "./student-engagement-monitor/index.ts",
    firstPrivilegedMarkers: [
      "initServiceClient();",
      "const cfg = await getConfig();",
      '.from("batches")',
    ],
  },
  {
    name: "attendance-reminder",
    path: "./attendance-reminder/index.ts",
    firstPrivilegedMarkers: [
      'Deno.env.get("SUPABASE_URL")',
      'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
      "createClient(SUPABASE_URL, SERVICE_KEY",
      '.from("class_slots")',
    ],
  },
  {
    name: "review-checkin",
    path: "./review-checkin/index.ts",
    firstPrivilegedMarkers: [
      'Deno.env.get("SUPABASE_URL")',
      'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
      "createClient(SUPABASE_URL, SERVICE_KEY",
      '.from("applicants")',
    ],
  },
  {
    name: "attention-flag-push-sweep",
    path: "./attention-flag-push-sweep/index.ts",
    firstPrivilegedMarkers: [
      'Deno.env.get("SUPABASE_URL")',
      'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
      "createClient(SUPABASE_URL, SUPABASE_SERVICE",
      '.from("attention_flags")',
    ],
  },
  {
    name: "notification-batch-processor",
    path: "./notification-batch-processor/index.ts",
    firstPrivilegedMarkers: [
      'Deno.env.get("SUPABASE_URL")',
      'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
      "createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
      "await req.json()",
      '.from("scheduled_notifications")',
    ],
  },
] as const;

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/e2-wave1", {
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

Deno.test("W1-C1: valid x-cron-secret is accepted", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": TEST_CRON_SECRET }));
    assertEquals(resp, null);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

Deno.test("W1-C2: missing x-cron-secret is rejected", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  try {
    const resp = validateCronAuth(makeReq());
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

Deno.test("W1-C3: wrong x-cron-secret is rejected", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_CRON_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

Deno.test("W1-C4: x-internal-secret alone is rejected as cron auth", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-internal-secret": TEST_INTERNAL_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("W1-C5: service-role-like bearer alone is rejected as cron auth", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ Authorization: "Bearer fake-service-role-token" }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

Deno.test("W1-C6: auth failures do not disclose cron or supplied secrets", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_CRON_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_CRON_SECRET }));
    assertNotEquals(resp, null);
    const body = await resp!.text();
    assertEquals(body.includes(TEST_CRON_SECRET), false);
    assertEquals(body.includes(WRONG_CRON_SECRET), false);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

for (const fn of functions) {
  Deno.test(`W1-${fn.name}: imports and calls cron auth before privileged work`, async () => {
    const source = await readSource(fn.path);
    const handler = handlerBody(source);
    assert(source.includes('import { validateCronAuth } from "../_shared/auth.ts";'));
    const authIndex = handler.indexOf("const authFailure = validateCronAuth(req);");
    assert(authIndex > 0, `${fn.name} must call validateCronAuth`);
    assert(handler.indexOf("if (authFailure) return authFailure;", authIndex) > authIndex);
    for (const marker of fn.firstPrivilegedMarkers) {
      const markerIndex = handler.indexOf(marker);
      assert(markerIndex > authIndex, `${fn.name}: ${marker} must be after cron auth`);
    }
  });
}

Deno.test("W1-student-engagement-monitor: service client is not created at module load", async () => {
  const source = await readSource("./student-engagement-monitor/index.ts");
  assertEquals(source.includes("const sb = createClient("), false);
  const handler = handlerBody(source);
  assert(handler.indexOf("initServiceClient();") > handler.indexOf("validateCronAuth(req)"));
});

Deno.test("W1-notification-batch-processor: provider env is not read at module load", async () => {
  const source = await readSource("./notification-batch-processor/index.ts");
  const callMoodleStart = source.indexOf("async function callMoodle");
  assert(callMoodleStart > 0, "callMoodle helper must exist");
  const modulePrefix = source.slice(0, callMoodleStart);
  assertEquals(modulePrefix.includes('Deno.env.get("MOODLE_URL")'), false);
  assertEquals(modulePrefix.includes('Deno.env.get("MOODLE_TOKEN")'), false);
});

Deno.test("W1-config: root verify_jwt=false exists for all cron-only functions", async () => {
  const config = await Deno.readTextFile(new URL("../config.toml", import.meta.url));
  const expected = [
    "missed-class-detector",
    "student-engagement-monitor",
    "attendance-reminder",
    "review-checkin",
    "attention-flag-push-sweep",
    "notification-batch-processor",
  ];
  for (const fn of expected) {
    const section = `[functions.${fn}]`;
    const start = config.indexOf(section);
    assert(start >= 0, `${section} missing`);
    const rest = config.slice(start + section.length);
    const nextSection = rest.search(/\n\[functions\./);
    const body = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
    assert(body.includes("verify_jwt = false"), `${section} must set verify_jwt=false`);
  }
});
